package imageproc

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"math/bits"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"aisets/internal/imgtools"
	"github.com/corona10/goimagehash"
	_ "github.com/gen2brain/avif"
	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	minify "github.com/tdewolff/minify/v2"
	minifysvg "github.com/tdewolff/minify/v2/svg"
	"github.com/zeebo/blake3"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

type Metadata struct {
	Format    string `json:"format"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Animated  bool   `json:"animated"`
	Alpha     bool   `json:"alpha"`
	Pages     int    `json:"pages"`
	ErrorCode string `json:"errorCode,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Hashes struct {
	DHash        string `json:"dHash,omitempty"`
	DHashFlipped string `json:"dHashFlipped,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
	Error        string `json:"error,omitempty"`
}

type Optimization struct {
	Category       string `json:"category"`
	ReasonCode     string `json:"reasonCode"`
	Reason         string `json:"reason"`
	Severity       string `json:"severity"`
	SuggestionCode string `json:"suggestionCode"`
	Suggestion     string `json:"suggestion"`
	EstimatedBytes int64  `json:"estimatedBytes,omitempty"`
	SavingsBytes   int64  `json:"savingsBytes,omitempty"`
}

type OptimizationThresholds struct {
	SVGMinSavingsPercent int  `json:"svgMinSavingsPercent"`
	MaxDimensionPx       int  `json:"maxDimensionPx"`
	FileSizeWarningKB    int  `json:"fileSizeWarningKB"`
	FileSizeCriticalKB   int  `json:"fileSizeCriticalKB"`
	PNGAlphaCheckEnabled bool `json:"pngAlphaCheckEnabled"`
}

func DefaultOptimizationThresholds() OptimizationThresholds {
	return OptimizationThresholds{
		SVGMinSavingsPercent: 10,
		MaxDimensionPx:       2560,
		FileSizeWarningKB:    200,
		FileSizeCriticalKB:   500,
		PNGAlphaCheckEnabled: true,
	}
}

func (t OptimizationThresholds) Hash() string {
	raw := fmt.Sprintf("%d:%d:%d:%d:%t",
		t.SVGMinSavingsPercent, t.MaxDimensionPx,
		t.FileSizeWarningKB, t.FileSizeCriticalKB,
		t.PNGAlphaCheckEnabled)
	sum := blake3.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

type ThumbnailResult struct {
	Path      string `json:"path"`
	CacheHit  bool   `json:"cacheHit"`
	MimeType  string `json:"mimeType"`
	CacheKey  string `json:"cacheKey"`
	SizeBytes int64  `json:"sizeBytes"`
}

func runImgtoolsJSON(result any, args ...string) error {
	bin, err := imgtools.Binary()
	if err != nil {
		return err
	}
	out, err := exec.Command(bin, args...).Output()
	if err != nil {
		return err
	}
	return json.Unmarshal(out, result)
}

func runImgtoolsExec(args ...string) error {
	bin, err := imgtools.Binary()
	if err != nil {
		return err
	}
	return exec.Command(bin, args...).Run()
}

func Probe(path string) (Metadata, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".svg" {
		meta, err := probeSVG(path)
		if err != nil {
			if meta.ErrorCode == "" {
				meta.ErrorCode = "image_probe_failed"
			}
			meta.Error = err.Error()
		}
		return meta, err
	}

	if ext == ".gif" {
		return probeGIF(path)
	}

	var meta Metadata
	if err := runImgtoolsJSON(&meta, "probe", path); err == nil {
		if ext == ".webp" {
			meta = augmentWebPMetadata(path, meta)
		}
		return meta, nil
	}

	if ext == ".heic" || ext == ".heif" {
		return probeHEIC(path, ext)
	}

	file, err := os.Open(path)
	if err != nil {
		return Metadata{ErrorCode: "image_open_failed", Error: err.Error()}, err
	}
	defer file.Close()

	cfg, format, err := image.DecodeConfig(file)
	if err != nil {
		return Metadata{Format: strings.TrimPrefix(ext, "."), ErrorCode: "image_probe_failed", Error: err.Error()}, err
	}
	meta = Metadata{Format: normalizeFormat(format, ext), Width: cfg.Width, Height: cfg.Height, Pages: 1}
	_, _ = file.Seek(0, io.SeekStart)
	img, _, decodeErr := image.Decode(file)
	if decodeErr == nil {
		meta.Alpha = imageHasAlpha(img)
	}
	if ext == ".webp" {
		meta = augmentWebPMetadata(path, meta)
	}
	return meta, nil
}

func augmentWebPMetadata(path string, meta Metadata) Metadata {
	data, err := os.ReadFile(path)
	if err != nil {
		return meta
	}
	animated, pages, alpha, ok := parseWebPContainerMetadata(data)
	if !ok {
		return meta
	}
	meta.Format = "webp"
	if pages > 0 {
		meta.Pages = pages
	} else if meta.Pages == 0 {
		meta.Pages = 1
	}
	if animated {
		meta.Animated = true
	}
	if alpha {
		meta.Alpha = true
	}
	return meta
}

func parseWebPContainerMetadata(data []byte) (animated bool, pages int, alpha bool, ok bool) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return false, 0, false, false
	}
	for offset := 12; offset+8 <= len(data); {
		chunkID := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		dataStart := offset + 8
		dataEnd := dataStart + chunkSize
		if chunkSize < 0 || dataEnd > len(data) {
			break
		}
		switch chunkID {
		case "VP8X":
			if chunkSize > 0 {
				flags := data[dataStart]
				alpha = alpha || flags&0x10 != 0
				animated = animated || flags&0x02 != 0
			}
		case "ANIM":
			animated = true
		case "ANMF":
			pages++
			animated = true
		}
		offset = dataEnd
		if chunkSize%2 == 1 {
			offset++
		}
	}
	if pages == 0 {
		pages = 1
	}
	return animated, pages, alpha, true
}

func probeHEIC(path, ext string) (Metadata, error) {
	meta := Metadata{Format: strings.TrimPrefix(ext, "."), Pages: 1}
	img, err := decodeHEIC(path)
	if err != nil {
		meta.ErrorCode = "image_probe_failed"
		meta.Error = err.Error()
		return meta, err
	}
	bounds := img.Bounds()
	meta.Width = bounds.Dx()
	meta.Height = bounds.Dy()
	meta.Alpha = imageHasAlpha(img)
	return meta, nil
}

func DHash(path string) (Hashes, error) {
	var result Hashes
	if err := runImgtoolsJSON(&result, "dhash", path); err == nil {
		return result, nil
	}
	img, err := decodeRaster(path)
	if err != nil {
		return Hashes{ErrorCode: "image_hash_failed", Error: err.Error()}, err
	}
	hash, err := goimagehash.DifferenceHash(img)
	if err != nil {
		return Hashes{ErrorCode: "image_hash_failed", Error: err.Error()}, err
	}
	flipped, err := goimagehash.DifferenceHash(flipHorizontal(img))
	if err != nil {
		return Hashes{ErrorCode: "image_hash_failed", Error: err.Error()}, err
	}
	return Hashes{
		DHash:        fmt.Sprintf("%016x", hash.GetHash()),
		DHashFlipped: fmt.Sprintf("%016x", flipped.GetHash()),
	}, nil
}

func DistanceHex(a, b string) (int, bool) {
	av, err := strconv.ParseUint(a, 16, 64)
	if err != nil {
		return 0, false
	}
	bv, err := strconv.ParseUint(b, 16, 64)
	if err != nil {
		return 0, false
	}
	return bits.OnesCount64(av ^ bv), true
}

const (
	NearDuplicateVisualDistanceThreshold = 25
	visualDistanceSampleSize             = 16
)

func VisualDistance(pathA, pathB string, flipB bool) (int, error) {
	sA, err := VisualSample(pathA)
	if err != nil {
		return 0, err
	}
	sB, err := VisualSample(pathB)
	if err != nil {
		return 0, err
	}
	return VisualDistanceFromSamples(sA, sB, flipB), nil
}

func VisualSample(path string) (*image.NRGBA, error) {
	var result struct {
		Width  int    `json:"width"`
		Height int    `json:"height"`
		RGBA   string `json:"rgba"`
	}
	if err := runImgtoolsJSON(&result, "visual-sample", path); err == nil {
		raw, err := hex.DecodeString(result.RGBA)
		if err == nil && len(raw) == result.Width*result.Height*4 {
			img := image.NewNRGBA(image.Rect(0, 0, result.Width, result.Height))
			copy(img.Pix, raw)
			return img, nil
		}
	}
	img, err := decodeRaster(path)
	if err != nil {
		return nil, err
	}
	return visualSample(img), nil
}

func VisualDistanceFromSamples(sampleA, sampleB *image.NRGBA, flipB bool) int {
	b := sampleB
	if flipB {
		b = flipSample(sampleB)
	}
	const contentAlphaMin = 10
	var total, count int
	var bothContent, eitherContent int
	for y := 0; y < visualDistanceSampleSize; y++ {
		for x := 0; x < visualDistanceSampleSize; x++ {
			rA, gA, bA, aA := rgba8(sampleA.At(x, y))
			rB, gB, bB, aB := rgba8(b.At(x, y))
			hasA := aA > contentAlphaMin
			hasB := aB > contentAlphaMin
			if hasA || hasB {
				eitherContent++
			}
			if hasA && hasB {
				bothContent++
			}
			if aA == 0 && aB == 0 {
				continue
			}
			count++
			total += absInt(rA-rB) + absInt(gA-gB) + absInt(bA-bB) + absInt(aA-aB)
		}
	}
	if count == 0 {
		return 255
	}
	if eitherContent > 0 && bothContent*10 < eitherContent*7 {
		return 255
	}
	return int(math.Round(float64(total) / float64(count*4)))
}

func flipSample(src *image.NRGBA) *image.NRGBA {
	w := src.Bounds().Dx()
	h := src.Bounds().Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(w-1-x, y, src.At(x, y))
		}
	}
	return dst
}

func visualSample(img image.Image) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, visualDistanceSampleSize, visualDistanceSampleSize))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	return dst
}

func rgba8(c color.Color) (int, int, int, int) {
	r, g, b, a := c.RGBA()
	return int(r >> 8), int(g >> 8), int(b >> 8), int(a >> 8)
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func IsVisualMatch(leftPath, rightPath string, flipped bool) bool {
	if leftPath == "" || rightPath == "" {
		return true
	}
	distance, err := VisualDistance(leftPath, rightPath, flipped)
	if err != nil {
		return true
	}
	return distance <= NearDuplicateVisualDistanceThreshold
}

func Thumbnail(path, cacheDir, cacheKey string, size int) (ThumbnailResult, error) {
	if size <= 0 {
		size = 256
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return ThumbnailResult{}, err
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".svg" {
		target := filepath.Join(cacheDir, safeCacheName(cacheKey)+".png")
		if info, err := os.Stat(target); err == nil {
			return ThumbnailResult{Path: target, CacheHit: true, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: info.Size()}, nil
		}
		// Prefer imgtools (resvg) for broad SVG spec coverage; fall back to oksvg when unavailable
		if err := runImgtoolsExec("svg-to-png", "--max-size", strconv.Itoa(size), path, target); err == nil {
			if info, err := os.Stat(target); err == nil {
				if chmodErr := os.Chmod(target, 0o644); chmodErr != nil {
					return ThumbnailResult{}, chmodErr
				}
				return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: info.Size()}, nil
			}
		}
		img, err := rasterizeSVG(path, size)
		if err != nil {
			return ThumbnailResult{}, err
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return ThumbnailResult{}, err
		}
		if err := os.WriteFile(target, buf.Bytes(), 0o644); err != nil {
			return ThumbnailResult{}, err
		}
		if err := os.Chmod(target, 0o644); err != nil {
			return ThumbnailResult{}, err
		}
		return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: int64(buf.Len())}, nil
	}

	target := filepath.Join(cacheDir, safeCacheName(cacheKey)+".png")
	if info, err := os.Stat(target); err == nil {
		return ThumbnailResult{Path: target, CacheHit: true, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: info.Size()}, nil
	}
	if err := runImgtoolsExec("thumbnail", "--size", strconv.Itoa(size), path, target); err == nil {
		if info, err := os.Stat(target); err == nil {
			if chmodErr := os.Chmod(target, 0o644); chmodErr != nil {
				return ThumbnailResult{}, chmodErr
			}
			return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: info.Size()}, nil
		}
	}
	img, err := decodeRaster(path)
	if err != nil {
		return ThumbnailResult{}, err
	}
	bounds := img.Bounds()
	w, h := fitSize(bounds.Dx(), bounds.Dy(), size)
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return ThumbnailResult{}, err
	}
	if err := os.WriteFile(target, buf.Bytes(), 0o644); err != nil {
		return ThumbnailResult{}, err
	}
	if err := os.Chmod(target, 0o644); err != nil {
		return ThumbnailResult{}, err
	}
	return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: int64(buf.Len())}, nil
}

func EstimateOptimization(path string, meta Metadata, sizeBytes int64, thresholds OptimizationThresholds) []Optimization {
	ext := strings.ToLower(filepath.Ext(path))
	var out []Optimization
	warningBytes := int64(thresholds.FileSizeWarningKB) * 1024
	criticalBytes := int64(thresholds.FileSizeCriticalKB) * 1024

	if ext == ".svg" {
		if analysis, ok := analyzeSVG(path, sizeBytes, thresholds.SVGMinSavingsPercent); ok {
			if warningBytes > 0 && sizeBytes > warningBytes {
				if analysis.HasEmbeddedRaster {
					out = append(out, Optimization{
						Category:       "format",
						Severity:       fileSizeSeverity(sizeBytes, criticalBytes),
						ReasonCode:     "svg_contains_embedded_raster",
						Reason:         "SVG contains embedded raster image data; minifying XML will not meaningfully reduce the embedded bitmap.",
						SuggestionCode: "extract_embedded_raster_or_use_modern_format",
						Suggestion:     "Extract the raster image and use WebP, AVIF, or PNG instead of wrapping it in SVG.",
					})
				} else if !analysis.CanMinify {
					out = append(out, Optimization{
						Category:       "format",
						Severity:       fileSizeSeverity(sizeBytes, criticalBytes),
						ReasonCode:     "svg_large_low_minify_savings",
						Reason:         "Large SVG has low XML minification savings; size is likely driven by path complexity or raster-like content.",
						SuggestionCode: "review_complex_svg_or_raster_format",
						Suggestion:     "Simplify the vector artwork, or export it as WebP or AVIF when it is raster-like.",
					})
				}
			}
			if analysis.CanMinify && !analysis.HasEmbeddedRaster {
				out = append(out, analysis.Minify)
			}
		}
		return out
	}

	if thresholds.MaxDimensionPx > 0 && (meta.Width > thresholds.MaxDimensionPx || meta.Height > thresholds.MaxDimensionPx) {
		out = append(out, Optimization{
			Category:       "dimensions",
			Severity:       "warning",
			ReasonCode:     "image_dimensions_large",
			Reason:         "Image dimensions are larger than common web display sizes.",
			SuggestionCode: "use_responsive_or_smaller_source",
			Suggestion:     "Consider responsive variants or a smaller source image.",
		})
	}
	if warningBytes > 0 && sizeBytes > warningBytes {
		out = append(out, Optimization{
			Category:       "size",
			Severity:       fileSizeSeverity(sizeBytes, criticalBytes),
			ReasonCode:     "asset_file_large",
			Reason:         "Large assets can slow down initial route loading.",
			SuggestionCode: "review_compression_or_modern_format",
			Suggestion:     "Review compression or modern image formats.",
		})
	}
	if ext == ".png" && meta.Alpha {
		out = append(out, Optimization{
			Category:       "format",
			Severity:       "info",
			ReasonCode:     "png_with_alpha",
			Reason:         "PNG with alpha can be more efficiently stored as WebP.",
			SuggestionCode: "try_alpha_preserving_format",
			Suggestion:     "Try WebP format which supports alpha with better compression.",
		})
	}
	if thresholds.PNGAlphaCheckEnabled && ext == ".png" && !meta.Alpha {
		out = append(out, Optimization{
			Category:       "format",
			Severity:       "info",
			ReasonCode:     "png_without_alpha",
			Reason:         "PNG without alpha often compresses better as JPEG, WebP, or AVIF.",
			SuggestionCode: "try_modern_photographic_format",
			Suggestion:     "Try a photographic format for non-transparent raster images.",
		})
	}
	return out
}

func CacheKey(projectID, repoPath string, size, mtimeUnixNano int64) string {
	sum := blake3.Sum256([]byte(projectID + "\x00" + repoPath + "\x00" + strconv.FormatInt(size, 10) + "\x00" + strconv.FormatInt(mtimeUnixNano, 10)))
	return hex.EncodeToString(sum[:])
}

func probeGIF(path string) (Metadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return Metadata{Format: "gif", ErrorCode: "image_open_failed", Error: err.Error()}, err
	}
	defer file.Close()
	meta, err := probeGIFMetadata(file)
	if err != nil {
		meta.ErrorCode = "image_probe_failed"
		meta.Error = err.Error()
		return meta, err
	}
	return meta, nil
}

func probeGIFMetadata(r io.Reader) (Metadata, error) {
	var header [13]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Metadata{Format: "gif"}, err
	}
	if string(header[:3]) != "GIF" || (string(header[3:6]) != "87a" && string(header[3:6]) != "89a") {
		return Metadata{Format: "gif"}, errors.New("not a gif image")
	}
	meta := Metadata{
		Format: "gif",
		Width:  int(binary.LittleEndian.Uint16(header[6:8])),
		Height: int(binary.LittleEndian.Uint16(header[8:10])),
	}
	if header[10]&0x80 != 0 {
		if err := skipBytes(r, gifColorTableBytes(header[10])); err != nil {
			return meta, err
		}
	}
	for {
		block, err := readByte(r)
		if err != nil {
			return meta, err
		}
		switch block {
		case 0x2c:
			if err := readGIFImageBlock(r, &meta); err != nil {
				return meta, err
			}
		case 0x21:
			if err := readGIFExtensionBlock(r, &meta); err != nil {
				return meta, err
			}
		case 0x3b:
			meta.Animated = meta.Pages > 1
			return meta, nil
		default:
			return meta, fmt.Errorf("unknown gif block 0x%02x", block)
		}
	}
}

func readGIFImageBlock(r io.Reader, meta *Metadata) error {
	var descriptor [9]byte
	if _, err := io.ReadFull(r, descriptor[:]); err != nil {
		return err
	}
	meta.Pages++
	if descriptor[8]&0x80 != 0 {
		if err := skipBytes(r, gifColorTableBytes(descriptor[8])); err != nil {
			return err
		}
	}
	if _, err := readByte(r); err != nil {
		return err
	}
	return skipGIFSubBlocks(r)
}

func readGIFExtensionBlock(r io.Reader, meta *Metadata) error {
	label, err := readByte(r)
	if err != nil {
		return err
	}
	for {
		size, err := readByte(r)
		if err != nil {
			return err
		}
		if size == 0 {
			return nil
		}
		data := make([]byte, int(size))
		if _, err := io.ReadFull(r, data); err != nil {
			return err
		}
		if label == 0xf9 && len(data) > 0 && data[0]&0x01 != 0 {
			meta.Alpha = true
		}
	}
}

func skipGIFSubBlocks(r io.Reader) error {
	for {
		size, err := readByte(r)
		if err != nil {
			return err
		}
		if size == 0 {
			return nil
		}
		if err := skipBytes(r, int(size)); err != nil {
			return err
		}
	}
}

func gifColorTableBytes(packed byte) int {
	return 3 * (1 << ((packed & 0x07) + 1))
}

func readByte(r io.Reader) (byte, error) {
	var b [1]byte
	_, err := io.ReadFull(r, b[:])
	return b[0], err
}

func skipBytes(r io.Reader, n int) error {
	_, err := io.CopyN(io.Discard, r, int64(n))
	return err
}

func probeSVG(path string) (Metadata, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return Metadata{Format: "svg", ErrorCode: "image_open_failed", Error: err.Error()}, err
	}
	var root struct {
		XMLName xml.Name `xml:"svg"`
		Width   string   `xml:"width,attr"`
		Height  string   `xml:"height,attr"`
		ViewBox string   `xml:"viewBox,attr"`
	}
	if err := xml.Unmarshal(bytes, &root); err != nil {
		return Metadata{Format: "svg", ErrorCode: "image_probe_failed", Error: err.Error()}, err
	}
	if root.XMLName.Local != "svg" {
		return Metadata{Format: "svg", ErrorCode: "image_not_svg", Error: "not an svg document"}, errors.New("not an svg document")
	}
	w := parseSVGLength(root.Width)
	h := parseSVGLength(root.Height)
	if (w == 0 || h == 0) && root.ViewBox != "" {
		parts := strings.Fields(strings.ReplaceAll(root.ViewBox, ",", " "))
		if len(parts) == 4 {
			w = parseSVGLength(parts[2])
			h = parseSVGLength(parts[3])
		}
	}
	return Metadata{Format: "svg", Width: w, Height: h, Pages: 1, Alpha: true}, nil
}

func decodeRaster(path string) (image.Image, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".svg" {
		return rasterizeSVG(path, 256)
	}
	if ext == ".heic" || ext == ".heif" {
		return decodeHEIC(path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	return img, err
}

func rasterizeSVG(path string, maxSize int) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	icon, err := oksvg.ReadIconStream(file, oksvg.WarnErrorMode)
	if err != nil {
		return nil, err
	}
	w, h := fitSize(int(math.Round(icon.ViewBox.W)), int(math.Round(icon.ViewBox.H)), maxSize)
	if w <= 0 || h <= 0 {
		w, h = maxSize, maxSize
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	icon.SetTarget(0, 0, float64(w), float64(h))
	scanner := rasterx.NewScannerGV(w, h, img, img.Bounds())
	raster := rasterx.NewDasher(w, h, scanner)
	icon.Draw(raster, 1.0)
	return img, nil
}

func normalizeFormat(format, ext string) string {
	extLower := strings.TrimPrefix(strings.ToLower(ext), ".")
	if format == "heic" && extLower == "avif" {
		return "avif"
	}
	if format != "" {
		return format
	}
	return extLower
}

func imageHasAlpha(img image.Image) bool {
	if img == nil {
		return false
	}
	switch img.(type) {
	case *image.NRGBA, *image.NRGBA64, *image.RGBA, *image.RGBA64, *image.Alpha, *image.Alpha16:
		bounds := img.Bounds()
		stepX := max(1, bounds.Dx()/32)
		stepY := max(1, bounds.Dy()/32)
		for y := bounds.Min.Y; y < bounds.Max.Y; y += stepY {
			for x := bounds.Min.X; x < bounds.Max.X; x += stepX {
				_, _, _, a := img.At(x, y).RGBA()
				if a < 0xffff {
					return true
				}
			}
		}
	}
	return false
}

func flipHorizontal(src image.Image) image.Image {
	bounds := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	for y := 0; y < bounds.Dy(); y++ {
		for x := 0; x < bounds.Dx(); x++ {
			dst.Set(bounds.Dx()-1-x, y, src.At(bounds.Min.X+x, bounds.Min.Y+y))
		}
	}
	return dst
}

func fitSize(width, height, maxSize int) (int, int) {
	if width <= 0 || height <= 0 {
		return 1, 1
	}
	scale := math.Min(float64(maxSize)/float64(width), float64(maxSize)/float64(height))
	if scale > 1 {
		scale = 1
	}
	return max(1, int(math.Round(float64(width)*scale))), max(1, int(math.Round(float64(height)*scale)))
}

type svgOptimizationAnalysis struct {
	CanMinify         bool
	HasEmbeddedRaster bool
	Minify            Optimization
}

func analyzeSVG(path string, sizeBytes int64, minSavingsPercent int) (svgOptimizationAnalysis, bool) {
	bytes, err := os.ReadFile(path)
	if err != nil || len(bytes) == 0 {
		return svgOptimizationAnalysis{}, false
	}
	analysis := svgOptimizationAnalysis{HasEmbeddedRaster: svgContainsEmbeddedRaster(bytes)}
	effectiveSize := sizeBytes
	if effectiveSize <= 0 {
		effectiveSize = int64(len(bytes))
	}
	m := minify.New()
	m.AddFunc("image/svg+xml", minifysvg.Minify)
	minified, err := m.Bytes("image/svg+xml", bytes)
	if err != nil || len(minified) >= len(bytes) {
		return analysis, true
	}
	savings := effectiveSize - int64(len(minified))
	if savings <= 0 {
		return analysis, true
	}
	if effectiveSize > 0 && minSavingsPercent > 0 {
		pct := float64(savings) * 100 / float64(effectiveSize)
		if pct < float64(minSavingsPercent) {
			return analysis, true
		}
	}
	analysis.CanMinify = true
	analysis.Minify = Optimization{
		Category:       "svg-minify",
		Severity:       "info",
		ReasonCode:     "svg_can_minify",
		Reason:         "SVG can be minified without changing source references.",
		SuggestionCode: "preview_svg_minify",
		Suggestion:     "Preview minified SVG output before applying in a separate optimization workflow.",
		EstimatedBytes: int64(len(minified)),
		SavingsBytes:   savings,
	}
	return analysis, true
}

func svgContainsEmbeddedRaster(bytes []byte) bool {
	lower := strings.ToLower(string(bytes))
	if !strings.Contains(lower, "<image") {
		return false
	}
	for _, mime := range []string{"data:image/png", "data:image/jpeg", "data:image/jpg", "data:image/webp", "data:image/gif", "data:image/avif", "data:image/bmp", "data:image/tiff"} {
		if strings.Contains(lower, mime) {
			return true
		}
	}
	return false
}

func fileSizeSeverity(sizeBytes, criticalBytes int64) string {
	if criticalBytes > 0 && sizeBytes > criticalBytes {
		return "critical"
	}
	return "warning"
}

func parseSVGLength(value string) int {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, "px")
	value = strings.TrimSuffix(value, "pt")
	value = strings.TrimSuffix(value, "em")
	if value == "" {
		return 0
	}
	f, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return int(math.Round(f))
}

func ImageToPNG(path string, svgMaxSize int) ([]byte, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".svg" {
		if data, err := svgToPNGViaImgtools(path, svgMaxSize); err == nil {
			return data, nil
		}
		img, err := rasterizeSVG(path, svgMaxSize)
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", filepath.Base(path), err)
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return nil, fmt.Errorf("encode png: %w", err)
		}
		return buf.Bytes(), nil
	}
	if ext == ".heic" || ext == ".heif" {
		if data, err := HeicToPNG(path); err == nil {
			return data, nil
		}
	}
	f, ferr := os.Open(path)
	if ferr != nil {
		return nil, ferr
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", filepath.Base(path), err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return buf.Bytes(), nil
}

func heicToPNGSystem(path string) ([]byte, error) {
	tmp, err := os.CreateTemp("", "heicpng-*.png")
	if err != nil {
		return nil, err
	}
	target := tmp.Name()
	tmp.Close()
	defer os.Remove(target)
	if bin, err := exec.LookPath("sips"); err == nil {
		if _, err := exec.Command(bin, "--setProperty", "format", "png", path, "--out", target).CombinedOutput(); err == nil {
			return os.ReadFile(target)
		}
	}
	if bin, err := exec.LookPath("heif-convert"); err == nil {
		if _, err := exec.Command(bin, "-q", "100", path, target).CombinedOutput(); err == nil {
			return os.ReadFile(target)
		}
	}
	return nil, fmt.Errorf("no system HEIC tool available")
}

func svgToPNGViaImgtools(path string, maxSize int) ([]byte, error) {
	tmp, err := os.CreateTemp("", "imgtools-svg-*.png")
	if err != nil {
		return nil, err
	}
	target := tmp.Name()
	tmp.Close()
	defer os.Remove(target)
	if err := runImgtoolsExec("svg-to-png", "--max-size", strconv.Itoa(maxSize), path, target); err != nil {
		return nil, err
	}
	return os.ReadFile(target)
}

func safeCacheName(key string) string {
	sum := blake3.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func RegisterStandardEncoders() {
	image.RegisterFormat("png", "png", png.Decode, png.DecodeConfig)
	image.RegisterFormat("jpeg", "\xff\xd8", jpeg.Decode, jpeg.DecodeConfig)
	image.RegisterFormat("gif", "GIF8?a", gif.Decode, gif.DecodeConfig)
}

func solidImage(width, height int, c color.Color) image.Image {
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: c}, image.Point{}, draw.Src)
	return dst
}

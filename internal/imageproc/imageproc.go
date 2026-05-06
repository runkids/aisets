package imageproc

import (
	"bytes"
	"encoding/hex"
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
	"path/filepath"
	"strconv"
	"strings"

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

type ThumbnailResult struct {
	Path      string `json:"path"`
	CacheHit  bool   `json:"cacheHit"`
	MimeType  string `json:"mimeType"`
	CacheKey  string `json:"cacheKey"`
	SizeBytes int64  `json:"sizeBytes"`
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

	file, err := os.Open(path)
	if err != nil {
		return Metadata{ErrorCode: "image_open_failed", Error: err.Error()}, err
	}
	defer file.Close()

	cfg, format, err := image.DecodeConfig(file)
	if err != nil {
		return Metadata{Format: strings.TrimPrefix(ext, "."), ErrorCode: "image_probe_failed", Error: err.Error()}, err
	}
	meta := Metadata{Format: normalizeFormat(format, ext), Width: cfg.Width, Height: cfg.Height, Pages: 1}
	_, _ = file.Seek(0, io.SeekStart)
	img, _, decodeErr := image.Decode(file)
	if decodeErr == nil {
		meta.Alpha = imageHasAlpha(img)
	}
	return meta, nil
}

func DHash(path string) (Hashes, error) {
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
		return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: int64(buf.Len())}, nil
	}

	target := filepath.Join(cacheDir, safeCacheName(cacheKey)+".png")
	if info, err := os.Stat(target); err == nil {
		return ThumbnailResult{Path: target, CacheHit: true, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: info.Size()}, nil
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
	return ThumbnailResult{Path: target, MimeType: "image/png", CacheKey: cacheKey, SizeBytes: int64(buf.Len())}, nil
}

func EstimateOptimization(path string, meta Metadata, sizeBytes int64) []Optimization {
	ext := strings.ToLower(filepath.Ext(path))
	var out []Optimization
	if ext == ".svg" {
		if suggestion, ok := estimateSVG(path, sizeBytes); ok {
			out = append(out, suggestion)
		}
	}
	if meta.Width > 2400 || meta.Height > 2400 {
		out = append(out, Optimization{
			Category:       "dimensions",
			Severity:       "warning",
			ReasonCode:     "image_dimensions_large",
			Reason:         "Image dimensions are larger than common web display sizes.",
			SuggestionCode: "use_responsive_or_smaller_source",
			Suggestion:     "Consider responsive variants or a smaller source image.",
		})
	}
	if sizeBytes > 500*1024 {
		severity := "warning"
		if sizeBytes > 1024*1024 {
			severity = "critical"
		}
		out = append(out, Optimization{
			Category:       "size",
			Severity:       severity,
			ReasonCode:     "asset_file_large",
			Reason:         "Large assets can slow down initial route loading.",
			SuggestionCode: "review_compression_or_modern_format",
			Suggestion:     "Review compression or modern image formats.",
		})
	}
	if ext == ".png" && !meta.Alpha {
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
	g, err := gif.DecodeAll(file)
	if err != nil {
		return Metadata{Format: "gif", ErrorCode: "image_probe_failed", Error: err.Error()}, err
	}
	meta := Metadata{Format: "gif", Pages: len(g.Image), Animated: len(g.Image) > 1}
	if len(g.Image) > 0 {
		bounds := g.Image[0].Bounds()
		meta.Width = bounds.Dx()
		meta.Height = bounds.Dy()
		meta.Alpha = imageHasAlpha(g.Image[0])
	}
	return meta, nil
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
	if strings.EqualFold(filepath.Ext(path), ".svg") {
		return rasterizeSVG(path, 256)
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
	if format != "" {
		return format
	}
	return strings.TrimPrefix(strings.ToLower(ext), ".")
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

func estimateSVG(path string, sizeBytes int64) (Optimization, bool) {
	bytes, err := os.ReadFile(path)
	if err != nil || len(bytes) == 0 {
		return Optimization{}, false
	}
	m := minify.New()
	m.AddFunc("image/svg+xml", minifysvg.Minify)
	minified, err := m.Bytes("image/svg+xml", bytes)
	if err != nil || len(minified) >= len(bytes) {
		return Optimization{}, false
	}
	savings := sizeBytes - int64(len(minified))
	if savings <= 0 {
		return Optimization{}, false
	}
	return Optimization{
		Category:       "svg-minify",
		Severity:       "info",
		ReasonCode:     "svg_can_minify",
		Reason:         "SVG can be minified without changing source references.",
		SuggestionCode: "preview_svg_minify",
		Suggestion:     "Preview minified SVG output before applying in a separate optimization workflow.",
		EstimatedBytes: int64(len(minified)),
		SavingsBytes:   savings,
	}, true
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

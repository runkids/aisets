package imageproc

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gen2brain/avif"
)

func TestProbePNGJPEGGIFSVGWebPAVIFAndCorrupt(t *testing.T) {
	root := t.TempDir()
	pngPath := filepath.Join(root, "sample.png")
	jpegPath := filepath.Join(root, "sample.jpg")
	gifPath := filepath.Join(root, "sample.gif")
	svgPath := filepath.Join(root, "sample.svg")
	webpPath := filepath.Join(root, "sample.webp")
	avifPath := filepath.Join(root, "sample.avif")
	corruptPath := filepath.Join(root, "corrupt.png")

	writePNG(t, pngPath, checkerImage(16, 12, false))
	writeJPEG(t, jpegPath, checkerImage(20, 10, false))
	writeGIF(t, gifPath)
	mustWrite(t, svgPath, `<svg width="32" height="24" viewBox="0 0 32 24"><rect width="32" height="24"/></svg>`)
	writeTinyWebP(t, webpPath)
	writeAVIF(t, avifPath, checkerImage(6, 5, false))
	mustWrite(t, corruptPath, `not an image`)

	tests := []struct {
		path   string
		format string
		width  int
		height int
		pages  int
	}{
		{pngPath, "png", 16, 12, 1},
		{jpegPath, "jpeg", 20, 10, 1},
		{gifPath, "gif", 2, 2, 2},
		{svgPath, "svg", 32, 24, 1},
		{webpPath, "webp", 1, 1, 1},
		{avifPath, "avif", 6, 5, 1},
	}
	for _, tt := range tests {
		meta, err := Probe(tt.path)
		if err != nil {
			t.Fatalf("Probe(%s): %v", filepath.Base(tt.path), err)
		}
		if meta.Format != tt.format || meta.Width != tt.width || meta.Height != tt.height || meta.Pages != tt.pages {
			t.Fatalf("Probe(%s) = %#v", filepath.Base(tt.path), meta)
		}
	}
	meta, err := Probe(corruptPath)
	if err == nil {
		t.Fatal("expected corrupt image error")
	}
	if meta.Error == "" {
		t.Fatalf("corrupt metadata did not preserve error: %#v", meta)
	}
	if meta.ErrorCode != "image_probe_failed" {
		t.Fatalf("corrupt metadata error code = %q", meta.ErrorCode)
	}
}

func TestDHashAndMirroredHash(t *testing.T) {
	root := t.TempDir()
	original := filepath.Join(root, "original.png")
	mirrored := filepath.Join(root, "mirrored.png")
	img := asymmetricImage(16, 16)
	writePNG(t, original, img)
	writePNG(t, mirrored, flipHorizontal(img))

	hashes, err := DHash(original)
	if err != nil {
		t.Fatal(err)
	}
	again, err := DHash(original)
	if err != nil {
		t.Fatal(err)
	}
	if hashes.DHash != again.DHash {
		t.Fatalf("same image hash changed: %s != %s", hashes.DHash, again.DHash)
	}
	mirroredHashes, err := DHash(mirrored)
	if err != nil {
		t.Fatal(err)
	}
	distance, ok := DistanceHex(hashes.DHash, mirroredHashes.DHashFlipped)
	if !ok || distance != 0 {
		t.Fatalf("mirrored image flipped distance = %d, ok=%v", distance, ok)
	}
}

func TestSVGThumbnailAndDHashUseGoRasterizer(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "icon.svg")
	cacheDir := filepath.Join(root, "thumbs")
	mustWrite(t, path, `<svg width="16" height="16" viewBox="0 0 16 16"><rect width="8" height="16" fill="black"/><rect x="8" width="8" height="16" fill="white"/></svg>`)

	hashes, err := DHash(path)
	if err != nil {
		t.Fatal(err)
	}
	if hashes.DHash == "" || hashes.DHashFlipped == "" {
		t.Fatalf("svg hashes = %#v", hashes)
	}
	thumb, err := Thumbnail(path, cacheDir, "svg-key", 8)
	if err != nil {
		t.Fatal(err)
	}
	if thumb.MimeType != "image/png" || thumb.CacheHit {
		t.Fatalf("svg thumbnail = %#v", thumb)
	}
}

func TestThumbnailLazyCacheReuse(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "sample.png")
	cacheDir := filepath.Join(root, "thumbs")
	writePNG(t, path, checkerImage(32, 16, false))

	first, err := Thumbnail(path, cacheDir, "asset-key", 8)
	if err != nil {
		t.Fatal(err)
	}
	if first.CacheHit {
		t.Fatal("first thumbnail should not be cache hit")
	}
	info, err := os.Stat(first.Path)
	if err != nil {
		t.Fatal(err)
	}
	mtime := info.ModTime()
	time.Sleep(10 * time.Millisecond)
	second, err := Thumbnail(path, cacheDir, "asset-key", 8)
	if err != nil {
		t.Fatal(err)
	}
	if !second.CacheHit || second.Path != first.Path {
		t.Fatalf("second thumbnail = %#v, first = %#v", second, first)
	}
	info, err = os.Stat(second.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(mtime) {
		t.Fatal("cache hit rewrote thumbnail")
	}
}

func TestSVGMinifyEstimate(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "verbose.svg")
	content := `<svg width="10" height="10">
  <g>
    <rect x="0" y="0" width="10" height="10" fill="red"></rect>
  </g>
</svg>`
	mustWrite(t, path, content)
	meta, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	out := EstimateOptimization(path, meta, int64(len(content)))
	if len(out) == 0 || out[0].Category != "svg-minify" || out[0].SavingsBytes <= 0 {
		t.Fatalf("EstimateOptimization = %#v", out)
	}
	if out[0].ReasonCode != "svg_can_minify" || out[0].SuggestionCode != "preview_svg_minify" {
		t.Fatalf("optimization codes = %#v", out[0])
	}
}

func TestRasterOptimizationDistanceAndCacheHelpers(t *testing.T) {
	out := EstimateOptimization("large.png", Metadata{Width: 3000, Height: 1200, Alpha: false}, 2*1024*1024)
	if len(out) != 3 {
		t.Fatalf("EstimateOptimization raster = %#v", out)
	}
	if out[0].Category != "dimensions" || out[1].Severity != "critical" || out[2].SuggestionCode != "try_modern_photographic_format" {
		t.Fatalf("optimization order/codes = %#v", out)
	}

	if CacheKey("p", "a.png", 1, 2) != CacheKey("p", "a.png", 1, 2) || CacheKey("p", "a.png", 1, 2) == CacheKey("p", "b.png", 1, 2) {
		t.Fatal("CacheKey did not behave deterministically")
	}
	if dist, ok := DistanceHex("0f", "00"); !ok || dist != 4 {
		t.Fatalf("DistanceHex valid = %d, %v", dist, ok)
	}
	for _, pair := range [][2]string{{"10000000000000000", "00"}, {"zz", "00"}} {
		if _, ok := DistanceHex(pair[0], pair[1]); ok {
			t.Fatalf("DistanceHex(%q, %q) unexpectedly ok", pair[0], pair[1])
		}
	}
}

func TestGeometrySVGAndEncoderHelpers(t *testing.T) {
	if w, h := fitSize(100, 50, 10); w != 10 || h != 5 {
		t.Fatalf("fitSize scaled = %dx%d", w, h)
	}
	if w, h := fitSize(0, 0, 10); w != 1 || h != 1 {
		t.Fatalf("fitSize invalid = %dx%d", w, h)
	}
	if got := parseSVGLength("10.6px"); got != 11 {
		t.Fatalf("parseSVGLength px = %d", got)
	}
	if got := parseSVGLength("bad"); got != 0 {
		t.Fatalf("parseSVGLength bad = %d", got)
	}
	if safeCacheName("key") == safeCacheName("other") {
		t.Fatal("safeCacheName should vary by key")
	}
	RegisterStandardEncoders()
	img := solidImage(2, 3, color.NRGBA{R: 1, G: 2, B: 3, A: 255})
	if img.Bounds().Dx() != 2 || img.Bounds().Dy() != 3 {
		t.Fatalf("solidImage bounds = %v", img.Bounds())
	}
}

func checkerImage(width, height int, alpha bool) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			c := color.NRGBA{R: 220, G: 30, B: 80, A: 255}
			if (x+y)%2 == 0 {
				c = color.NRGBA{R: 20, G: 180, B: 220, A: 255}
			}
			if alpha && x == 0 {
				c.A = 120
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func asymmetricImage(width, height int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.NRGBA{R: 250, G: 250, B: 250, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(0, 0, 6, height), &image.Uniform{C: color.NRGBA{R: 20, G: 20, B: 20, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(10, 4, 14, 12), &image.Uniform{C: color.NRGBA{R: 150, G: 20, B: 20, A: 255}}, image.Point{}, draw.Src)
	return img
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}

func writeJPEG(t *testing.T, path string, img image.Image) {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}

func writeGIF(t *testing.T, path string) {
	t.Helper()
	palette := []color.Color{color.Black, color.White}
	frame1 := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	frame2 := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	frame2.SetColorIndex(1, 1, 1)
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{Image: []*image.Paletted{frame1, frame2}, Delay: []int{1, 1}}); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}

func writeTinyWebP(t *testing.T, path string) {
	t.Helper()
	bytes, err := base64.StdEncoding.DecodeString("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, bytes)
}

func writeAVIF(t *testing.T, path string, img image.Image) {
	t.Helper()
	var buf bytes.Buffer
	if err := avif.Encode(&buf, img, avif.Options{Quality: 90, Speed: 10}); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	mustWriteBytes(t, path, []byte(content))
}

func mustWriteBytes(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

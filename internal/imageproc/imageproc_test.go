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
	out := EstimateOptimization(path, meta, int64(len(content)), DefaultOptimizationThresholds())
	if len(out) == 0 || out[0].Category != "svg-minify" || out[0].SavingsBytes <= 0 {
		t.Fatalf("EstimateOptimization = %#v", out)
	}
	if out[0].ReasonCode != "svg_can_minify" || out[0].SuggestionCode != "preview_svg_minify" {
		t.Fatalf("optimization codes = %#v", out[0])
	}
}

func TestRasterOptimizationDistanceAndCacheHelpers(t *testing.T) {
	out := EstimateOptimization("large.png", Metadata{Width: 3000, Height: 1200, Alpha: false}, 2*1024*1024, DefaultOptimizationThresholds())
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

func TestOptimizationThresholds(t *testing.T) {
	t.Run("dimensions below threshold", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		out := EstimateOptimization("img.png", Metadata{Width: 2500, Height: 1000, Alpha: true}, 1024, th)
		for _, o := range out {
			if o.Category == "dimensions" {
				t.Fatal("2500px should not trigger dimensions warning with default 2560px threshold")
			}
		}
	})
	t.Run("dimensions above threshold", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		th.MaxDimensionPx = 2400
		out := EstimateOptimization("img.png", Metadata{Width: 2500, Height: 1000, Alpha: true}, 1024, th)
		found := false
		for _, o := range out {
			if o.Category == "dimensions" {
				found = true
			}
		}
		if !found {
			t.Fatal("2500px should trigger dimensions warning with 2400px threshold")
		}
	})
	t.Run("dimensions disabled", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		th.MaxDimensionPx = 0
		out := EstimateOptimization("img.png", Metadata{Width: 5000, Height: 5000, Alpha: true}, 1024, th)
		for _, o := range out {
			if o.Category == "dimensions" {
				t.Fatal("dimensions check should be disabled when threshold is 0")
			}
		}
	})
	t.Run("file size warning", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		out := EstimateOptimization("img.jpg", Metadata{Width: 100, Height: 100}, 300*1024, th)
		found := false
		for _, o := range out {
			if o.Category == "size" && o.Severity == "warning" {
				found = true
			}
		}
		if !found {
			t.Fatal("300KB should trigger warning with default 200KB threshold")
		}
	})
	t.Run("file size below threshold", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		th.FileSizeWarningKB = 500
		out := EstimateOptimization("img.jpg", Metadata{Width: 100, Height: 100}, 300*1024, th)
		for _, o := range out {
			if o.Category == "size" {
				t.Fatal("300KB should not trigger with 500KB warning threshold")
			}
		}
	})
	t.Run("file size critical", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		out := EstimateOptimization("img.jpg", Metadata{Width: 100, Height: 100}, 600*1024, th)
		found := false
		for _, o := range out {
			if o.Category == "size" && o.Severity == "critical" {
				found = true
			}
		}
		if !found {
			t.Fatal("600KB should trigger critical with default 500KB critical threshold")
		}
	})
	t.Run("file size disabled", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		th.FileSizeWarningKB = 0
		out := EstimateOptimization("img.jpg", Metadata{Width: 100, Height: 100}, 10*1024*1024, th)
		for _, o := range out {
			if o.Category == "size" {
				t.Fatal("size check should be disabled when warning threshold is 0")
			}
		}
	})
	t.Run("png alpha enabled", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		out := EstimateOptimization("img.png", Metadata{Width: 100, Height: 100, Alpha: false}, 1024, th)
		found := false
		for _, o := range out {
			if o.Category == "format" {
				found = true
			}
		}
		if !found {
			t.Fatal("PNG without alpha should trigger format suggestion when enabled")
		}
	})
	t.Run("png alpha disabled", func(t *testing.T) {
		th := DefaultOptimizationThresholds()
		th.PNGAlphaCheckEnabled = false
		out := EstimateOptimization("img.png", Metadata{Width: 100, Height: 100, Alpha: false}, 1024, th)
		for _, o := range out {
			if o.Category == "format" {
				t.Fatal("PNG alpha check should be skipped when disabled")
			}
		}
	})
	t.Run("all disabled", func(t *testing.T) {
		th := OptimizationThresholds{
			SVGMinSavingsPercent: 100,
			MaxDimensionPx:       0,
			FileSizeWarningKB:    0,
			FileSizeCriticalKB:   0,
			PNGAlphaCheckEnabled: false,
		}
		out := EstimateOptimization("img.png", Metadata{Width: 5000, Height: 5000, Alpha: false}, 10*1024*1024, th)
		if len(out) != 0 {
			t.Fatalf("all thresholds disabled should produce no findings, got %d", len(out))
		}
	})
	t.Run("hash deterministic", func(t *testing.T) {
		a := DefaultOptimizationThresholds()
		b := DefaultOptimizationThresholds()
		if a.Hash() != b.Hash() {
			t.Fatal("same thresholds should produce same hash")
		}
		b.MaxDimensionPx = 1920
		if a.Hash() == b.Hash() {
			t.Fatal("different thresholds should produce different hash")
		}
	})
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

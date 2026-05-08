package ocr

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	runtimepkg "runtime"
	"strings"
	"testing"
)

type runtimeTestEngine struct{}

func (runtimeTestEngine) Name() string {
	return "test-ocr"
}

func (runtimeTestEngine) Version() string {
	return "test"
}

func (runtimeTestEngine) Extract(context.Context, string, []string) (Extraction, error) {
	return Extraction{}, nil
}

func (runtimeTestEngine) Available(context.Context) error {
	return nil
}

func TestRuntimeInstallStateAndRemove(t *testing.T) {
	root := t.TempDir()
	engine := runtimeTestEngine{}
	runtime := Runtime(t.Context(), root, engine)
	if runtime.Installed {
		t.Fatalf("runtime installed before packs exist: %#v", runtime)
	}
	if runtime.Platform != runtimepkg.GOOS {
		t.Fatalf("runtime platform = %q, want %q", runtime.Platform, runtimepkg.GOOS)
	}
	if len(runtime.AvailableLanguages) != len(languagePacks) {
		t.Fatalf("available languages = %#v", runtime.AvailableLanguages)
	}
	if err := os.MkdirAll(DataDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(PackPath(root, "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	runtime = Runtime(t.Context(), root, engine)
	if !runtime.Installed || !runtime.AvailableLanguages[0].Installed {
		t.Fatalf("runtime after pack = %#v", runtime)
	}
	packs, err := RemoveLanguagePacks(root, []string{"eng"})
	if err != nil {
		t.Fatal(err)
	}
	if packs[0].Installed {
		t.Fatalf("pack still installed = %#v", packs)
	}
	if _, err := os.Stat(filepath.Join(DataDir(root), "eng.traineddata")); !os.IsNotExist(err) {
		t.Fatalf("removed pack stat err = %v", err)
	}
}

func TestSettingsHashAndScriptDetection(t *testing.T) {
	settings := NormalizeSettings(Settings{Languages: []string{"chi_tra", "eng", "eng"}, MaxPixels: 100})
	if strings.Join(settings.Languages, ",") != "chi_tra,eng" {
		t.Fatalf("languages = %#v", settings.Languages)
	}
	a := SettingsHash(settings)
	b := SettingsHash(Settings{Languages: []string{"eng", "chi_tra"}, MaxPixels: 100, BatchSize: 10, Concurrency: 1})
	if a != b {
		t.Fatalf("settings hash changed with language order: %s != %s", a, b)
	}
	scripts := strings.Join(DetectScripts("Sale 活動 2026"), ",")
	if scripts != "han,latin,number" {
		t.Fatalf("scripts = %s", scripts)
	}
}

func TestTesseractEngineFixtureSmoke(t *testing.T) {
	root := os.Getenv("ASSET_STUDIO_OCR_TEST_DATA_ROOT")
	imagePath := os.Getenv("ASSET_STUDIO_OCR_TEST_IMAGE")
	if root == "" || imagePath == "" {
		t.Skip("set ASSET_STUDIO_OCR_TEST_DATA_ROOT and ASSET_STUDIO_OCR_TEST_IMAGE to run engine smoke test")
	}
	result, err := NewDefaultEngine(root).Extract(t.Context(), imagePath, []string{"eng"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(result.Text) == "" {
		t.Fatalf("empty OCR text: %#v", result)
	}
}

func TestTesseractEngineGameLogoFixtures(t *testing.T) {
	root := os.Getenv("ASSET_STUDIO_OCR_TEST_DATA_ROOT")
	if root == "" {
		t.Skip("set ASSET_STUDIO_OCR_TEST_DATA_ROOT to run game logo OCR fixture tests")
	}
	fixtures := []struct {
		path string
		want string
	}{
		{filepath.Join("..", "..", "demo", "202605080012", "jdb", "0-121001.png"), "mahjong"},
		{filepath.Join("..", "..", "demo", "202605080012", "jdb", "0-14080.png"), "fire"},
		{filepath.Join("..", "..", "demo", "英", "对战", "PTG0086_二人雀神EN.png"), "mahjong"},
		{filepath.Join("..", "..", "demo", "英", "百人", "PTG0008_豪车漂移EN.png"), "racing"},
		{filepath.Join("..", "..", "demo", "英", "对战", "PTG0037_德州扑克EN.png"), "texas"},
		{filepath.Join("..", "..", "demo", "英", "捕鱼", "PTG0056_3D捕鱼EN.png"), "fishing"},
		{filepath.Join("..", "..", "demo", "英", "百人", "PTG0067_3D森林舞会EN.png"), "forest"},
	}
	for _, fixture := range fixtures {
		t.Run(filepath.Base(fixture.path), func(t *testing.T) {
			if _, err := os.Stat(fixture.path); err != nil {
				t.Skipf("fixture unavailable: %v", err)
			}
			result, err := NewDefaultEngine(root).Extract(t.Context(), fixture.path, []string{"eng"})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(NormalizeText(result.Text), fixture.want) {
				t.Fatalf("OCR text does not contain %q: %#v", fixture.want, result)
			}
		})
	}
}

func TestTesseractEngineUsesBoundedFallbackWhenDefaultIsEmpty(t *testing.T) {
	if runtimepkg.GOOS == "windows" {
		t.Skip("fake tesseract script uses POSIX shell")
	}
	root := t.TempDir()
	if err := os.MkdirAll(DataDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(PackPath(root, "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(root, "fixture.png")
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, color.White)
		}
	}
	file, err := os.Create(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, img); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	fakeBinary := filepath.Join(root, "fake-tesseract")
	script := `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "tesseract 5.3.0"
  exit 0
fi
case "$*" in
  *"--psm 6"*) echo "2-8 BAR" ;;
esac
`
	if err := os.WriteFile(fakeBinary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	extraction, err := TesseractCLIEngine{DataRoot: root, Binary: fakeBinary, version: "test"}.Extract(t.Context(), imagePath, []string{"eng"})
	if err != nil {
		t.Fatal(err)
	}
	if extraction.Text != "2-8 BAR" || extraction.Mode != "psm_6_logo_light" || extraction.Attempts != MaxExtractionAttempts {
		t.Fatalf("extraction = %#v", extraction)
	}
}

func TestTesseractEngineVersionIncludesPipelineVersion(t *testing.T) {
	version := (TesseractCLIEngine{version: "tesseract 5.3.0"}).Version()
	if !strings.Contains(version, assetStudioOCRPipelineVersion) {
		t.Fatalf("version %q does not include pipeline version", version)
	}
}

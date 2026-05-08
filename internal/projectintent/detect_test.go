package projectintent

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"asset-studio/internal/scanner"
)

func TestDetectAssetPack(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "icons", "a.png"), "png")
	mustWrite(t, filepath.Join(root, "icons", "b.svg"), "<svg/>")

	detection, err := Detect(context.Background(), root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if detection.SuggestedScanIntent != SuggestedScanIntentAssetPack || detection.ReferenceCoverage != scanner.ReferenceCoverageNotApplicable {
		t.Fatalf("detection = %#v", detection)
	}
}

func TestDetectHonorsPlainFilenameExcludePattern(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "icons", "asset-studio-logo.png"), "png")

	detection, err := Detect(context.Background(), root, []string{"asset-studio-logo.png"})
	if err != nil {
		t.Fatal(err)
	}
	if detection.Counts.SampledFiles != 0 || detection.SuggestedScanIntent != SuggestedScanIntentUnknown {
		t.Fatalf("detection = %#v, want excluded file to be ignored", detection)
	}
}

func TestDetectFrontendCodeProject(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "package.json"), `{"dependencies":{"vite":"latest"}}`)
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "logo.png"), "png")

	detection, err := Detect(context.Background(), root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if detection.SuggestedScanIntent != SuggestedScanIntentCode || detection.ReferenceCoverage != scanner.ReferenceCoverageSupported {
		t.Fatalf("detection = %#v", detection)
	}
}

func TestDetectBackendPartialCoverage(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "go.mod"), "module example.com/app")
	mustWrite(t, filepath.Join(root, "cmd", "app", "main.go"), "package main")

	detection, err := Detect(context.Background(), root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if detection.SuggestedScanIntent != SuggestedScanIntentCode || detection.ReferenceCoverage != scanner.ReferenceCoveragePartial {
		t.Fatalf("detection = %#v", detection)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

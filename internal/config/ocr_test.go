package config

import (
	"path/filepath"
	"testing"

	"asset-studio/internal/ocr"
)

func TestOCRResultForContentHashReusesOnlyReadyResults(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	settings := OCRSettingsFromApp(DefaultAppSettings())
	engineName := "test-ocr"
	engineVersion := "test"
	settingsHash := ocr.SettingsHash(settings)
	ready := ocr.Result{
		ProjectID:     "project-a",
		RepoPath:      "assets/a.png",
		ContentHash:   "shared-hash",
		HashAlgorithm: "blake3",
		EngineName:    engineName,
		EngineVersion: engineVersion,
		SettingsHash:  settingsHash,
		Status:        ocr.StatusReady,
		Text:          "Sale 活動",
		Languages:     []string{"eng", "chi_tra"},
		Scripts:       []string{"han", "latin"},
		DurationMs:    42,
		Attempts:      1,
	}
	if err := store.UpsertOCRResult(ready); err != nil {
		t.Fatal(err)
	}

	got, ok, err := store.OCRResultForContentHash("shared-hash", "blake3", settings, engineName, engineVersion)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.ProjectID != ready.ProjectID || got.RepoPath != ready.RepoPath || got.Text != ready.Text || got.NormalizedText != "sale 活動" {
		t.Fatalf("hash OCR result = %#v, ok=%v", got, ok)
	}

	changedSettings := settings
	changedSettings.MaxPixels++
	if got, ok, err := store.OCRResultForContentHash("shared-hash", "blake3", changedSettings, engineName, engineVersion); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatalf("changed settings should not reuse OCR result: %#v", got)
	}

	failed := ready
	failed.RepoPath = "assets/failed.png"
	failed.ContentHash = "failed-hash"
	failed.Status = ocr.StatusFailed
	failed.Text = ""
	failed.ErrorCode = "ocr_extract_failed"
	if err := store.UpsertOCRResult(failed); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := store.OCRResultForContentHash("failed-hash", "blake3", settings, engineName, engineVersion); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatalf("failed result should not be reusable by hash: %#v", got)
	}
}

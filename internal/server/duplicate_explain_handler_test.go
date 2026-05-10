package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aisets/internal/config"
	"aisets/internal/scanner"
)

func TestDuplicateExplain_MissingParams(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		url  string
	}{
		{"no params", "/api/ai/duplicate-explain"},
		{"only leftId", "/api/ai/duplicate-explain?leftId=a"},
		{"only rightId", "/api/ai/duplicate-explain?rightId=b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("POST", tc.url, nil)
			s.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
	_ = root
}

func TestDuplicateExplain_AINotConfigured(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/duplicate-explain?leftId=a&rightId=b", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (AI not configured), got %d: %s", rec.Code, rec.Body.String())
	}
	_ = root
}

func TestDuplicateExplain_AssetNotFound(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	enabled := true
	provider := "ollama"
	endpoint := "http://localhost:11434"
	model := "moondream"
	store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:     &enabled,
		LLMProvider:    &provider,
		LLMEndpoint:    &endpoint,
		LLMVisionModel: &model,
	})

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-10T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: filepath.Join(root, "proj")}},
		Items:       []scanner.AssetItem{serverScanAsset(root, "img/a.png", 5000, "aaa", 1)},
		Stats:       scanner.CatalogStats{TotalFiles: 1},
	}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/duplicate-explain?leftId=nonexistent1&rightId=nonexistent2", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

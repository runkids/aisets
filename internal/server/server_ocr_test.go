package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

func TestCatalogEnrichesOCRFromCacheOnly(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	enabled := true
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	heroPath := filepath.Join(root, "hero.png")
	writePNG(t, heroPath)
	sum, algorithm, err := scanner.ContentHash(context.Background(), heroPath)
	if err != nil {
		t.Fatal(err)
	}
	item := scanner.AssetItem{
		ID:            "asset",
		ProjectID:     "project",
		ProjectName:   "Project",
		RepoPath:      "assets/hero.png",
		LocalPath:     heroPath,
		Ext:           ".png",
		ContentHash:   sum,
		HashAlgorithm: algorithm,
		Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
	}
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	ocrSettings := config.OCRSettingsFromApp(settings)
	if err := store.UpsertOCRResult(ocr.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		EngineName:    s.ocrEngine.Name(),
		EngineVersion: s.ocrEngine.Version(),
		SettingsHash:  ocr.SettingsHash(ocrSettings),
		Status:        ocr.StatusReady,
		Text:          "SALE",
		Languages:     []string{"eng"},
		Scripts:       []string{"latin"},
	}); err != nil {
		t.Fatal(err)
	}
	catalog, err := s.enrichCatalogOCR(context.Background(), scanner.Catalog{Items: []scanner.AssetItem{item}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Items[0].OCR == nil || catalog.Items[0].OCR.Status != ocr.StatusReady || catalog.Items[0].OCR.Text != "SALE" {
		t.Fatalf("enriched catalog = %#v", catalog.Items[0].OCR)
	}
	item.ContentHash = "changed"
	catalog, err = s.enrichCatalogOCR(context.Background(), scanner.Catalog{Items: []scanner.AssetItem{item}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Items[0].OCR == nil || catalog.Items[0].OCR.Status != ocr.StatusPending {
		t.Fatalf("stale OCR result should not match = %#v", catalog.Items[0].OCR)
	}
	item.ContentHash = ""
	item.HashAlgorithm = "blake3"
	catalog, err = s.enrichCatalogOCR(context.Background(), scanner.Catalog{Items: []scanner.AssetItem{item}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Items[0].OCR == nil || catalog.Items[0].OCR.Status != ocr.StatusReady || catalog.Items[0].OCR.Text != "SALE" || catalog.Items[0].ContentHash != sum {
		t.Fatalf("missing hash OCR result should be restored from content hash = item %#v ocr %#v", catalog.Items[0], catalog.Items[0].OCR)
	}
}

func TestOCRRunRequiresEnabledAndInstalledRuntime(t *testing.T) {
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
	s.ocrEngine = fakeOCREngine{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"code":"ocr_disabled"`) {
		t.Fatalf("disabled OCR run = %d %s", rec.Code, rec.Body.String())
	}
	enabled := true
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"code":"ocr_not_installed"`) {
		t.Fatalf("missing runtime OCR run = %d %s", rec.Code, rec.Body.String())
	}
}

type fakeOCREngine struct{}

func (fakeOCREngine) Name() string { return "fake-ocr" }

func (fakeOCREngine) Version() string { return "test" }

func (fakeOCREngine) Extract(context.Context, string, []string) (ocr.Extraction, error) {
	return ocr.Extraction{Text: "SALE", Languages: []string{"eng"}, Scripts: []string{"latin"}, DurationMs: 1}, nil
}

type countingOCREngine struct {
	mu    sync.Mutex
	calls int
	err   error
}

func (e *countingOCREngine) Name() string { return "counting-ocr" }

func (e *countingOCREngine) Version() string { return "test" }

func (e *countingOCREngine) Extract(context.Context, string, []string) (ocr.Extraction, error) {
	e.mu.Lock()
	e.calls++
	e.mu.Unlock()
	if e.err != nil {
		return ocr.Extraction{}, e.err
	}
	return ocr.Extraction{Text: "SALE", Languages: []string{"eng"}, Scripts: []string{"latin"}, DurationMs: 1, Mode: "psm_11", Attempts: 1}, nil
}

func (e *countingOCREngine) Calls() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls
}

func TestOCRRunDedupesIdenticalContentHashCandidates(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	enabled := true
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled, OCRLanguages: []string{"eng"}}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ocr.DataDir(config.DataDir()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ocr.PackPath(config.DataDir(), "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	engine := &countingOCREngine{}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.ocrEngine = engine
	items := []scanner.AssetItem{
		{
			ID:            "left",
			ProjectID:     "project",
			RepoPath:      "assets/left.png",
			Ext:           ".png",
			LocalPath:     filepath.Join(root, "left.png"),
			ContentHash:   "shared-hash",
			HashAlgorithm: "blake3",
			Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
		},
		{
			ID:            "right",
			ProjectID:     "project",
			RepoPath:      "assets/right.png",
			Ext:           ".png",
			LocalPath:     filepath.Join(root, "right.png"),
			ContentHash:   "shared-hash",
			HashAlgorithm: "blake3",
			Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
		},
	}
	s.catalog = scanner.Catalog{GeneratedAt: "2026-05-07T00:00:00Z", Items: items}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if engine.Calls() != 1 {
		t.Fatalf("OCR calls = %d, want 1; body = %s", engine.Calls(), body)
	}
	if !strings.Contains(body, `"queued":1`) || !strings.Contains(body, `"cacheHit":1`) || !strings.Contains(body, `"ready":1`) {
		t.Fatalf("deduped OCR counts missing: %s", body)
	}
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	results, err := store.OCRResults(items, config.OCRSettingsFromApp(settings), engine.Name(), engine.Version())
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("OCR rows = %#v", results)
	}
	for _, item := range items {
		result := results[item.ProjectID+"\x00"+item.RepoPath]
		if result.Status != ocr.StatusReady || result.Text != "SALE" {
			t.Fatalf("OCR result for %s = %#v", item.RepoPath, result)
		}
	}
}

func TestOCRRunReusesReadyResultByContentHash(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	enabled := true
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled, OCRLanguages: []string{"eng"}}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ocr.DataDir(config.DataDir()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ocr.PackPath(config.DataDir(), "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	engine := &countingOCREngine{}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.ocrEngine = engine
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	ocrSettings := config.OCRSettingsFromApp(settings)
	if err := store.UpsertOCRResult(ocr.Result{
		ProjectID:     "project",
		RepoPath:      "assets/source.png",
		ContentHash:   "shared-hash",
		HashAlgorithm: "blake3",
		EngineName:    engine.Name(),
		EngineVersion: engine.Version(),
		SettingsHash:  ocr.SettingsHash(ocrSettings),
		Status:        ocr.StatusReady,
		Text:          "SALE",
		Languages:     []string{"eng"},
		Scripts:       []string{"latin"},
		Attempts:      1,
		Mode:          "psm_11",
	}); err != nil {
		t.Fatal(err)
	}
	item := scanner.AssetItem{
		ID:            "target",
		ProjectID:     "project",
		RepoPath:      "assets/target.png",
		Ext:           ".png",
		LocalPath:     filepath.Join(root, "target.png"),
		ContentHash:   "shared-hash",
		HashAlgorithm: "blake3",
		Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
	}
	catalog := scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects:    []scanner.Project{{ID: "project", Name: "Project", Path: root}},
		Items:       []scanner.AssetItem{item},
		Stats:       scanner.CatalogStats{TotalFiles: 1},
	}
	if _, err := store.RecordScan(catalog); err != nil {
		t.Fatal(err)
	}
	s.catalog = catalog

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if engine.Calls() != 0 {
		t.Fatalf("OCR calls = %d, want 0; body = %s", engine.Calls(), body)
	}
	if !strings.Contains(body, `"queued":0`) || !strings.Contains(body, `"cacheHit":1`) {
		t.Fatalf("hash cache counts missing: %s", body)
	}
	results, err := store.OCRResults([]scanner.AssetItem{item}, ocrSettings, engine.Name(), engine.Version())
	if err != nil {
		t.Fatal(err)
	}
	if result := results[item.ProjectID+"\x00"+item.RepoPath]; result.Status != ocr.StatusReady || result.Text != "SALE" {
		t.Fatalf("copied OCR result = %#v", result)
	}
	page, err := store.CatalogItems(config.CatalogItemQuery{Query: "sale", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].RepoPath != item.RepoPath {
		t.Fatalf("OCR search page = %#v", page)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog/items?q=sale", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog items OCR search = %d %s", rec.Code, rec.Body.String())
	}
	var apiPage struct {
		Items []scanner.AssetItem `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &apiPage); err != nil {
		t.Fatal(err)
	}
	if len(apiPage.Items) != 1 || apiPage.Items[0].OCR == nil || apiPage.Items[0].OCR.Status != ocr.StatusReady || apiPage.Items[0].OCR.Text != "SALE" {
		t.Fatalf("API OCR search item = %#v", apiPage.Items)
	}
}

func TestOCRRunDoesNotReuseStaleOrFailedHashResults(t *testing.T) {
	tests := []struct {
		name       string
		seedResult func(ocr.Settings, string, string) ocr.Result
	}{
		{
			name: "different settings",
			seedResult: func(settings ocr.Settings, engineName, engineVersion string) ocr.Result {
				settings.MaxPixels++
				return ocr.Result{
					ProjectID:     "project",
					RepoPath:      "assets/source.png",
					ContentHash:   "shared-hash",
					HashAlgorithm: "blake3",
					EngineName:    engineName,
					EngineVersion: engineVersion,
					SettingsHash:  ocr.SettingsHash(settings),
					Status:        ocr.StatusReady,
					Text:          "OLD",
					Attempts:      1,
					Mode:          "psm_11",
				}
			},
		},
		{
			name: "failed result",
			seedResult: func(settings ocr.Settings, engineName, engineVersion string) ocr.Result {
				return ocr.Result{
					ProjectID:     "project",
					RepoPath:      "assets/source.png",
					ContentHash:   "shared-hash",
					HashAlgorithm: "blake3",
					EngineName:    engineName,
					EngineVersion: engineVersion,
					SettingsHash:  ocr.SettingsHash(settings),
					Status:        ocr.StatusFailed,
					ErrorCode:     "ocr_extract_failed",
					ErrorMessage:  "failed",
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := resolvedTempDir(t)
			t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
			store, err := config.OpenStore()
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			enabled := true
			if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled, OCRLanguages: []string{"eng"}}); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(ocr.DataDir(config.DataDir()), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(ocr.PackPath(config.DataDir(), "eng"), []byte("data"), 0o644); err != nil {
				t.Fatal(err)
			}
			engine := &countingOCREngine{}
			s, err := New(Options{Store: store, Version: "test"})
			if err != nil {
				t.Fatal(err)
			}
			s.ocrEngine = engine
			settings, err := store.Settings()
			if err != nil {
				t.Fatal(err)
			}
			ocrSettings := config.OCRSettingsFromApp(settings)
			if err := store.UpsertOCRResult(tt.seedResult(ocrSettings, engine.Name(), engine.Version())); err != nil {
				t.Fatal(err)
			}
			item := scanner.AssetItem{
				ID:            "target",
				ProjectID:     "project",
				RepoPath:      "assets/target.png",
				Ext:           ".png",
				LocalPath:     filepath.Join(root, "target.png"),
				ContentHash:   "shared-hash",
				HashAlgorithm: "blake3",
				Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
			}
			s.catalog = scanner.Catalog{GeneratedAt: "2026-05-07T00:00:00Z", Items: []scanner.AssetItem{item}}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
			s.handler.ServeHTTP(rec, req)
			if engine.Calls() != 1 {
				t.Fatalf("OCR calls = %d, want 1; body = %s", engine.Calls(), rec.Body.String())
			}
		})
	}
}

func TestOCRRunHashesMissingCandidatesBeforeCacheLookup(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	enabled := true
	batchSize := 1
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled, OCRLanguages: []string{"eng"}, OCRBatchSize: &batchSize}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ocr.DataDir(config.DataDir()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ocr.PackPath(config.DataDir(), "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.ocrEngine = fakeOCREngine{}
	missingHashPath := filepath.Join(root, "missing-hash.png")
	if err := os.WriteFile(missingHashPath, []byte("missing"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.catalog = scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Items: []scanner.AssetItem{
			{
				ID:            "missing-hash",
				ProjectID:     "project",
				RepoPath:      "assets/missing-hash.png",
				Ext:           ".png",
				LocalPath:     missingHashPath,
				HashAlgorithm: "blake3",
				Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
			},
			{
				ID:            "vector",
				ProjectID:     "project",
				RepoPath:      "assets/vector.svg",
				Ext:           ".svg",
				ContentHash:   "h1",
				HashAlgorithm: "blake3",
				Image:         imageproc.Metadata{Format: "svg", Width: 100, Height: 50},
			},
			{
				ID:            "image",
				ProjectID:     "project",
				RepoPath:      "assets/image.png",
				Ext:           ".png",
				LocalPath:     filepath.Join(root, "image.png"),
				ContentHash:   "h2",
				HashAlgorithm: "blake3",
				Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
			},
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `"ready":1`) || !strings.Contains(body, `"hasMore":true`) || strings.Contains(body, `"ocr_missing_hash"`) {
		t.Fatalf("first OCR run should hash and process the missing-hash image: %s", body)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	body = rec.Body.String()
	if !strings.Contains(body, `"cacheHit":1`) || !strings.Contains(body, `"ready":1`) || !strings.Contains(body, `"hasMore":false`) {
		t.Fatalf("second OCR run should cache hashed item and process next item: %s", body)
	}
}

func TestOCRRunRefreshesLegacyReadyEmptyResult(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	enabled := true
	if _, err := store.UpdateSettings(config.SettingsUpdate{OCREnabled: &enabled, OCRLanguages: []string{"eng"}}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ocr.DataDir(config.DataDir()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ocr.PackPath(config.DataDir(), "eng"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.ocrEngine = fakeOCREngine{}
	item := scanner.AssetItem{
		ID:            "empty",
		ProjectID:     "project",
		RepoPath:      "assets/empty.png",
		Ext:           ".png",
		LocalPath:     filepath.Join(root, "empty.png"),
		ContentHash:   "hash-empty",
		HashAlgorithm: "blake3",
		Image:         imageproc.Metadata{Format: "png", Width: 100, Height: 50},
	}
	s.catalog = scanner.Catalog{GeneratedAt: "2026-05-07T00:00:00Z", Items: []scanner.AssetItem{item}}
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	ocrSettings := config.OCRSettingsFromApp(settings)
	if err := store.UpsertOCRResult(ocr.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		EngineName:    s.ocrEngine.Name(),
		EngineVersion: s.ocrEngine.Version(),
		SettingsHash:  ocr.SettingsHash(ocrSettings),
		Status:        ocr.StatusReady,
		Text:          "",
	}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ocr/run", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `"ready":1`) || strings.Contains(body, `"cacheHit":1`) {
		t.Fatalf("legacy empty OCR result should be refreshed, body = %s", body)
	}
}

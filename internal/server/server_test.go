package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/ocr"
	"asset-studio/internal/scanner"
)

func TestAPIVersionAndUpdateDevMode(t *testing.T) {
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "dev"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"devMode":true`) || !strings.Contains(rec.Body.String(), `"latestVersion":"0.1.1-dev"`) {
		t.Fatalf("version = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/update", strings.NewReader(`{}`))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"updated":true`) || !strings.Contains(rec.Body.String(), `"devMode":true`) {
		t.Fatalf("update = %d %s", rec.Code, rec.Body.String())
	}
}

func TestAPIHealthCatalogScanAssetsThumbsAndOptimizationPreview(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	writePNG(t, filepath.Join(root, "src", "logo.png"))
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./logo.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("health = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", rec.Code, rec.Body.String())
	}
	var summary struct {
		ScanID int64 `json:"scanId"`
		Stats  struct {
			TotalFiles int `json:"totalFiles"`
		} `json:"stats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.ScanID == 0 || summary.Stats.TotalFiles != 1 {
		t.Fatalf("catalog summary = %#v", summary)
	}
	items := catalogItemsForTest(t, s)
	if len(items) != 1 || items[0].ID == "" {
		t.Fatalf("catalog items = %#v", items)
	}
	id := items[0].ID

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/scan", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || rec.Header().Get("content-type") != "application/x-ndjson; charset=utf-8" || !strings.Contains(body, `"type":"start"`) || !strings.Contains(body, `"type":"progress"`) || !strings.Contains(body, `"phase":"metadata"`) || !strings.Contains(body, `"phase":"persisting"`) || !strings.Contains(body, `"type":"done"`) {
		t.Fatalf("scan = %d %s", rec.Code, body)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/assets/"+id, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Fatalf("asset = %d len=%d", rec.Code, rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/thumbs/"+id, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("content-type") != "image/png" || rec.Body.Len() == 0 {
		t.Fatalf("thumb = %d %s len=%d body=%s", rec.Code, rec.Header().Get("content-type"), rec.Body.Len(), rec.Body.String())
	}

	payload, _ := json.Marshal(map[string]string{"assetId": id})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/optimization/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"canApply":false`) {
		t.Fatalf("optimization preview = %d %s", rec.Code, rec.Body.String())
	}
}

func TestScanWithProgressUsesSettingsExcludePatterns(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	writePNG(t, filepath.Join(root, "src", "assets", "logo.png"))
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "views", "BrowseView.fixture.ts"), `const fixture = "src/assets/logo.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	patterns := []string{"**/*.fixture.*"}
	if _, err := store.UpdateSettings(config.SettingsUpdate{ExcludePatterns: patterns}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	catalog, _, err := s.scanWithProgress(context.Background(), scanner.FullScanOptions(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 1 {
		t.Fatalf("items = %#v", catalog.Items)
	}
	if len(catalog.Items[0].UsedBy) != 1 || catalog.Items[0].UsedBy[0] != "src/App.tsx" {
		t.Fatalf("usedBy = %#v, want only src/App.tsx", catalog.Items[0].UsedBy)
	}
}

func TestScanHistoryRoutes(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	baseID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-06T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items: []scanner.AssetItem{
			serverScanAsset(root, "src/changed.png", 100, "before", 1),
			serverScanAsset(root, "src/removed.png", 50, "removed", 0),
		},
		Stats: scanner.CatalogStats{TotalFiles: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	targetID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-06T00:01:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items: []scanner.AssetItem{
			serverScanAsset(root, "src/changed.png", 120, "after", 1),
			serverScanAsset(root, "src/added.png", 40, "added", 0),
		},
		Stats: scanner.CatalogStats{TotalFiles: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/scans", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("scans = %d %s", rec.Code, rec.Body.String())
	}
	var listBody struct {
		Scans []config.ScanSummary `json:"scans"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Scans) != 2 || listBody.Scans[0].ID != targetID {
		t.Fatalf("scans body = %#v", listBody)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/scans/"+strconv.FormatInt(baseID, 10), nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"id":`+strconv.FormatInt(baseID, 10)) {
		t.Fatalf("scan summary = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/scans/diff?base=&target="+strconv.FormatInt(targetID, 10), nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"scan_id_required"`) {
		t.Fatalf("invalid diff = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/scans/diff?base="+strconv.FormatInt(baseID, 10)+"&target="+strconv.FormatInt(targetID, 10), nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("diff = %d %s", rec.Code, rec.Body.String())
	}
	var diff config.ScanDiff
	if err := json.Unmarshal(rec.Body.Bytes(), &diff); err != nil {
		t.Fatal(err)
	}
	if diff.Summary.Added != 1 || diff.Summary.Removed != 1 || diff.Summary.Modified != 1 {
		t.Fatalf("diff body = %#v", diff)
	}
}

func serverScanAsset(root, repoPath string, bytes int64, hash string, usedCount int) scanner.AssetItem {
	usedBy := make([]string, 0, usedCount)
	refs := make([]scanner.AssetReference, 0, usedCount)
	for i := 0; i < usedCount; i++ {
		usedBy = append(usedBy, "src/App.tsx")
		refs = append(refs, scanner.AssetReference{File: "src/App.tsx", Line: i + 1, Specifier: repoPath, Kind: "string"})
	}
	return scanner.AssetItem{
		ID:            "p:" + repoPath,
		ProjectID:     "p",
		ProjectName:   "fixture",
		RepoPath:      repoPath,
		LocalPath:     filepath.Join(root, repoPath),
		Ext:           filepath.Ext(repoPath),
		Bytes:         bytes,
		ContentHash:   hash,
		HashAlgorithm: "blake3",
		Image:         imageproc.Metadata{Format: strings.TrimPrefix(filepath.Ext(repoPath), "."), Width: 1, Height: 1, Pages: 1},
		UsedBy:        usedBy,
		References:    refs,
	}
}

func TestWorkspaceRoutesScopeCatalogProjects(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first")
	second := filepath.Join(root, "second")
	writePNG(t, filepath.Join(first, "a.png"))
	writePNG(t, filepath.Join(second, "b.png"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{first}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	iconImage := "data:image/png;base64,aWNvbg=="
	payload, _ := json.Marshal(map[string]string{"name": "Client A", "iconImage": iconImage})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/add", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("add workspace = %d %s", rec.Code, rec.Body.String())
	}
	var added struct {
		Settings struct {
			ActiveWorkspaceID string             `json:"activeWorkspaceId"`
			Workspaces        []config.Workspace `json:"workspaces"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &added); err != nil {
		t.Fatal(err)
	}
	if added.Settings.ActiveWorkspaceID == "" || len(added.Settings.Workspaces) != 2 {
		t.Fatalf("added settings = %#v", added.Settings)
	}
	if added.Settings.Workspaces[0].IconImage != iconImage && added.Settings.Workspaces[1].IconImage != iconImage {
		t.Fatalf("added workspace icon missing = %#v", added.Settings.Workspaces)
	}
	workspaceID := added.Settings.ActiveWorkspaceID

	iconImage = "data:image/webp;base64,bmV3LWljb24="
	payload, _ = json.Marshal(map[string]string{"id": workspaceID, "name": "Client Renamed", "iconImage": iconImage})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workspaces/rename", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"workspaceName":"Client Renamed"`) || !strings.Contains(rec.Body.String(), iconImage) {
		t.Fatalf("rename workspace = %d %s", rec.Code, rec.Body.String())
	}

	if err := store.AddProjects([]string{second}); err != nil {
		t.Fatal(err)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), filepath.Base(second)) || strings.Contains(rec.Body.String(), filepath.Base(first)) {
		t.Fatalf("active catalog = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"projects"`) || !strings.Contains(rec.Body.String(), filepath.Base(first)) || !strings.Contains(rec.Body.String(), filepath.Base(second)) {
		t.Fatalf("settings projects = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ = json.Marshal(map[string]string{"id": "default"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workspaces/switch", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch workspace = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), filepath.Base(first)) || strings.Contains(rec.Body.String(), filepath.Base(second)) {
		t.Fatalf("switched catalog = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ = json.Marshal(map[string]string{"id": workspaceID})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workspaces/remove", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), workspaceID) {
		t.Fatalf("remove workspace = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ = json.Marshal(map[string]string{"id": "default"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/workspaces/remove", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"workspace_last_required"`) {
		t.Fatalf("remove last workspace = %d %s", rec.Code, rec.Body.String())
	}
}

func TestProjectMutationRoutesReturnJSON(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/projects/rename", bytes.NewReader([]byte(`{"id":"`+project+`","name":"Team Assets"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("content-type"), "application/json") {
		t.Fatalf("rename = %d %s %s", rec.Code, rec.Header().Get("content-type"), rec.Body.String())
	}
	var renamed struct {
		Projects []config.Project `json:"projects"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &renamed); err != nil {
		t.Fatal(err)
	}
	if len(renamed.Projects) != 1 || renamed.Projects[0].Name != "Team Assets" {
		t.Fatalf("renamed projects = %#v", renamed.Projects)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects/remove", bytes.NewReader([]byte(`{"id":"`+project+`"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("content-type"), "application/json") {
		t.Fatalf("remove = %d %s %s", rec.Code, rec.Header().Get("content-type"), rec.Body.String())
	}
	var removed struct {
		Projects []config.Project `json:"projects"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &removed); err != nil {
		t.Fatal(err)
	}
	if len(removed.Projects) != 0 {
		t.Fatalf("removed projects = %#v", removed.Projects)
	}
}

func TestAssetInvalidIDReturns404(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/assets/missing", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("asset missing = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"code":"asset_not_found"`) {
		t.Fatalf("asset missing body = %s", rec.Body.String())
	}
}

func TestSettingsPatchPersistsAndReturnsInfo(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
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
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{
		"workspaceName": "Team Assets",
		"scanOnOpen": true,
		"ocrEnabled": true,
		"ocrLanguages": ["eng", "chi_tra"],
		"ocrMaxPixels": 1000,
		"ocrBatchSize": 2,
		"ocrConcurrency": 2,
		"ocrFuzzySearch": false,
		"excludePatterns": ["dist", " tmp "],
		"optimizationDefaultQuality": 72
	}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("settings patch = %d %s", rec.Code, rec.Body.String())
	}
	var patched struct {
		Settings struct {
			WorkspaceName              string   `json:"workspaceName"`
			ScanOnOpen                 bool     `json:"scanOnOpen"`
			OCREnabled                 bool     `json:"ocrEnabled"`
			OCRLanguages               []string `json:"ocrLanguages"`
			OCRMaxPixels               int      `json:"ocrMaxPixels"`
			OCRBatchSize               int      `json:"ocrBatchSize"`
			OCRConcurrency             int      `json:"ocrConcurrency"`
			OCRFuzzySearch             bool     `json:"ocrFuzzySearch"`
			ExcludePatterns            []string `json:"excludePatterns"`
			OptimizationDefaultQuality int      `json:"optimizationDefaultQuality"`
			DatabasePath               string   `json:"databasePath"`
			OCRRuntime                 struct {
				Installed bool `json:"installed"`
			} `json:"ocrRuntime"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Settings.OCRConcurrency != 2 || patched.Settings.OCRFuzzySearch {
		t.Fatalf("OCR advanced settings = %#v", patched.Settings)
	}
	if patched.Settings.WorkspaceName != "Team Assets" || !patched.Settings.ScanOnOpen || patched.Settings.OptimizationDefaultQuality != 72 || patched.Settings.DatabasePath == "" {
		t.Fatalf("patched settings = %#v", patched.Settings)
	}
	if !patched.Settings.OCREnabled || strings.Join(patched.Settings.OCRLanguages, ",") != "eng,chi_tra" || patched.Settings.OCRMaxPixels != 1000 || patched.Settings.OCRBatchSize != 2 || patched.Settings.OCRRuntime.Installed {
		t.Fatalf("patched OCR settings = %#v", patched.Settings)
	}
	if len(patched.Settings.ExcludePatterns) != 2 || patched.Settings.ExcludePatterns[1] != "tmp" {
		t.Fatalf("patched exclude patterns = %#v", patched.Settings.ExcludePatterns)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"workspaceName":"Team Assets"`) {
		t.Fatalf("settings get = %d %s", rec.Code, rec.Body.String())
	}
}

func TestCatalogEnrichesOCRFromCacheOnly(t *testing.T) {
	root := t.TempDir()
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

func TestOCRRunHashesMissingCandidatesBeforeCacheLookup(t *testing.T) {
	root := t.TempDir()
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
	root := t.TempDir()
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

func TestSettingsExportImportResetDatabase(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"databasePath"`) {
		t.Fatalf("settings = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/settings/export", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"projects"`) {
		t.Fatalf("export = %d %s", rec.Code, rec.Body.String())
	}
	exported := rec.Body.Bytes()

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/settings/reset-database", bytes.NewReader([]byte(`{"confirm":"RESET"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset = %d %s", rec.Code, rec.Body.String())
	}
	if projects := store.Projects(); len(projects) != 0 {
		t.Fatalf("projects after reset = %#v", projects)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/settings/import", bytes.NewReader(exported))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import = %d %s", rec.Code, rec.Body.String())
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].Path != project {
		t.Fatalf("projects after import = %#v", projects)
	}
}

func TestProjectsAddAndDirectoryRoutes(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	other := filepath.Join(root, "Other")
	file := filepath.Join(root, "asset.png")
	for _, dir := range []string{project, other} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(file, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
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
	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"projects":[]`) {
		t.Fatalf("projects empty = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ := json.Marshal(map[string]string{"path": project})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects/add", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), filepath.Base(project)) {
		t.Fatalf("add project = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ = json.Marshal(map[string]string{"path": file})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects/add", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"project_path_not_directory"`) {
		t.Fatalf("add file project = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/fs/directories?path="+root, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"name":"Other"`) || !strings.Contains(rec.Body.String(), `"name":"project"`) {
		t.Fatalf("directories = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/fs/directories?path="+file, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"code":"directory_path_not_directory"`) {
		t.Fatalf("file directory = %d %s", rec.Code, rec.Body.String())
	}
}

func TestActionPreviewApplyOptimizationBulkAndPreCheckRoutes(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "logo.png"))
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import logo from "./logo.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	assetID := catalogAssetID(t, s)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/optimization/estimate", bytes.NewReader([]byte(`{"assetIds":[]}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"itemCount":1`) {
		t.Fatalf("optimization estimate = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/optimization/generate-script", bytes.NewReader([]byte(`{"assetIds":[]}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"format":"bash"`) || !strings.Contains(rec.Body.String(), "cwebp") {
		t.Fatalf("generate script = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ := json.Marshal(map[string]string{"assetId": assetID, "targetPath": "src/renamed.png"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("rename preview = %d %s", rec.Code, rec.Body.String())
	}
	var previewResp struct {
		Token   string `json:"token"`
		Preview struct {
			CanApply bool `json:"canApply"`
		} `json:"preview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &previewResp); err != nil {
		t.Fatal(err)
	}
	if previewResp.Token == "" || !previewResp.Preview.CanApply {
		t.Fatalf("rename preview body = %#v", previewResp)
	}

	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"movedFiles":1`) {
		t.Fatalf("rename apply = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(project, "src", "renamed.png")); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(filepath.Join(project, "src", "App.tsx"))
	if !strings.Contains(string(content), "./renamed.png") {
		t.Fatalf("renamed content = %s", content)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"preview_token_invalid"`) {
		t.Fatalf("reused apply token = %d %s", rec.Code, rec.Body.String())
	}

	s.clearCatalog()
	assetID = catalogAssetID(t, s)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/delete-unused/preview", bytes.NewReader([]byte(`{"assetId":"`+assetID+`"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"type":"delete-unused"`) {
		t.Fatalf("delete preview = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = newMultipartPrecheckRequest(t, "Logo Bad.png", filepath.Join(project, "src", "renamed.png"))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"verdict":"duplicate"`) || !strings.Contains(rec.Body.String(), `"exactMatches"`) {
		t.Fatalf("pre-check = %d %s", rec.Code, rec.Body.String())
	}
}

func TestMergePreviewRouteForDuplicateAssets(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	aPath := filepath.Join(project, "src", "a.png")
	bPath := filepath.Join(project, "src", "b.png")
	writePNG(t, aPath)
	fileBytes, err := os.ReadFile(aPath)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, bPath, fileBytes)
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import icon from "./b.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	items := catalogItemsForTest(t, s)
	var duplicateID string
	for _, item := range items {
		if item.RepoPath == "src/b.png" {
			duplicateID = item.ID
		}
	}
	if duplicateID == "" {
		t.Fatalf("catalog items = %#v", items)
	}

	payload, _ := json.Marshal(map[string]string{"assetId": duplicateID, "preferredPath": "src/a.png"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/merge-duplicates/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"type":"merge"`) || !strings.Contains(rec.Body.String(), `"deletes":["src/b.png"]`) {
		t.Fatalf("merge preview = %d %s", rec.Code, rec.Body.String())
	}
}

func TestServerLifecycleAndErrorStatusHelpers(t *testing.T) {
	s, err := New(Options{Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.SetOnReady(cancel)
	if err := s.StartWithContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("StartWithContext err = %v", err)
	}

	if got := directoryAccessError(os.ErrNotExist, "/missing"); got.Code != "directory_not_found" {
		t.Fatalf("directoryAccessError not exist = %#v", got)
	}
	if got := directoryAccessError(os.ErrPermission, "/private"); got.Code != "directory_permission_denied" {
		t.Fatalf("directoryAccessError permission = %#v", got)
	}
	if got := directoryAccessError(errors.New("boom"), "/bad"); got.Code != "directory_unreadable" {
		t.Fatalf("directoryAccessError generic = %#v", got)
	}
	if projectErrorStatus(apierr.New("project_not_found", "missing")) != http.StatusNotFound || projectErrorStatus(errors.New("bad")) != http.StatusBadRequest {
		t.Fatal("projectErrorStatus returned unexpected status")
	}
	if settingsErrorStatus(apierr.New("settings_quality_invalid", "bad")) != http.StatusBadRequest || settingsErrorStatus(errors.New("bad")) != http.StatusInternalServerError {
		t.Fatal("settingsErrorStatus returned unexpected status")
	}
}

func TestServerHelpersBasePathAndUIHandlers(t *testing.T) {
	if got := normalizeBasePath(" /studio/ "); got != "/studio" {
		t.Fatalf("normalizeBasePath() = %q", got)
	}
	if got := normalizeBasePath("/"); got != "" {
		t.Fatalf("normalizeBasePath root = %q", got)
	}

	s, err := New(Options{BasePath: "/studio", Store: nil})
	if err != nil {
		t.Fatal(err)
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.URL.Path))
	})
	handler := s.wrapBasePath(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/studio/api/health", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "/api/health" {
		t.Fatalf("wrapped path = %d %q", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/studio", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTemporaryRedirect || rec.Header().Get("location") != "/studio/" {
		t.Fatalf("base redirect = %d location=%q", rec.Code, rec.Header().Get("location"))
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/other", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("base miss = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	uiPlaceholderHandler(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Asset Studio dev server") {
		t.Fatalf("placeholder = %d %s", rec.Code, rec.Body.String())
	}

	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), `<!doctype html><head></head><body>app</body>`)
	mustWrite(t, filepath.Join(dir, "assets", "app.js"), `console.log("ok")`)
	spa := spaHandlerFromDisk(dir, "/studio")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `window.__BASE_PATH__="/studio"`) {
		t.Fatalf("spa index = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("spa asset = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/missing-route", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<body>app</body>") {
		t.Fatalf("spa fallback = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBatchDelete(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "a.png"))
	writePNG(t, filepath.Join(project, "src", "b.png"))
	writePNG(t, filepath.Join(project, "src", "keep.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Fetch catalog items to get asset IDs.
	items := catalogItemsForTest(t, s)
	if len(items) != 3 {
		t.Fatalf("expected 3 catalog items, got %d: %#v", len(items), items)
	}
	idsByPath := map[string]string{}
	for _, item := range items {
		idsByPath[item.RepoPath] = item.ID
	}
	deleteIDs := []string{idsByPath["src/a.png"], idsByPath["src/b.png"]}

	// Empty body returns empty succeeded list.
	payload, _ := json.Marshal(map[string][]string{"assetIds": {}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/delete", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"succeeded":[]`) {
		t.Fatalf("empty batch delete = %d %s", rec.Code, rec.Body.String())
	}

	// Delete a.png and b.png.
	payload, _ = json.Marshal(map[string][]string{"assetIds": deleteIDs})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/delete", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch delete = %d %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Succeeded []string `json:"succeeded"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 2 {
		t.Fatalf("expected 2 succeeded, got %d: %s", len(result.Succeeded), rec.Body.String())
	}

	// Verify files on disk.
	if _, err := os.Stat(filepath.Join(project, "src", "a.png")); !os.IsNotExist(err) {
		t.Fatal("a.png should have been deleted")
	}
	if _, err := os.Stat(filepath.Join(project, "src", "b.png")); !os.IsNotExist(err) {
		t.Fatal("b.png should have been deleted")
	}
	if _, err := os.Stat(filepath.Join(project, "src", "keep.png")); err != nil {
		t.Fatal("keep.png should still exist")
	}
}

func catalogAssetID(t *testing.T, s *Server) string {
	t.Helper()
	items := catalogItemsForTest(t, s)
	if len(items) != 1 || items[0].ID == "" {
		t.Fatalf("catalog body = %#v", items)
	}
	return items[0].ID
}

type catalogItemForTest struct {
	ID              string `json:"id"`
	RepoPath        string `json:"repoPath"`
	ContentHash     string `json:"contentHash"`
	HashAlgorithm   string `json:"hashAlgorithm"`
	ThumbnailURL    string `json:"thumbnailUrl"`
	Recommendations []any  `json:"optimizationRecommendations"`
}

func catalogItemsForTest(t *testing.T, s *Server) []catalogItemForTest {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog/items", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog items = %d %s", rec.Code, rec.Body.String())
	}
	var page struct {
		Items []catalogItemForTest `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page.Items
}

func newMultipartPrecheckRequest(t *testing.T, filename, path string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pre-check", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	return req
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

func writePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x * 20), G: uint8(y * 20), B: 100, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func TestBatchMovePreviewAndApply(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "icon.png"))
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import icon from "./icon.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Fetch catalog item ID.
	items := catalogItemsForTest(t, s)
	if len(items) != 1 {
		t.Fatalf("expected 1 catalog item, got %d", len(items))
	}
	assetID := items[0].ID

	// POST batch move preview.
	payload, _ := json.Marshal(map[string]any{"assetIds": []string{assetID}, "targetDir": "assets"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch move preview = %d %s", rec.Code, rec.Body.String())
	}
	var previewResp struct {
		Token   string `json:"token"`
		Preview struct {
			CanApply bool `json:"canApply"`
		} `json:"preview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &previewResp); err != nil {
		t.Fatal(err)
	}
	if previewResp.Token == "" || !previewResp.Preview.CanApply {
		t.Fatalf("batch move preview body = %#v", previewResp)
	}

	// POST batch move apply.
	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch move apply = %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"movedFiles":1`) {
		t.Fatalf("batch move apply result = %s", rec.Body.String())
	}

	// Verify file moved on disk.
	if _, err := os.Stat(filepath.Join(project, "assets", "icon.png")); err != nil {
		t.Fatalf("icon.png should have been moved to assets/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(project, "src", "icon.png")); !os.IsNotExist(err) {
		t.Fatal("src/icon.png should no longer exist")
	}

	// Verify reference updated.
	content, _ := os.ReadFile(filepath.Join(project, "src", "App.tsx"))
	if !strings.Contains(string(content), "../assets/icon.png") {
		t.Fatalf("reference not updated, content = %s", content)
	}

	// Reusing the same token should fail.
	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"preview_token_invalid"`) {
		t.Fatalf("reused batch token = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBatchExport(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "img", "a.png"))
	writePNG(t, filepath.Join(project, "img", "b.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Trigger a scan so catalog is populated.
	scanRec := httptest.NewRecorder()
	s.handler.ServeHTTP(scanRec, httptest.NewRequest(http.MethodPost, "/api/scan", nil))

	items := catalogItemsForTest(t, s)
	ids := make([]string, 0)
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	payload, _ := json.Marshal(map[string]any{"assetIds": ids})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/export", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("expected application/zip, got %s", ct)
	}

	zipReader, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("invalid ZIP: %v", err)
	}
	if len(zipReader.File) != 2 {
		t.Fatalf("expected 2 files in ZIP, got %d", len(zipReader.File))
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

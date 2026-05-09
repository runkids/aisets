package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/scanner"
)

func TestProjectScanIntentAPIs(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	assetPack := filepath.Join(root, "icons")
	if err := os.Mkdir(assetPack, 0o755); err != nil {
		t.Fatal(err)
	}
	writePNG(t, filepath.Join(assetPack, "logo.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(map[string]string{"path": assetPack})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/projects/detect-scan-intent", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"suggestedScanIntent":"assetPack"`) {
		t.Fatalf("detect = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ = json.Marshal(map[string]string{"path": assetPack, "scanIntent": "assetPack"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/projects/add", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"scanIntent":"assetPack"`) {
		t.Fatalf("add = %d %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteUnusedPreviewRouteUsesPersistedPolicy(t *testing.T) {
	tests := []struct {
		name        string
		intent      scanner.ProjectScanIntent
		writeCode   bool
		canApply    bool
		blockerCode string
	}{
		{name: "asset pack blocked", intent: scanner.ProjectScanIntentAssetPack, blockerCode: "delete_unused_requires_supported_references"},
		{name: "supported code allowed", intent: scanner.ProjectScanIntentCode, writeCode: true, canApply: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := resolvedTempDir(t)
			t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
			t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
			project := filepath.Join(root, "project")
			writePNG(t, filepath.Join(project, "src", "logo.png"))
			if tt.writeCode {
				mustWrite(t, filepath.Join(project, "src", "App.tsx"), `export function App() { return null }`)
			}
			store, err := config.OpenStore()
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			if err := store.AddProjectsWithIntent([]string{project}, tt.intent); err != nil {
				t.Fatal(err)
			}
			s, err := New(Options{Store: store, Version: "test"})
			if err != nil {
				t.Fatal(err)
			}
			assetID := catalogAssetID(t, s)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/actions/delete-unused/preview", strings.NewReader(`{"assetId":"`+assetID+`"}`))
			s.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("delete preview = %d %s", rec.Code, rec.Body.String())
			}
			var body struct {
				Preview struct {
					CanApply bool `json:"canApply"`
					Blockers []struct {
						Code string `json:"code"`
					} `json:"blockers"`
				} `json:"preview"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Preview.CanApply != tt.canApply {
				t.Fatalf("canApply = %v, want %v; body = %s", body.Preview.CanApply, tt.canApply, rec.Body.String())
			}
			if tt.blockerCode != "" && (len(body.Preview.Blockers) != 1 || body.Preview.Blockers[0].Code != tt.blockerCode) {
				t.Fatalf("blockers = %#v, want %s", body.Preview.Blockers, tt.blockerCode)
			}
		})
	}
}

func TestCatalogRescansWhenScanIntentSnapshotIsStale(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "empty-project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjectsWithIntent([]string{project}, scanner.ProjectScanIntentCode); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	oldScanID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects: []scanner.Project{{
			ID:         projects[0].ID,
			Name:       projects[0].Name,
			Path:       projects[0].Path,
			ScanIntent: scanner.ProjectScanIntentCode,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RenameProject(projects[0].ID, projects[0].Name, "", scanner.ProjectScanIntentAssetPack); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", rec.Code, rec.Body.String())
	}
	var summary struct {
		ScanID int64 `json:"scanId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.ScanID <= oldScanID {
		t.Fatalf("scanID = %d, want newer than stale scan %d", summary.ScanID, oldScanID)
	}
}

func TestScanContinuesWhenRequestContextIsCanceled(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	writePNG(t, filepath.Join(root, "src", "logo.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/scan", nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, `"type":"done"`) {
		t.Fatalf("scan with canceled request context = %d %s", rec.Code, body)
	}
}

func TestScanRejectsWhenAlreadyRunning(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	writePNG(t, filepath.Join(root, "src", "logo.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if !s.beginScan() {
		t.Fatal("failed to mark scan running")
	}
	defer s.finishScan()

	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/scan", nil))
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, "scan_already_running") {
		t.Fatalf("second scan = %d %s", rec.Code, body)
	}
}

func TestCatalogMutationsRejectWhileScanRunning(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
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
	if !s.beginScan() {
		t.Fatal("failed to mark scan running")
	}
	defer s.finishScan()

	tests := []struct {
		name string
		path string
		body string
	}{
		{name: "remove project", path: "/api/projects/remove", body: `{"id":"` + project + `"}`},
		{name: "reset database", path: "/api/settings/reset-database", body: `{"confirm":"RESET"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body)))
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "scan_already_running") {
				t.Fatalf("mutation while scan running = %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestEnsureLatestScanDoesNotStartRepairScanWhileScanRunning(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	oldScanID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects: []scanner.Project{{
			ID:         projects[0].ID,
			Name:       projects[0].Name,
			Path:       projects[0].Path,
			ScanIntent: scanner.ProjectScanIntentCode,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.catalogStale = true
	s.mu.Unlock()
	if !s.beginScan() {
		t.Fatal("failed to mark scan running")
	}
	defer s.finishScan()

	summary, err := s.ensureLatestScan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.ScanID != oldScanID {
		t.Fatalf("ensureLatestScan triggered repair scan: got %d, want %d", summary.ScanID, oldScanID)
	}
}

func TestScanWithProgressUsesSettingsExcludePatterns(t *testing.T) {
	root := resolvedTempDir(t)
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
	patterns := scanner.ExcludePatternsByIntent{scanner.ProjectScanIntentCode: []string{"**/*.fixture.*"}}
	if _, err := store.UpdateSettings(config.SettingsUpdate{ExcludePatternsByIntent: patterns}); err != nil {
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
	root := resolvedTempDir(t)
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

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/scans/clear", bytes.NewReader([]byte(`{"confirm":"CLEAR_SCAN_HISTORY"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear scans = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/scans", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("scans after clear = %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Scans) != 0 {
		t.Fatalf("scans after clear = %#v", listBody.Scans)
	}
}

func serverScanAsset(root, repoPath string, bytes int64, hash string, usedCount int) scanner.AssetItem {
	usedBy := make([]string, 0, usedCount)
	refs := make([]scanner.AssetReference, 0, usedCount)
	usage := scanner.UsageUnused
	deleteAllowed := true
	if usedCount > 0 {
		usage = scanner.UsageReferenced
		deleteAllowed = false
	}
	for i := 0; i < usedCount; i++ {
		usedBy = append(usedBy, "src/App.tsx")
		refs = append(refs, scanner.AssetReference{File: "src/App.tsx", Line: i + 1, Specifier: repoPath, Kind: "string"})
	}
	return scanner.AssetItem{
		ID:                  "p:" + repoPath,
		ProjectID:           "p",
		ProjectName:         "fixture",
		RepoPath:            repoPath,
		LocalPath:           filepath.Join(root, repoPath),
		Ext:                 filepath.Ext(repoPath),
		Bytes:               bytes,
		ContentHash:         hash,
		HashAlgorithm:       "blake3",
		Image:               imageproc.Metadata{Format: strings.TrimPrefix(filepath.Ext(repoPath), "."), Width: 1, Height: 1, Pages: 1},
		UsedBy:              usedBy,
		References:          refs,
		UsageClassification: usage,
		DeleteUnusedAllowed: deleteAllowed,
	}
}

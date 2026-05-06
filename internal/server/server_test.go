package server

import (
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
	"strings"
	"testing"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
)

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
	var catalog struct {
		Items []struct {
			ID              string `json:"id"`
			ContentHash     string `json:"contentHash"`
			HashAlgorithm   string `json:"hashAlgorithm"`
			ThumbnailURL    string `json:"thumbnailUrl"`
			Recommendations []any  `json:"optimizationRecommendations"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 1 || catalog.Items[0].ID == "" || catalog.Items[0].HashAlgorithm != "blake3" {
		t.Fatalf("catalog body = %#v", catalog)
	}
	id := catalog.Items[0].ID

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/scan", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, `"type":"start"`) || !strings.Contains(body, `"type":"progress"`) || !strings.Contains(body, `"type":"done"`) {
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
		t.Fatalf("thumb = %d %s len=%d", rec.Code, rec.Header().Get("content-type"), rec.Body.Len())
	}

	payload, _ := json.Marshal(map[string]string{"assetId": id})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/optimization/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"canApply":false`) {
		t.Fatalf("optimization preview = %d %s", rec.Code, rec.Body.String())
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
			ExcludePatterns            []string `json:"excludePatterns"`
			OptimizationDefaultQuality int      `json:"optimizationDefaultQuality"`
			DatabasePath               string   `json:"databasePath"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Settings.WorkspaceName != "Team Assets" || !patched.Settings.ScanOnOpen || patched.Settings.OptimizationDefaultQuality != 72 || patched.Settings.DatabasePath == "" {
		t.Fatalf("patched settings = %#v", patched.Settings)
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
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"verdict":"warning"`) || !strings.Contains(rec.Body.String(), `"nearMatches"`) {
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
	var catalog struct {
		Items []struct {
			ID       string `json:"id"`
			RepoPath string `json:"repoPath"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	var duplicateID string
	for _, item := range catalog.Items {
		if item.RepoPath == "src/b.png" {
			duplicateID = item.ID
		}
	}
	if duplicateID == "" {
		t.Fatalf("catalog items = %#v", catalog.Items)
	}

	payload, _ := json.Marshal(map[string]string{"assetId": duplicateID, "preferredPath": "src/a.png"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/merge-duplicates/preview", bytes.NewReader(payload))
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

func catalogAssetID(t *testing.T, s *Server) string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", rec.Code, rec.Body.String())
	}
	var catalog struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 1 || catalog.Items[0].ID == "" {
		t.Fatalf("catalog body = %#v", catalog)
	}
	return catalog.Items[0].ID
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

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

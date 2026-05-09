package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aisets/internal/config"
	"aisets/internal/scanner"
)

func TestWorkspaceRoutesScopeCatalogProjects(t *testing.T) {
	root := resolvedTempDir(t)
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
	root := resolvedTempDir(t)
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

	projectIcon := "data:image/png;base64,aWNvbg=="
	rec := httptest.NewRecorder()
	renamePayload, _ := json.Marshal(map[string]string{"id": project, "name": "Team Assets", "iconImage": projectIcon})
	req := httptest.NewRequest(http.MethodPost, "/api/projects/rename", bytes.NewReader(renamePayload))
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
	if len(renamed.Projects) != 1 || renamed.Projects[0].Name != "Team Assets" || renamed.Projects[0].IconImage != projectIcon {
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

func TestAddProjectRouteReportsExistingProject(t *testing.T) {
	root := resolvedTempDir(t)
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
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(map[string]string{"path": project, "scanIntent": string(scanner.ProjectScanIntentCode)})
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/projects/add", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("add project = %d %s", rec.Code, rec.Body.String())
	}
	var added struct {
		Result config.ProjectAddResult `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &added); err != nil {
		t.Fatal(err)
	}
	if added.Result.Status != config.ProjectAddStatusAdded || added.Result.Project.Path != project {
		t.Fatalf("add result = %#v", added.Result)
	}

	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/projects/add", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("add existing project = %d %s", rec.Code, rec.Body.String())
	}
	var existing struct {
		Projects []config.Project        `json:"projects"`
		Result   config.ProjectAddResult `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &existing); err != nil {
		t.Fatal(err)
	}
	if existing.Result.Status != config.ProjectAddStatusExisting || len(existing.Projects) != 1 {
		t.Fatalf("existing result = %#v projects=%#v", existing.Result, existing.Projects)
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
	root := resolvedTempDir(t)
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

func TestSettingsExportImportResetDatabase(t *testing.T) {
	root := resolvedTempDir(t)
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
	root := resolvedTempDir(t)
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

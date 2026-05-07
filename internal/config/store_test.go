package config

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"asset-studio/internal/apierr"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/ocr"
	"asset-studio/internal/scanner"
)

func TestStoreProjectsPersistInSQLite(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	dbPath := store.Path()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dbPath); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	projects := reopened.Projects()
	if len(projects) != 1 || projects[0].Path != project || projects[0].CreatedAt == "" {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestStoreSupportsMultipleWorkspaces(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	workspace, err := store.AddWorkspace("Client A", "data:image/png;base64,aWNvbg==")
	if err != nil {
		t.Fatal(err)
	}
	if workspace.IconImage == "" {
		t.Fatalf("workspace icon not persisted on add: %#v", workspace)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].WorkspaceID != workspace.ID || projects[0].Path != project {
		t.Fatalf("active workspace projects = %#v", projects)
	}

	settings, err := store.UpdateSettings(SettingsUpdate{ActiveWorkspaceID: testStringPtr(defaultWorkspaceID)})
	if err != nil {
		t.Fatal(err)
	}
	if settings.ActiveWorkspaceID != defaultWorkspaceID || settings.WorkspaceName != "Asset Studio" {
		t.Fatalf("settings after switch = %#v", settings)
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].WorkspaceID != defaultWorkspaceID || projects[0].ID != project {
		t.Fatalf("default workspace projects = %#v", projects)
	}
	if all := store.AllProjects(); len(all) != 2 {
		t.Fatalf("all projects = %#v", all)
	}
	if err := store.RenameWorkspace(workspace.ID, "Client Assets", "data:image/webp;base64,bmV3LWljb24="); err != nil {
		t.Fatal(err)
	}
	if workspaces := store.Workspaces(); len(workspaces) != 2 || workspaces[0].Name != "Asset Studio" || workspaces[1].Name != "Client Assets" || workspaces[1].IconImage == workspace.IconImage {
		t.Fatalf("renamed workspaces = %#v", workspaces)
	}
	if err := store.RemoveWorkspace(workspace.ID); err != nil {
		t.Fatal(err)
	}
	if workspaces := store.Workspaces(); len(workspaces) != 1 || workspaces[0].ID != defaultWorkspaceID {
		t.Fatalf("workspaces after remove = %#v", workspaces)
	}
	if all := store.AllProjects(); len(all) != 1 || all[0].WorkspaceID != defaultWorkspaceID {
		t.Fatalf("all projects after workspace remove = %#v", all)
	}
	if err := store.RemoveWorkspace(defaultWorkspaceID); err == nil || !isAPIErrorCode(err, "workspace_last_required") {
		t.Fatalf("remove last workspace err = %T %[1]v", err)
	}
}

func TestStoreRenamesAndRemovesProjects(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	if err := store.RenameProject(project, "Renamed"); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	if len(projects) != 1 || projects[0].Name != "Renamed" {
		t.Fatalf("projects after rename = %#v", projects)
	}
	if err := store.RemoveProject(project); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 0 {
		t.Fatalf("projects after remove = %#v", projects)
	}
}

func TestStoreMigratesLegacySettingsValueJSON(t *testing.T) {
	root := t.TempDir()
	dataHome := filepath.Join(root, "data")
	t.Setenv("XDG_DATA_HOME", dataHome)
	dataDir := filepath.Join(dataHome, "asset-studio")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "asset-studio.db"))
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw := `{"workspaceName":"Legacy Assets","defaultProjectRoot":"/legacy","autoScanOnOpen":true,"scanOnOpen":true,"excludePatterns":["dist"],"optimizationDefaultQuality":64,"optimizationAutoApply":true}`
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`, "settings", legacyRaw, nowUTC()); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Legacy Assets" || settings.DefaultProjectRoot != "/legacy" || !settings.AutoScanOnOpen || settings.OptimizationDefaultQuality != 64 {
		t.Fatalf("settings = %#v", settings)
	}
	if _, err := store.UpdateSettings(SettingsUpdate{}); err != nil {
		t.Fatal(err)
	}
}

func TestStoreDefaultSettingsLeaveProjectRootEmpty(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.DefaultProjectRoot != "" {
		t.Fatalf("default project root = %q", settings.DefaultProjectRoot)
	}
}

func TestStoreUpdatesSettings(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}

	name := "Team Assets"
	scanOnOpen := true
	quality := 72
	settings, err := store.UpdateSettings(SettingsUpdate{
		WorkspaceName:              &name,
		ScanOnOpen:                 &scanOnOpen,
		ExcludePatterns:            []string{"dist", "dist", " tmp "},
		OptimizationDefaultQuality: &quality,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Team Assets" || !settings.ScanOnOpen || settings.OptimizationDefaultQuality != 72 {
		t.Fatalf("settings = %#v", settings)
	}
	if len(settings.ExcludePatterns) != 2 || settings.ExcludePatterns[0] != "dist" || settings.ExcludePatterns[1] != "tmp" {
		t.Fatalf("exclude patterns = %#v", settings.ExcludePatterns)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if persisted.WorkspaceName != "Team Assets" || !persisted.ScanOnOpen || persisted.OptimizationDefaultQuality != 72 {
		t.Fatalf("persisted settings = %#v", persisted)
	}
}

func TestRecordScanPersistsSnapshotTables(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	catalog := scanner.Catalog{
		GeneratedAt: "2026-05-06T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items: []scanner.AssetItem{{
			ID:            "asset-1",
			ProjectID:     "p",
			ProjectName:   "fixture",
			RepoPath:      "src/a.png",
			LocalPath:     filepath.Join(root, "src", "a.png"),
			Ext:           ".png",
			Bytes:         12,
			ContentHash:   "hash",
			HashAlgorithm: "blake3",
			Image:         imageproc.Metadata{Format: "png", Width: 1, Height: 1, Pages: 1},
			UsedBy:        []string{"src/App.tsx"},
			References: []scanner.AssetReference{{
				File:      "src/App.tsx",
				Line:      1,
				Specifier: "./a.png",
				Kind:      "string",
			}},
			Optimization: []scanner.OptimizationSuggestion{{
				Category:       "size",
				Severity:       "warning",
				ReasonCode:     "asset_file_large",
				SuggestionCode: "review_compression_or_modern_format",
			}},
		}},
		DuplicateGroups: []scanner.DuplicateGroup{{
			ID:            "dup-1",
			ContentHash:   "hash",
			HashAlgorithm: "blake3",
			Paths:         []string{"src/a.png", "src/b.png"},
			PreferredPath: "src/a.png",
		}},
		NearDuplicates: []scanner.NearDuplicate{{
			ID:        "near-1",
			LeftID:    "asset-1",
			RightID:   "asset-2",
			LeftPath:  "src/a.png",
			RightPath: "src/c.png",
			Distance:  3,
			Flipped:   true,
		}},
		Stats: scanner.CatalogStats{TotalFiles: 1, DuplicateGroups: 1, DuplicateFiles: 2, UnusedFiles: 0, NearDuplicates: 1, CacheHits: 4},
	}
	scanID, err := store.RecordScan(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if scanID == 0 {
		t.Fatal("scan id was not returned")
	}
	assertRowCount(t, store, "scans", 1)
	assertRowCount(t, store, "asset_snapshots", 1)
	assertRowCount(t, store, "reference_snapshots", 1)
	assertRowCount(t, store, "optimization_snapshots", 1)
	assertRowCount(t, store, "duplicate_group_snapshots", 1)
	assertRowCount(t, store, "duplicate_group_assets", 2)
	assertRowCount(t, store, "near_duplicate_snapshots", 1)
}

func TestScanHistoryAndDiff(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	baseID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-06T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items: []scanner.AssetItem{
			scanAsset(root, "p", "fixture", "src/removed.png", 100, "removed", 1, 10),
			scanAsset(root, "p", "fixture", "src/modified.png", 200, "before", 2, 20),
			scanAsset(root, "p", "fixture", "src/ref.png", 300, "same-ref", 1, 30),
			scanAsset(root, "p", "fixture", "src/unused.png", 400, "same-unused", 1, 40),
			scanAsset(root, "p", "fixture", "src/reused.png", 500, "same-reused", 0, 50),
		},
		DuplicateGroups: []scanner.DuplicateGroup{{ID: "dup-1", ContentHash: "before", HashAlgorithm: "blake3", Paths: []string{"src/modified.png", "src/removed.png"}, PreferredPath: "src/modified.png"}},
		Stats:           scanner.CatalogStats{TotalFiles: 5, DuplicateGroups: 1, UnusedFiles: 1, NearDuplicates: 1},
		NearDuplicates:  []scanner.NearDuplicate{{ID: "near-1", LeftPath: "src/a.png", RightPath: "src/b.png"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	targetID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-06T00:01:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items: []scanner.AssetItem{
			scanAsset(root, "p", "fixture", "src/added.png", 50, "added", 0, 5),
			scanAsset(root, "p", "fixture", "src/modified.png", 250, "after", 2, 25),
			scanAsset(root, "p", "fixture", "src/ref.png", 300, "same-ref", 3, 35),
			scanAsset(root, "p", "fixture", "src/unused.png", 400, "same-unused", 0, 45),
			scanAsset(root, "p", "fixture", "src/reused.png", 500, "same-reused", 2, 55),
		},
		DuplicateGroups: []scanner.DuplicateGroup{
			{ID: "dup-1", ContentHash: "after", HashAlgorithm: "blake3", Paths: []string{"src/modified.png", "src/added.png"}, PreferredPath: "src/modified.png"},
			{ID: "dup-2", ContentHash: "same-ref", HashAlgorithm: "blake3", Paths: []string{"src/ref.png", "src/unused.png"}, PreferredPath: "src/ref.png"},
		},
		Stats:          scanner.CatalogStats{TotalFiles: 5, DuplicateGroups: 2, UnusedFiles: 2, NearDuplicates: 3},
		NearDuplicates: []scanner.NearDuplicate{{ID: "near-1", LeftPath: "src/a.png", RightPath: "src/b.png"}, {ID: "near-2", LeftPath: "src/c.png", RightPath: "src/d.png"}, {ID: "near-3", LeftPath: "src/e.png", RightPath: "src/f.png"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	scans, err := store.ListScans()
	if err != nil {
		t.Fatal(err)
	}
	if len(scans) != 2 || scans[0].ID != targetID || scans[1].ID != baseID {
		t.Fatalf("scans = %#v", scans)
	}
	if _, err := store.Scan(999); !isAPIErrorCode(err, "scan_not_found") {
		t.Fatalf("missing scan err = %#v", err)
	}
	diff, err := store.DiffScans(baseID, targetID)
	if err != nil {
		t.Fatal(err)
	}
	if diff.Summary.Added != 1 || diff.Summary.Removed != 1 || diff.Summary.Modified != 1 || diff.Summary.ReferenceChanged != 3 {
		t.Fatalf("diff summary = %#v", diff.Summary)
	}
	if diff.Summary.BecameUnused != 1 || diff.Summary.NoLongerUnused != 1 {
		t.Fatalf("unused summary = %#v transitions=%#v", diff.Summary, diff.UnusedTransitions)
	}
	if diff.Summary.TotalByteDelta != 0 || diff.Summary.OptimizationSavingsDelta != 15 {
		t.Fatalf("delta summary = %#v", diff.Summary)
	}
	if diff.Summary.DuplicateGroupsDelta != 1 || diff.Summary.NearDuplicatesDelta != 2 {
		t.Fatalf("group deltas = %#v", diff.Summary)
	}
	if diff.Added[0].RepoPath != "src/added.png" || diff.Removed[0].RepoPath != "src/removed.png" || diff.Modified[0].RepoPath != "src/modified.png" {
		t.Fatalf("diff arrays = %#v %#v %#v", diff.Added, diff.Removed, diff.Modified)
	}
}

func TestDataAndCacheDirsHonorXDG(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	if got := DataDir(); got != filepath.Join(root, "data", "asset-studio") {
		t.Fatalf("DataDir() = %q", got)
	}
	if got := CacheDir(); got != filepath.Join(root, "cache", "asset-studio") {
		t.Fatalf("CacheDir() = %q", got)
	}
}

func TestAddProjectsSkipsEmptyRejectsFilesAndRestoresDeleted(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	project := filepath.Join(root, "project")
	file := filepath.Join(root, "asset.png")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if err := store.AddProjects([]string{"", project}); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 1 {
		t.Fatalf("projects = %#v", projects)
	}
	if err := store.RemoveProject(project); err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].Path != project {
		t.Fatalf("restored projects = %#v", projects)
	}

	err = store.AddProjects([]string{file})
	var pathErr *PathError
	if !errors.As(err, &pathErr) || pathErr.Path != file || !strings.Contains(pathErr.Error(), "project path must be a directory") {
		t.Fatalf("file AddProjects err = %T %[1]v", err)
	}
}

func TestProjectMutationValidationErrors(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	for _, err := range []error{store.RemoveProject("missing"), store.RenameProject("missing", "Name"), store.RenameProject("missing", "   ")} {
		coded, ok := err.(apierr.Error)
		if !ok || coded.Code == "" {
			t.Fatalf("expected coded project error, got %T %[1]v", err)
		}
	}
	if _, err := store.AddWorkspace("Client", "data:text/plain;base64,bm8="); err == nil || err.(apierr.Error).Code != "workspace_icon_invalid" {
		t.Fatalf("invalid workspace icon err = %T %[1]v", err)
	}
}

func TestSettingsValidationAndAllFields(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	empty := "   "
	if _, err := store.UpdateSettings(SettingsUpdate{WorkspaceName: &empty}); err == nil || err.(apierr.Error).Code != "settings_workspace_name_required" {
		t.Fatalf("empty workspace err = %T %[1]v", err)
	}
	badQuality := 101
	if _, err := store.UpdateSettings(SettingsUpdate{OptimizationDefaultQuality: &badQuality}); err == nil || err.(apierr.Error).Code != "settings_quality_invalid" {
		t.Fatalf("bad quality err = %T %[1]v", err)
	}
	badOCRBatch := 0
	if _, err := store.UpdateSettings(SettingsUpdate{OCRBatchSize: &badOCRBatch}); err == nil || err.(apierr.Error).Code != "settings_ocr_batch_size_invalid" {
		t.Fatalf("bad OCR batch err = %T %[1]v", err)
	}
	badOCRConcurrency := 2
	if _, err := store.UpdateSettings(SettingsUpdate{OCRConcurrency: &badOCRConcurrency}); err == nil || err.(apierr.Error).Code != "settings_ocr_concurrency_invalid" {
		t.Fatalf("bad OCR concurrency err = %T %[1]v", err)
	}

	workspace := " Team Assets "
	rootPath := " /repo "
	autoScan := true
	scanOnOpen := true
	ocrEnabled := true
	ocrLanguages := []string{"eng", "chi_tra", "eng", "unknown"}
	ocrMaxPixels := 1000
	ocrBatchSize := 3
	ocrConcurrency := 1
	autoApply := true
	quality := 0
	settings, err := store.UpdateSettings(SettingsUpdate{
		WorkspaceName:              &workspace,
		DefaultProjectRoot:         &rootPath,
		AutoScanOnOpen:             &autoScan,
		ScanOnOpen:                 &scanOnOpen,
		OCREnabled:                 &ocrEnabled,
		OCRLanguages:               ocrLanguages,
		OCRMaxPixels:               &ocrMaxPixels,
		OCRBatchSize:               &ocrBatchSize,
		OCRConcurrency:             &ocrConcurrency,
		OptimizationDefaultQuality: &quality,
		OptimizationAutoApply:      &autoApply,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Team Assets" || settings.DefaultProjectRoot != "/repo" || !settings.AutoScanOnOpen || !settings.ScanOnOpen || settings.OptimizationDefaultQuality != 0 || !settings.OptimizationAutoApply {
		t.Fatalf("settings = %#v", settings)
	}
	if !settings.OCREnabled || strings.Join(settings.OCRLanguages, ",") != "eng,chi_tra" || settings.OCRMaxPixels != 1000 || settings.OCRBatchSize != 3 || settings.OCRConcurrency != 1 {
		t.Fatalf("OCR settings = %#v", settings)
	}
}

func TestCustomAssetFiltersPersistAndValidate(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	defaults, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if defaults.CustomAssetFilters == nil || len(defaults.CustomAssetFilters) != 0 {
		t.Fatalf("default custom filters = %#v", defaults.CustomAssetFilters)
	}

	filters := []CustomAssetFilter{{
		ID:      "zh-assets",
		Name:    " Chinese assets ",
		Enabled: true,
		Groups: []CustomAssetFilterGroup{{
			Clauses: []CustomAssetFilterClause{{
				Field:    "path",
				Operator: "regex",
				Value:    `\p{Han}`,
			}, {
				Field:    "bytes",
				Operator: "gte",
				Value:    "1024",
			}},
		}, {
			Clauses: []CustomAssetFilterClause{{
				Field:    "extension",
				Operator: "oneOf",
				Value:    ".svg,.png",
			}, {
				Field:    "folder",
				Operator: "suffix",
				Value:    "icons",
			}, {
				Field:    "project",
				Operator: "contains",
				Value:    "web",
			}},
		}},
	}}
	settings, err := store.UpdateSettings(SettingsUpdate{CustomAssetFilters: filters})
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.CustomAssetFilters) != 1 || settings.CustomAssetFilters[0].Name != "Chinese assets" {
		t.Fatalf("custom filters = %#v", settings.CustomAssetFilters)
	}
	if settings.CustomAssetFilters[0].Groups[0].Clauses[0].Value != `\p{Han}` {
		t.Fatalf("custom filter regex = %#v", settings.CustomAssetFilters[0])
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.CustomAssetFilters) != 1 || persisted.CustomAssetFilters[0].ID != "zh-assets" {
		t.Fatalf("persisted custom filters = %#v", persisted.CustomAssetFilters)
	}

	cases := []struct {
		name    string
		filters []CustomAssetFilter
		code    string
	}{
		{
			name:    "empty name",
			filters: []CustomAssetFilter{{ID: "bad", Name: " ", Enabled: true, Groups: []CustomAssetFilterGroup{{Clauses: []CustomAssetFilterClause{{Field: "path", Operator: "contains", Value: "assets"}}}}}},
			code:    "custom_filter_name_required",
		},
		{
			name:    "empty group",
			filters: []CustomAssetFilter{{ID: "bad", Name: "Bad", Enabled: true, Groups: nil}},
			code:    "custom_filter_group_required",
		},
		{
			name:    "invalid regex",
			filters: []CustomAssetFilter{{ID: "bad", Name: "Bad", Enabled: true, Groups: []CustomAssetFilterGroup{{Clauses: []CustomAssetFilterClause{{Field: "path", Operator: "regex", Value: "["}}}}}},
			code:    "custom_filter_regex_invalid",
		},
		{
			name:    "invalid field",
			filters: []CustomAssetFilter{{ID: "bad", Name: "Bad", Enabled: true, Groups: []CustomAssetFilterGroup{{Clauses: []CustomAssetFilterClause{{Field: "ocr", Operator: "is", Value: "zh"}}}}}},
			code:    "custom_filter_field_invalid",
		},
		{
			name:    "invalid bytes",
			filters: []CustomAssetFilter{{ID: "bad", Name: "Bad", Enabled: true, Groups: []CustomAssetFilterGroup{{Clauses: []CustomAssetFilterClause{{Field: "bytes", Operator: "gte", Value: "-1"}}}}}},
			code:    "custom_filter_bytes_invalid",
		},
		{
			name:    "invalid OCR confidence",
			filters: []CustomAssetFilter{{ID: "bad", Name: "Bad", Enabled: true, Groups: []CustomAssetFilterGroup{{Clauses: []CustomAssetFilterClause{{Field: "ocrConfidence", Operator: "gte", Value: "2"}}}}}},
			code:    "custom_filter_confidence_invalid",
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := reopened.UpdateSettings(SettingsUpdate{CustomAssetFilters: tt.filters})
			if err == nil || err.(apierr.Error).Code != tt.code {
				t.Fatalf("err = %T %[1]v, want %s", err, tt.code)
			}
		})
	}
}

func TestOCRResultsPersistAndMatchCurrentSettings(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	settings := OCRSettingsFromApp(DefaultAppSettings())
	item := scanner.AssetItem{
		ProjectID:     "project",
		RepoPath:      "assets/hero.png",
		ContentHash:   "hash-a",
		HashAlgorithm: "blake3",
	}
	engineName := "test-ocr"
	engineVersion := "test"
	result := ocr.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		EngineName:    engineName,
		EngineVersion: engineVersion,
		SettingsHash:  ocr.SettingsHash(settings),
		Status:        ocr.StatusReady,
		Text:          "Sale 活動",
		Languages:     []string{"eng", "chi_tra"},
		Scripts:       []string{"han", "latin"},
		DurationMs:    42,
	}
	if err := store.UpsertOCRResult(result); err != nil {
		t.Fatal(err)
	}
	results, err := store.OCRResults([]scanner.AssetItem{item}, settings, engineName, engineVersion)
	if err != nil {
		t.Fatal(err)
	}
	got := results[item.ProjectID+"\x00"+item.RepoPath]
	if got.Status != ocr.StatusReady || got.NormalizedText != "sale 活動" || got.DurationMs != 42 {
		t.Fatalf("OCR result = %#v", got)
	}
	emptyResult := result
	emptyResult.RepoPath = "assets/empty.png"
	emptyResult.ContentHash = "hash-empty"
	emptyResult.Text = ""
	emptyResult.DurationMs = 7
	emptyResult.Attempts = 3
	emptyResult.Mode = "psm_11"
	if err := store.UpsertOCRResult(emptyResult); err != nil {
		t.Fatal(err)
	}
	emptyItem := item
	emptyItem.RepoPath = emptyResult.RepoPath
	emptyItem.ContentHash = emptyResult.ContentHash
	results, err = store.OCRResults([]scanner.AssetItem{emptyItem}, settings, engineName, engineVersion)
	if err != nil {
		t.Fatal(err)
	}
	empty := results[emptyItem.ProjectID+"\x00"+emptyItem.RepoPath]
	if !empty.EmptyText || empty.TextStatus != ocr.TextStatusEmpty || empty.Attempts != 3 || empty.Mode != "psm_11" {
		t.Fatalf("empty OCR result = %#v", empty)
	}
	changedSettings := settings
	changedSettings.MaxPixels++
	results, err = store.OCRResults([]scanner.AssetItem{item}, changedSettings, engineName, engineVersion)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("stale OCR result matched changed settings = %#v", results)
	}
}

func TestExportImportAndResetData(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	workspace := "Exported"
	filters := []CustomAssetFilter{{
		ID:      "legacy-icons",
		Name:    "Legacy icons",
		Enabled: true,
		Groups: []CustomAssetFilterGroup{{
			Clauses: []CustomAssetFilterClause{{Field: "folder", Operator: "prefix", Value: "src/icons/legacy"}},
		}},
	}}
	if _, err := store.UpdateSettings(SettingsUpdate{WorkspaceName: &workspace, CustomAssetFilters: filters}); err != nil {
		t.Fatal(err)
	}

	exported := store.ExportData()
	if exported.Version != 1 || exported.ExportedAt == "" || len(exported.Projects) != 1 || exported.Settings == nil || exported.Settings.WorkspaceName != "Exported" || len(exported.Settings.CustomAssetFilters) != 1 {
		t.Fatalf("exported = %#v", exported)
	}
	if err := store.ResetData(); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 0 {
		t.Fatalf("projects after reset = %#v", projects)
	}
	if err := store.ImportData(exported); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].Path != project {
		t.Fatalf("projects after import = %#v", projects)
	}
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Exported" || len(settings.CustomAssetFilters) != 1 || settings.CustomAssetFilters[0].ID != "legacy-icons" {
		t.Fatalf("settings after import = %#v", settings)
	}
	if err := store.ImportData(ExportData{Version: 99}); err == nil || err.(apierr.Error).Code != "settings_import_version_unsupported" {
		t.Fatalf("unsupported import err = %T %[1]v", err)
	}
}

func scanAsset(root, projectID, projectName, repoPath string, bytes int64, hash string, usedCount int, savings int64) scanner.AssetItem {
	usedBy := make([]string, 0, usedCount)
	refs := make([]scanner.AssetReference, 0, usedCount)
	for i := 0; i < usedCount; i++ {
		file := "src/ref.tsx"
		usedBy = append(usedBy, file)
		refs = append(refs, scanner.AssetReference{File: file, Line: i + 1, Specifier: repoPath, Kind: "string"})
	}
	return scanner.AssetItem{
		ID:            projectID + ":" + repoPath,
		ProjectID:     projectID,
		ProjectName:   projectName,
		RepoPath:      repoPath,
		LocalPath:     filepath.Join(root, repoPath),
		Ext:           filepath.Ext(repoPath),
		Bytes:         bytes,
		ContentHash:   hash,
		HashAlgorithm: "blake3",
		Image:         imageproc.Metadata{Format: strings.TrimPrefix(filepath.Ext(repoPath), "."), Width: 1, Height: 1, Pages: 1},
		UsedBy:        usedBy,
		References:    refs,
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "size",
			Severity:       "warning",
			ReasonCode:     "large_asset",
			SuggestionCode: "optimize",
			SavingsBytes:   savings,
		}},
	}
}

func testStringPtr(value string) *string {
	return &value
}

func isAPIErrorCode(err error, code string) bool {
	coded, ok := err.(apierr.Error)
	return ok && coded.Code == code
}

func assertRowCount(t *testing.T, store *Store, table string, want int) {
	t.Helper()
	var got int
	if err := store.db.QueryRow("SELECT count(*) FROM " + table).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s rows = %d, want %d", table, got, want)
	}
}

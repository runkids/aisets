package config

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"asset-studio/internal/apierr"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/lint"
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
	if len(projects) != 1 || projects[0].Path != project || projects[0].CreatedAt == "" || projects[0].ScanIntent != scanner.ProjectScanIntentCode {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestStorePreservesProjectScanIntent(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "assets")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjectsWithIntent([]string{project}, scanner.ProjectScanIntentAssetPack); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	if len(projects) != 1 || projects[0].ScanIntent != scanner.ProjectScanIntentAssetPack {
		t.Fatalf("projects = %#v", projects)
	}
	if err := store.RenameProject(projects[0].ID, "Library", "", scanner.ProjectScanIntentLibrary); err != nil {
		t.Fatal(err)
	}
	projects = store.Projects()
	if projects[0].ScanIntent != scanner.ProjectScanIntentLibrary {
		t.Fatalf("renamed project = %#v", projects[0])
	}
	if err := store.AddProjectsWithIntent([]string{project}, scanner.ProjectScanIntent("bad")); err == nil || apierr.From(err, "").Code != "project_scan_intent_invalid" {
		t.Fatalf("invalid intent err = %T %[1]v", err)
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
	if settings.ActiveWorkspaceID != defaultWorkspaceID || settings.WorkspaceName != "Aisets" {
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
	if workspaces := store.Workspaces(); len(workspaces) != 2 || workspaces[0].Name != "Aisets" || workspaces[1].Name != "Client Assets" || workspaces[1].IconImage == workspace.IconImage {
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
	iconImage := "data:image/png;base64,aWNvbg=="
	if err := store.RenameProject(project, "Renamed", iconImage); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	if len(projects) != 1 || projects[0].Name != "Renamed" || projects[0].IconImage != iconImage {
		t.Fatalf("projects after rename = %#v", projects)
	}
	if err := store.RemoveProject(project); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 0 {
		t.Fatalf("projects after remove = %#v", projects)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	projects = store.Projects()
	if len(projects) != 1 || projects[0].IconImage != "" {
		t.Fatalf("projects after restore = %#v", projects)
	}
}

func TestStoreMigratesLegacySettingsValueJSON(t *testing.T) {
	root := t.TempDir()
	dataHome := filepath.Join(root, "data")
	t.Setenv("XDG_DATA_HOME", dataHome)
	dataDir := filepath.Join(dataHome, "aisets")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "aisets.db"))
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
	wantExcludePatterns := []string{"**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/__mocks__/**", "**/*.stories.*"}
	if len(settings.ExcludePatterns) != 0 {
		t.Fatalf("default global exclude patterns = %#v", settings.ExcludePatterns)
	}
	for _, intent := range []scanner.ProjectScanIntent{scanner.ProjectScanIntentCode, scanner.ProjectScanIntentLibrary, scanner.ProjectScanIntentMixed} {
		if strings.Join(settings.ExcludePatternsByIntent[intent], ",") != strings.Join(wantExcludePatterns, ",") {
			t.Fatalf("default %s exclude patterns = %#v", intent, settings.ExcludePatternsByIntent[intent])
		}
	}
	if len(settings.ExcludePatternsByIntent[scanner.ProjectScanIntentAssetPack]) != 0 {
		t.Fatalf("asset pack exclude patterns = %#v", settings.ExcludePatternsByIntent[scanner.ProjectScanIntentAssetPack])
	}
}

func TestStoreMigratesDefaultGlobalExcludePatternsToIntentDefaults(t *testing.T) {
	root := t.TempDir()
	dataHome := filepath.Join(root, "data")
	t.Setenv("XDG_DATA_HOME", dataHome)
	dataDir := filepath.Join(dataHome, "aisets")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "aisets.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, 1, nowUTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	legacyDefaults := `["**/*.test.*","**/*.spec.*","**/__tests__/**","**/__mocks__/**","**/*.stories.*"]`
	if _, err := db.Exec(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, "app", `{"workspaceName":"Aisets","excludePatterns":`+legacyDefaults+`}`, nowUTC()); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	wantExcludePatterns := []string{"**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/__mocks__/**", "**/*.stories.*"}
	if len(settings.ExcludePatterns) != 0 {
		t.Fatalf("migrated global exclude patterns = %#v", settings.ExcludePatterns)
	}
	if strings.Join(settings.ExcludePatternsByIntent[scanner.ProjectScanIntentCode], ",") != strings.Join(wantExcludePatterns, ",") {
		t.Fatalf("migrated code exclude patterns = %#v", settings.ExcludePatternsByIntent)
	}
	if _, err := store.UpdateSettings(SettingsUpdate{ExcludePatterns: []string{}}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	settings, err = reopened.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.ExcludePatterns) != 0 {
		t.Fatalf("exclude patterns after user clear = %#v", settings.ExcludePatterns)
	}
}

func TestStoreDoesNotSplitCustomGlobalExcludePatterns(t *testing.T) {
	root := t.TempDir()
	dataHome := filepath.Join(root, "data")
	t.Setenv("XDG_DATA_HOME", dataHome)
	dataDir := filepath.Join(dataHome, "aisets")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "aisets.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, 3, nowUTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, "app", `{"workspaceName":"Aisets","excludePatterns":["dist/**"]}`, nowUTC()); err != nil {
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
	if len(settings.ExcludePatterns) != 1 || settings.ExcludePatterns[0] != "dist/**" {
		t.Fatalf("custom global exclude patterns = %#v", settings.ExcludePatterns)
	}
	for intent, patterns := range settings.ExcludePatternsByIntent {
		if len(patterns) != 0 {
			t.Fatalf("intent %s patterns = %#v, want empty", intent, patterns)
		}
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
		ExcludePatternsByIntent:    scanner.ExcludePatternsByIntent{scanner.ProjectScanIntentCode: []string{"**/*.gen.*", "**/*.gen.*"}},
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
	if got := settings.ExcludePatternsByIntent[scanner.ProjectScanIntentCode]; len(got) != 1 || got[0] != "**/*.gen.*" {
		t.Fatalf("intent exclude patterns = %#v", settings.ExcludePatternsByIntent)
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

func TestCatalogItemsFiltersAndFacetsUseFullSnapshot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	filter := []CustomAssetFilter{{
		ID:      "cars",
		Name:    "Cars",
		Enabled: true,
		Groups: []CustomAssetFilterGroup{{
			Clauses: []CustomAssetFilterClause{{
				Field:    "path",
				Operator: "contains",
				Value:    "car",
			}},
		}},
	}}
	if _, err := store.UpdateSettings(SettingsUpdate{CustomAssetFilters: filter}); err != nil {
		t.Fatal(err)
	}

	dupID := "dup-car"
	car := scanAsset(root, "p", "workspace", "src/car.png", 10, "car", 1, 0)
	car.DuplicateGroupID = &dupID
	car.ModifiedUnix = 10
	carCopy := scanAsset(root, "p", "workspace", "src/car-copy.png", 11, "car", 0, 0)
	carCopy.DuplicateGroupID = &dupID
	carCopy.ModifiedUnix = 30
	icon := scanAsset(root, "p", "workspace", "src/icon.png", 20, "icon", 0, 0)
	icon.ModifiedUnix = 20
	logo := scanAsset(root, "p", "workspace", "src/icons/logo.png", 12, "logo", 0, 0)
	logo.ModifiedUnix = 5
	logo.UsageClassification = scanner.UsageNotApplicable
	logo.DeleteUnusedAllowed = false
	carSVG := scanAsset(root, "p", "workspace", "src/car.svg", 30, "car-svg", 1, 0)
	carSVG.ModifiedUnix = 40
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-06T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "workspace", Path: root}},
		Items:       []scanner.AssetItem{car, icon, logo, carSVG, carCopy},
		DuplicateGroups: []scanner.DuplicateGroup{{
			ID:            dupID,
			ContentHash:   "car",
			HashAlgorithm: "blake3",
			Paths:         []string{"src/car.png", "src/car-copy.png"},
			PreferredPath: "src/car.png",
		}},
		Stats: scanner.CatalogStats{TotalFiles: 5, DuplicateGroups: 1, DuplicateFiles: 2, UnusedFiles: 3},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := store.CatalogItems(CatalogItemQuery{Status: "referenced", Ext: ".png", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].RepoPath != "src/car.png" {
		t.Fatalf("referenced png page = %#v", page)
	}
	if page.Facets.ExtensionTotal != 2 {
		t.Fatalf("extension total should ignore active extension filter, facets = %#v", page.Facets)
	}
	if len(page.Facets.CustomFilters) != 1 || page.Facets.CustomFilters[0].Count != 1 {
		t.Fatalf("custom filter facets = %#v", page.Facets.CustomFilters)
	}

	page, err = store.CatalogItems(CatalogItemQuery{CustomFilterID: "cars", Sort: "path", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Items) != 3 {
		t.Fatalf("custom filtered page = %#v", page)
	}
	if got := []string{page.Items[0].RepoPath, page.Items[1].RepoPath, page.Items[2].RepoPath}; got[0] != "src/car-copy.png" || got[1] != "src/car.png" || got[2] != "src/car.svg" {
		t.Fatalf("name order = %#v", got)
	}
	page, err = store.CatalogItems(CatalogItemQuery{Status: "duplicate", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(page.Items) != 2 || page.Facets.ProjectTotal != 2 {
		t.Fatalf("duplicate page should use the same DB filter for list and facets = %#v", page)
	}
	page, err = store.CatalogItems(CatalogItemQuery{Sort: "recent", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{page.Items[0].RepoPath, page.Items[1].RepoPath}; got[0] != "src/car.svg" || got[1] != "src/car-copy.png" {
		t.Fatalf("recent order = %#v", got)
	}
	page, err = store.CatalogItems(CatalogItemQuery{AssetID: carCopy.ID, Query: "car-copy", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != carCopy.ID {
		t.Fatalf("focused asset page = %#v", page)
	}
	folders, err := store.CatalogFolders(CatalogFolderQuery{Ext: ".png"})
	if err != nil {
		t.Fatal(err)
	}
	if folders.Total != 4 || len(folders.Folders) != 1 || folders.Folders[0].Path != "src" || folders.Folders[0].Count != 4 || !folders.Folders[0].HasChildren {
		t.Fatalf("root folders = %#v", folders)
	}
	folders, err = store.CatalogFolders(CatalogFolderQuery{Ext: ".png", Folder: "src"})
	if err != nil {
		t.Fatal(err)
	}
	if folders.Total != 4 || len(folders.Folders) != 1 || folders.Folders[0].Path != "src/icons" || folders.Folders[0].Count != 1 {
		t.Fatalf("child folders = %#v", folders)
	}
	page, err = store.CatalogItems(CatalogItemQuery{Status: "notApplicable", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].RepoPath != "src/icons/logo.png" {
		t.Fatalf("not-applicable page = %#v", page)
	}
	page, err = store.CatalogItems(CatalogItemQuery{Folder: "src/icons", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].RepoPath != "src/icons/logo.png" {
		t.Fatalf("folder filtered page = %#v", page)
	}
	if err := store.UpsertOCRResult(ocr.Result{
		ProjectID:      logo.ProjectID,
		RepoPath:       logo.RepoPath,
		ContentHash:    logo.ContentHash,
		HashAlgorithm:  logo.HashAlgorithm,
		EngineName:     "test-ocr",
		EngineVersion:  "test",
		SettingsHash:   ocr.SettingsHash(OCRSettingsFromApp(DefaultAppSettings())),
		Status:         ocr.StatusReady,
		Text:           "TREASURE BOWI",
		NormalizedText: "treasure bowi",
	}); err != nil {
		t.Fatal(err)
	}
	page, err = store.CatalogItems(CatalogItemQuery{Query: "BOWL", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].RepoPath != "src/icons/logo.png" {
		t.Fatalf("OCR fuzzy search page = %#v", page)
	}
}

func TestCatalogBatchQueriesHydrateReferencesAndOptimization(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	optimizable := scanAsset(root, "p", "workspace", "src/hero.png", 1000, "hero", 2, 700)
	optimizable.Optimization[0].SuggestionCode = "review_compression_or_modern_format"
	plain := scanAsset(root, "p", "workspace", "src/plain.png", 100, "plain", 1, 0)
	plain.Optimization = nil
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "workspace", Path: root}},
		Items:       []scanner.AssetItem{optimizable, plain},
		Stats:       scanner.CatalogStats{TotalFiles: 2},
	}); err != nil {
		t.Fatal(err)
	}

	items, err := store.CatalogItemsByIDs(0, []string{plain.ID, "missing", optimizable.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != plain.ID || items[1].ID != optimizable.ID {
		t.Fatalf("batch items order = %#v", items)
	}
	if len(items[0].References) != 1 || len(items[0].UsedBy) != 1 || items[0].UsedBy[0] != "src/ref.tsx" {
		t.Fatalf("plain references = %#v usedBy=%#v", items[0].References, items[0].UsedBy)
	}
	if len(items[1].References) != 2 || len(items[1].UsedBy) != 1 {
		t.Fatalf("optimizable references = %#v usedBy=%#v", items[1].References, items[1].UsedBy)
	}

	selected, err := store.CatalogItemsWithOptimizationByIDs(0, []string{plain.ID, optimizable.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || len(selected[0].Optimization) != 0 || len(selected[1].Optimization) != 1 || selected[1].Optimization[0].SavingsBytes != 700 {
		t.Fatalf("selected optimization items = %#v", selected)
	}
	if selected[1].Optimization[0].Operation != "convert-avif" {
		t.Fatalf("selected optimization operation = %#v", selected[1].Optimization[0])
	}

	all, err := store.AllOptimizableItems(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].ID != optimizable.ID || len(all[0].Optimization) != 1 {
		t.Fatalf("all optimizable = %#v", all)
	}

	page, err := store.CatalogItems(CatalogItemQuery{Status: "optimizable", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != optimizable.ID || len(page.Items[0].Optimization) != 1 || page.Items[0].Optimization[0].ReasonCode != "large_asset" {
		t.Fatalf("optimizable catalog page = %#v", page)
	}
	if page.Items[0].Optimization[0].Operation != "convert-avif" {
		t.Fatalf("catalog optimization operation = %#v", page.Items[0].Optimization[0])
	}
}

func TestCatalogItemsFiltersOptimizationFacets(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	webp := scanAsset(root, "p", "workspace", "src/photo.png", 1000, "photo", 1, 0)
	webp.Image.Alpha = false
	webp.Optimization = []scanner.OptimizationSuggestion{{
		Category:       "format",
		Severity:       "info",
		ReasonCode:     "png_without_alpha",
		SuggestionCode: "try_modern_photographic_format",
		SavingsBytes:   400,
	}}
	resize := scanAsset(root, "p", "workspace", "src/hero.jpg", 2000, "hero", 1, 0)
	resize.Optimization = []scanner.OptimizationSuggestion{{
		Category:       "dimensions",
		Severity:       "warning",
		ReasonCode:     "image_dimensions_large",
		SuggestionCode: "use_responsive_or_smaller_source",
		SavingsBytes:   800,
	}}
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-08T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "workspace", Path: root}},
		Items:       []scanner.AssetItem{webp, resize},
		Stats:       scanner.CatalogStats{TotalFiles: 2},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := store.CatalogItems(CatalogItemQuery{
		Status:               "optimizable",
		OptimizationCategory: "format",
		OptimizationSeverity: "info",
		Operation:            "convert-avif",
		Limit:                10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != webp.ID {
		t.Fatalf("optimization-filtered page = %#v", page)
	}
	if page.Items[0].Optimization[0].Operation != "convert-avif" {
		t.Fatalf("optimization operation = %#v", page.Items[0].Optimization[0])
	}
	if len(page.Facets.Operations) == 0 || page.Facets.Operations[0].ID != "convert-avif" {
		t.Fatalf("operation facets = %#v", page.Facets.Operations)
	}
	if len(page.Facets.OptimizationCategories) != 1 || page.Facets.OptimizationCategories[0].ID != "format" || len(page.Facets.OptimizationSeverities) != 1 || page.Facets.OptimizationSeverities[0].ID != "info" {
		t.Fatalf("optimization facets = %#v", page.Facets)
	}
}

func TestCatalogLintFiltersByProjectID(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	left := scanAsset(root, "p1", "left", "src/left.png", 100, "left", 0, 0)
	left.Optimization = nil
	right := scanAsset(root, "p2", "right", "src/right.png", 100, "right", 0, 0)
	right.Optimization = nil
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects: []scanner.Project{
			{ID: "p1", Name: "left", Path: filepath.Join(root, "left")},
			{ID: "p2", Name: "right", Path: filepath.Join(root, "right")},
		},
		Items: []scanner.AssetItem{left, right},
		LintFindings: []lint.Finding{
			{RuleID: "asset/left", Severity: "warning", File: "src/left.tsx", AssetID: left.ID},
			{RuleID: "asset/right", Severity: "warning", File: "src/right.tsx", AssetID: right.ID},
			{RuleID: "app/global", Severity: "info", File: "src/App.tsx"},
		},
		Stats: scanner.CatalogStats{TotalFiles: 2, LintFindings: 3},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := store.CatalogLint(CatalogLintQuery{ProjectID: "p1", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].AssetID != left.ID {
		t.Fatalf("project lint page = %#v", page)
	}

	summary, err := store.CatalogSummary()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Stats.LintFindings != 3 {
		t.Fatalf("summary lint findings = %d", summary.Stats.LintFindings)
	}
}

func TestCatalogSummaryProjectStatsDuplicateGroups(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	dupA := "dup-a"
	dupB := "dup-b"
	a1 := scanAsset(root, "p1", "left", "src/a1.png", 10, "hashA", 0, 0)
	a1.DuplicateGroupID = &dupA
	a2 := scanAsset(root, "p1", "left", "src/a2.png", 10, "hashA", 0, 0)
	a2.DuplicateGroupID = &dupA
	b1 := scanAsset(root, "p1", "left", "src/b1.png", 20, "hashB", 0, 0)
	b1.DuplicateGroupID = &dupB
	b2 := scanAsset(root, "p2", "right", "src/b2.png", 20, "hashB", 0, 0)
	b2.DuplicateGroupID = &dupB

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-08T00:00:00Z",
		Projects: []scanner.Project{
			{ID: "p1", Name: "left", Path: filepath.Join(root, "left")},
			{ID: "p2", Name: "right", Path: filepath.Join(root, "right")},
		},
		Items: []scanner.AssetItem{a1, a2, b1, b2},
		DuplicateGroups: []scanner.DuplicateGroup{
			{ID: dupA, ContentHash: "hashA", HashAlgorithm: "blake3", Paths: []string{"src/a1.png", "src/a2.png"}, PreferredPath: "src/a1.png"},
			{ID: dupB, ContentHash: "hashB", HashAlgorithm: "blake3", Paths: []string{"src/b1.png", "src/b2.png"}, PreferredPath: "src/b1.png"},
		},
		Stats: scanner.CatalogStats{TotalFiles: 4, DuplicateGroups: 2, DuplicateFiles: 4},
	}); err != nil {
		t.Fatal(err)
	}

	summary, err := store.CatalogSummary()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Stats.DuplicateGroups != 2 {
		t.Fatalf("global DuplicateGroups = %d, want 2", summary.Stats.DuplicateGroups)
	}
	for _, ps := range summary.ProjectStats {
		switch ps.ProjectID {
		case "p1":
			if ps.DuplicateGroups != 2 {
				t.Fatalf("p1 DuplicateGroups = %d, want 2 (dup-a + dup-b)", ps.DuplicateGroups)
			}
			if ps.DuplicateFiles != 3 {
				t.Fatalf("p1 DuplicateFiles = %d, want 3", ps.DuplicateFiles)
			}
		case "p2":
			if ps.DuplicateGroups != 1 {
				t.Fatalf("p2 DuplicateGroups = %d, want 1 (dup-b only)", ps.DuplicateGroups)
			}
			if ps.DuplicateFiles != 1 {
				t.Fatalf("p2 DuplicateFiles = %d, want 1", ps.DuplicateFiles)
			}
		default:
			t.Fatalf("unexpected project %s", ps.ProjectID)
		}
	}
}

func TestScanProjectIntentsMatchIncludesEmptyProjects(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	projectPath := filepath.Join(root, "empty-project")
	if err := os.Mkdir(projectPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjectsWithIntent([]string{projectPath}, scanner.ProjectScanIntentCode); err != nil {
		t.Fatal(err)
	}
	projects := store.Projects()
	scanID, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects: []scanner.Project{{
			ID:         projects[0].ID,
			Name:       projects[0].Name,
			Path:       projects[0].Path,
			ScanIntent: scanner.ProjectScanIntentCode,
		}},
		Stats: scanner.CatalogStats{},
	})
	if err != nil {
		t.Fatal(err)
	}
	match, err := store.ScanProjectIntentsMatch(scanID, projects)
	if err != nil {
		t.Fatal(err)
	}
	if !match {
		t.Fatal("scan project intents did not match recorded code intent")
	}
	if err := store.RenameProject(projects[0].ID, projects[0].Name, "", scanner.ProjectScanIntentAssetPack); err != nil {
		t.Fatal(err)
	}
	match, err = store.ScanProjectIntentsMatch(scanID, store.Projects())
	if err != nil {
		t.Fatal(err)
	}
	if match {
		t.Fatal("scan project intents matched after intent changed")
	}
}

func TestCatalogDuplicatesExactLoadsPathsWithSingleConnection(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	dupID := "dup-logo"
	left := scanAsset(root, "p", "workspace", "src/logo.png", 10, "same", 1, 0)
	left.DuplicateGroupID = &dupID
	right := scanAsset(root, "p", "workspace", "src/logo-copy.png", 11, "same", 0, 0)
	right.DuplicateGroupID = &dupID
	secondDupID := "dup-mark"
	secondLeft := scanAsset(root, "p", "workspace", "src/mark.png", 12, "same-mark", 0, 0)
	secondLeft.DuplicateGroupID = &secondDupID
	secondRight := scanAsset(root, "p", "workspace", "src/mark-copy.png", 13, "same-mark", 0, 0)
	secondRight.DuplicateGroupID = &secondDupID
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-07T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "workspace", Path: root}},
		Items:       []scanner.AssetItem{left, right, secondLeft, secondRight},
		DuplicateGroups: []scanner.DuplicateGroup{{
			ID:            dupID,
			ContentHash:   "same",
			HashAlgorithm: "blake3",
			Paths:         []string{"src/logo.png", "src/logo-copy.png"},
			PreferredPath: "src/logo.png",
		}, {
			ID:            secondDupID,
			ContentHash:   "same-mark",
			HashAlgorithm: "blake3",
			Paths:         []string{"src/mark.png", "src/mark-copy.png"},
			PreferredPath: "src/mark.png",
		}},
		Stats: scanner.CatalogStats{TotalFiles: 4, DuplicateGroups: 2, DuplicateFiles: 4},
	}); err != nil {
		t.Fatal(err)
	}

	type result struct {
		page CatalogDuplicatesPage
		err  error
	}
	done := make(chan result, 1)
	go func() {
		page, err := store.CatalogDuplicates(CatalogDuplicatesQuery{Kind: "exact", Limit: 10})
		done <- result{page: page, err: err}
	}()

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.page.Total != 2 || len(got.page.Groups) != 2 {
			t.Fatalf("exact duplicate page = %#v", got.page)
		}
		if paths := got.page.Groups[0].Paths; len(paths) != 2 || paths[0] != "src/logo-copy.png" || paths[1] != "src/logo.png" {
			t.Fatalf("duplicate paths = %#v", paths)
		}
		members := got.page.Groups[0].Members
		if len(members) != 2 || members[0].RepoPath != "src/logo-copy.png" || members[1].RepoPath != "src/logo.png" {
			t.Fatalf("duplicate members = %#v", members)
		}
		if members[0].DuplicateGroupID == nil || *members[0].DuplicateGroupID != dupID {
			t.Fatalf("duplicate member group id = %#v", members[0].DuplicateGroupID)
		}
		if members[0].PreferredDuplicatePath == nil || *members[0].PreferredDuplicatePath != "src/logo.png" {
			t.Fatalf("duplicate member preferred path = %#v", members[0].PreferredDuplicatePath)
		}
		secondMembers := got.page.Groups[1].Members
		if got.page.Groups[1].ID != secondDupID || len(secondMembers) != 2 || secondMembers[0].RepoPath != "src/mark-copy.png" || secondMembers[1].RepoPath != "src/mark.png" {
			t.Fatalf("second duplicate group = %#v", got.page.Groups[1])
		}
		if secondMembers[0].DuplicateGroupID == nil || *secondMembers[0].DuplicateGroupID != secondDupID {
			t.Fatalf("second duplicate member group id = %#v", secondMembers[0].DuplicateGroupID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("CatalogDuplicates exact did not return with a single database connection")
	}
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

	if got := DataDir(); got != filepath.Join(root, "data", "aisets") {
		t.Fatalf("DataDir() = %q", got)
	}
	if got := CacheDir(); got != filepath.Join(root, "cache", "aisets") {
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

	for _, err := range []error{store.RemoveProject("missing"), store.RenameProject("missing", "Name", ""), store.RenameProject("missing", "   ", "")} {
		coded, ok := err.(apierr.Error)
		if !ok || coded.Code == "" {
			t.Fatalf("expected coded project error, got %T %[1]v", err)
		}
	}
	if _, err := store.AddWorkspace("Client", "data:text/plain;base64,bm8="); err == nil || err.(apierr.Error).Code != "workspace_icon_invalid" {
		t.Fatalf("invalid workspace icon err = %T %[1]v", err)
	}
	if err := store.RenameProject(filepath.Join(root, "project"), "Project", "data:text/plain;base64,bm8="); err == nil || err.(apierr.Error).Code != "project_icon_invalid" {
		t.Fatalf("invalid project icon err = %T %[1]v", err)
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
	badOCRConcurrency := 3
	if _, err := store.UpdateSettings(SettingsUpdate{OCRConcurrency: &badOCRConcurrency}); err == nil || err.(apierr.Error).Code != "settings_ocr_concurrency_invalid" {
		t.Fatalf("bad OCR concurrency err = %T %[1]v", err)
	}
	if _, err := store.UpdateSettings(SettingsUpdate{OptimizationExternalTools: []imageproc.OptimizationExternalTool{{ID: "unknown", Enabled: true}}}); err == nil || err.(apierr.Error).Code != "settings_optimization_tool_unknown" {
		t.Fatalf("bad optimization tool err = %T %[1]v", err)
	}
	badStrategy := imageproc.DefaultOptimizationStrategies()[0]
	badStrategyQuality := 101
	badStrategy.Action.Quality = &badStrategyQuality
	if _, err := store.UpdateSettings(SettingsUpdate{OptimizationStrategies: []imageproc.OptimizationStrategy{badStrategy}}); err == nil || err.(apierr.Error).Code != "settings_optimization_strategy_quality_invalid" {
		t.Fatalf("bad optimization strategy err = %T %[1]v", err)
	}

	workspace := " Team Assets "
	rootPath := " /repo "
	autoScan := true
	scanOnOpen := true
	ocrEnabled := true
	ocrLanguages := []string{"eng", "chi_tra", "eng", "unknown"}
	ocrMaxPixels := 1000
	ocrBatchSize := 3
	ocrConcurrency := 2
	ocrFuzzySearch := false
	autoApply := true
	quality := 0
	tools := imageproc.DefaultOptimizationExternalTools()
	tools[0].Enabled = true
	strategies := imageproc.DefaultOptimizationStrategies()
	strategies[0].Name = "Custom SVG"
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
		OCRFuzzySearch:             &ocrFuzzySearch,
		OptimizationDefaultQuality: &quality,
		OptimizationAutoApply:      &autoApply,
		OptimizationExternalTools:  tools,
		OptimizationStrategies:     strategies,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Team Assets" || settings.DefaultProjectRoot != "/repo" || !settings.AutoScanOnOpen || !settings.ScanOnOpen || settings.OptimizationDefaultQuality != 0 || !settings.OptimizationAutoApply {
		t.Fatalf("settings = %#v", settings)
	}
	if !settings.OCREnabled || strings.Join(settings.OCRLanguages, ",") != "eng,chi_tra" || settings.OCRMaxPixels != 1000 || settings.OCRBatchSize != 3 || settings.OCRConcurrency != 2 || settings.OCRFuzzySearch {
		t.Fatalf("OCR settings = %#v", settings)
	}
	if !settings.OptimizationExternalTools[0].Enabled || settings.OptimizationStrategies[0].Name != "Custom SVG" {
		t.Fatalf("optimization settings = %#v %#v", settings.OptimizationExternalTools, settings.OptimizationStrategies)
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
	projectIcon := "data:image/png;base64,aWNvbg=="
	if err := store.RenameProject(project, "Project Export", projectIcon); err != nil {
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
	if exported.Version != 1 || exported.ExportedAt == "" || len(exported.Projects) != 1 || exported.Projects[0].IconImage != projectIcon || exported.Settings == nil || exported.Settings.WorkspaceName != "Exported" || len(exported.Settings.CustomAssetFilters) != 1 {
		t.Fatalf("exported = %#v", exported)
	}
	if _, err := store.AddWorkspace("Extra", ""); err != nil {
		t.Fatal(err)
	}
	if err := store.ResetData(); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 0 {
		t.Fatalf("projects after reset = %#v", projects)
	}
	if ws := store.Workspaces(); len(ws) != 1 || ws[0].ID != "default" {
		t.Fatalf("workspaces after reset = %#v", ws)
	}
	if s, err := store.Settings(); err != nil {
		t.Fatal(err)
	} else if s.WorkspaceName != "Aisets" || s.ActiveWorkspaceID != "default" {
		t.Fatalf("settings after reset = %#v", s)
	}
	if err := store.ImportData(exported); err != nil {
		t.Fatal(err)
	}
	if projects := store.Projects(); len(projects) != 1 || projects[0].Path != project || projects[0].IconImage != projectIcon || projects[0].Name != "Project Export" {
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
	usage := scanner.UsageUnused
	deleteAllowed := true
	if usedCount > 0 {
		usage = scanner.UsageReferenced
		deleteAllowed = false
	}
	for i := 0; i < usedCount; i++ {
		file := "src/ref.tsx"
		usedBy = append(usedBy, file)
		refs = append(refs, scanner.AssetReference{File: file, Line: i + 1, Specifier: repoPath, Kind: "string"})
	}
	return scanner.AssetItem{
		ID:                  projectID + ":" + repoPath,
		ProjectID:           projectID,
		ProjectName:         projectName,
		RepoPath:            repoPath,
		LocalPath:           filepath.Join(root, repoPath),
		Ext:                 filepath.Ext(repoPath),
		Bytes:               bytes,
		ModifiedUnix:        bytes,
		ContentHash:         hash,
		HashAlgorithm:       "blake3",
		Image:               imageproc.Metadata{Format: strings.TrimPrefix(filepath.Ext(repoPath), "."), Width: 1, Height: 1, Pages: 1},
		UsedBy:              usedBy,
		References:          refs,
		UsageClassification: usage,
		DeleteUnusedAllowed: deleteAllowed,
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

func TestCatalogLintFacetsAndFilters(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	a1 := scanAsset(root, "p1", "a1", "src/hero.png", 5000, "h1", 0, 0)
	a1.Optimization = nil
	a2 := scanAsset(root, "p1", "a2", "src/icon.svg", 200, "h2", 0, 0)
	a2.Optimization = nil

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-08T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p1", Name: "proj", Path: filepath.Join(root, "proj")}},
		Items:       []scanner.AssetItem{a1, a2},
		LintFindings: []lint.Finding{
			{RuleID: "missing-lazy-loading", Severity: "warning", File: "src/Hero.tsx", Line: 10, AssetID: a1.ID},
			{RuleID: "missing-dimensions", Severity: "warning", File: "src/Hero.tsx", Line: 10, AssetID: a1.ID},
			{RuleID: "large-inline-import", Severity: "critical", File: "src/utils.ts", Line: 3, AssetID: a1.ID},
			{RuleID: "svg-as-img", Severity: "info", File: "src/Icon.tsx", Line: 5, AssetID: a2.ID},
			{RuleID: "no-responsive-image", Severity: "info", File: "src/Gallery.tsx", Line: 20, AssetID: a1.ID},
		},
		Stats: scanner.CatalogStats{TotalFiles: 2, LintFindings: 5},
	}); err != nil {
		t.Fatal(err)
	}

	t.Run("all findings with facets", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 5 {
			t.Fatalf("total = %d, want 5", page.Total)
		}
		sevMap := facetMap(page.Facets.Severities)
		if sevMap["critical"] != 1 || sevMap["warning"] != 2 || sevMap["info"] != 2 {
			t.Fatalf("severity facets = %v", page.Facets.Severities)
		}
		ruleMap := facetMap(page.Facets.Rules)
		if len(ruleMap) != 5 {
			t.Fatalf("rule facets = %v, want 5 rules", page.Facets.Rules)
		}
	})

	t.Run("filter by severity", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Severity: "warning", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 2 {
			t.Fatalf("total = %d, want 2", page.Total)
		}
		for _, item := range page.Items {
			if item.Severity != "warning" {
				t.Fatalf("unexpected severity %s", item.Severity)
			}
		}
		sevMap := facetMap(page.Facets.Severities)
		if sevMap["critical"] != 1 || sevMap["warning"] != 2 || sevMap["info"] != 2 {
			t.Fatalf("cross-filter severity facets should show all severities: %v", page.Facets.Severities)
		}
	})

	t.Run("filter by ruleId", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{RuleID: "missing-lazy-loading", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 1 {
			t.Fatalf("total = %d, want 1", page.Total)
		}
		if page.Items[0].RuleID != "missing-lazy-loading" {
			t.Fatalf("ruleId = %s", page.Items[0].RuleID)
		}
	})

	t.Run("search by filename", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Query: "Hero", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 2 {
			t.Fatalf("total = %d, want 2", page.Total)
		}
	})

	t.Run("search by ruleId text", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Query: "inline", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 1 {
			t.Fatalf("total = %d, want 1", page.Total)
		}
	})

	t.Run("combined severity + search", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Severity: "warning", Query: "Hero", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 2 {
			t.Fatalf("total = %d, want 2", page.Total)
		}
	})

	t.Run("empty result", func(t *testing.T) {
		page, err := store.CatalogLint(CatalogLintQuery{Query: "nonexistent", Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 0 || len(page.Items) != 0 {
			t.Fatalf("expected empty, got total=%d items=%d", page.Total, len(page.Items))
		}
		if page.Facets.Severities == nil || page.Facets.Rules == nil {
			t.Fatal("facets should be empty slices, not nil")
		}
	})
}

func facetMap(facets []CatalogFacetOption) map[string]int {
	m := make(map[string]int, len(facets))
	for _, f := range facets {
		m[f.ID] = f.Count
	}
	return m
}

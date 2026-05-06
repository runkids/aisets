package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"asset-studio/internal/apierr"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/scanner"
)

func TestStoreProjectsPersistInSQLite(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))

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
	if len(projects) != 1 || projects[0].Path != project {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestStoreRenamesAndRemovesProjects(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))

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

func TestStoreUpdatesSettings(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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

func TestStoreImportsLegacyConfigJSON(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "legacy")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(root, "config")
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", configDir)
	if err := os.MkdirAll(filepath.Join(configDir, "asset-studio"), 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, _ := json.Marshal(legacyData{Projects: []Project{{ID: project, Name: "legacy", Path: project}}})
	if err := os.WriteFile(filepath.Join(configDir, "asset-studio", "config.json"), bytes, 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	projects := store.Projects()
	if len(projects) != 1 || projects[0].Path != project {
		t.Fatalf("projects = %#v", projects)
	}
}

func TestRecordScanPersistsSnapshotTables(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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
	if err := store.RecordScan(catalog); err != nil {
		t.Fatal(err)
	}
	assertRowCount(t, store, "scans", 1)
	assertRowCount(t, store, "asset_snapshots", 1)
	assertRowCount(t, store, "reference_snapshots", 1)
	assertRowCount(t, store, "optimization_snapshots", 1)
	assertRowCount(t, store, "duplicate_group_snapshots", 1)
	assertRowCount(t, store, "duplicate_group_assets", 2)
	assertRowCount(t, store, "near_duplicate_snapshots", 1)
}

func TestConfigDataAndCacheDirsHonorXDG(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	if got := ConfigDir(); got != filepath.Join(root, "config", "asset-studio") {
		t.Fatalf("ConfigDir() = %q", got)
	}
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
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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
}

func TestSettingsValidationAndAllFields(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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

	workspace := " Team Assets "
	rootPath := " /repo "
	autoScan := true
	scanOnOpen := true
	autoApply := true
	quality := 0
	settings, err := store.UpdateSettings(SettingsUpdate{
		WorkspaceName:              &workspace,
		DefaultProjectRoot:         &rootPath,
		AutoScanOnOpen:             &autoScan,
		ScanOnOpen:                 &scanOnOpen,
		OptimizationDefaultQuality: &quality,
		OptimizationAutoApply:      &autoApply,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceName != "Team Assets" || settings.DefaultProjectRoot != "/repo" || !settings.AutoScanOnOpen || !settings.ScanOnOpen || settings.OptimizationDefaultQuality != 0 || !settings.OptimizationAutoApply {
		t.Fatalf("settings = %#v", settings)
	}
}

func TestExportImportAndResetData(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
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
	if _, err := store.UpdateSettings(SettingsUpdate{WorkspaceName: &workspace}); err != nil {
		t.Fatal(err)
	}

	exported := store.ExportData()
	if exported.Version != 1 || exported.ExportedAt == "" || len(exported.Projects) != 1 || exported.Settings == nil || exported.Settings.WorkspaceName != "Exported" {
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
	if settings.WorkspaceName != "Exported" {
		t.Fatalf("settings after import = %#v", settings)
	}
	if err := store.ImportData(ExportData{Version: 99}); err == nil || err.(apierr.Error).Code != "settings_import_version_unsupported" {
		t.Fatalf("unsupported import err = %T %[1]v", err)
	}
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

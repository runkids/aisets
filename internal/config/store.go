package config

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
	_ "modernc.org/sqlite"
)

type Project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type AppSettings struct {
	WorkspaceName              string   `json:"workspaceName"`
	DefaultProjectRoot         string   `json:"defaultProjectRoot"`
	AutoScanOnOpen             bool     `json:"autoScanOnOpen"`
	ScanOnOpen                 bool     `json:"scanOnOpen"`
	ExcludePatterns            []string `json:"excludePatterns"`
	OptimizationDefaultQuality int      `json:"optimizationDefaultQuality"`
	OptimizationAutoApply      bool     `json:"optimizationAutoApply"`
}

type SettingsUpdate struct {
	WorkspaceName              *string  `json:"workspaceName"`
	DefaultProjectRoot         *string  `json:"defaultProjectRoot"`
	AutoScanOnOpen             *bool    `json:"autoScanOnOpen"`
	ScanOnOpen                 *bool    `json:"scanOnOpen"`
	ExcludePatterns            []string `json:"excludePatterns"`
	OptimizationDefaultQuality *int     `json:"optimizationDefaultQuality"`
	OptimizationAutoApply      *bool    `json:"optimizationAutoApply"`
}

type Store struct {
	path string
	db   *sql.DB
}

type ExportData struct {
	Version    int          `json:"version"`
	ExportedAt string       `json:"exportedAt"`
	Projects   []Project    `json:"projects"`
	Settings   *AppSettings `json:"settings,omitempty"`
}

func DataDir() string {
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		return filepath.Join(xdg, "asset-studio")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".asset-studio-data"
	}
	return filepath.Join(home, ".local", "share", "asset-studio")
}

func CacheDir() string {
	if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
		return filepath.Join(xdg, "asset-studio")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".asset-studio-cache"
	}
	return filepath.Join(home, ".cache", "asset-studio")
}

func OpenStore() (*Store, error) {
	if err := os.MkdirAll(DataDir(), 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(DataDir(), "asset-studio.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{path: path, db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Projects() []Project {
	rows, err := s.db.Query(`
		SELECT id, name, path
		FROM projects
		WHERE deleted_at IS NULL
		ORDER BY lower(path)
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var project Project
		if err := rows.Scan(&project.ID, &project.Name, &project.Path); err == nil {
			out = append(out, project)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Path) < strings.ToLower(out[j].Path) })
	return out
}

func (s *Store) AddProjects(paths []string) error {
	now := nowUTC()
	for _, raw := range paths {
		if raw == "" {
			continue
		}
		abs, err := filepath.Abs(raw)
		if err != nil {
			return err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return &PathError{Path: abs, Message: "project path must be a directory"}
		}
		if _, err := s.db.Exec(`
			INSERT INTO projects (id, name, path, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(path) DO UPDATE SET
				name = excluded.name,
				deleted_at = NULL,
				updated_at = excluded.updated_at
		`, abs, filepath.Base(abs), abs, now, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) RemoveProject(id string) error {
	result, err := s.db.Exec(`
		UPDATE projects
		SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, nowUTC(), nowUTC(), id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return apierr.New("project_not_found", "project not found")
	}
	return nil
}

func (s *Store) RenameProject(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return apierr.New("project_name_empty", "project name must not be empty")
	}
	result, err := s.db.Exec(`
		UPDATE projects
		SET name = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, name, nowUTC(), id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return apierr.New("project_not_found", "project not found")
	}
	return nil
}

func DefaultAppSettings() AppSettings {
	return AppSettings{
		WorkspaceName:              "Asset Studio",
		DefaultProjectRoot:         "/workspace",
		AutoScanOnOpen:             false,
		ScanOnOpen:                 false,
		ExcludePatterns:            []string{},
		OptimizationDefaultQuality: 80,
		OptimizationAutoApply:      false,
	}
}

func (s *Store) Settings() (AppSettings, error) {
	settings := DefaultAppSettings()
	var raw string
	err := s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return AppSettings{}, err
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return AppSettings{}, err
	}
	if settings.ExcludePatterns == nil {
		settings.ExcludePatterns = []string{}
	}
	return settings, nil
}

func (s *Store) UpdateSettings(update SettingsUpdate) (AppSettings, error) {
	settings, err := s.Settings()
	if err != nil {
		return AppSettings{}, err
	}
	if update.WorkspaceName != nil {
		settings.WorkspaceName = strings.TrimSpace(*update.WorkspaceName)
	}
	if update.DefaultProjectRoot != nil {
		settings.DefaultProjectRoot = strings.TrimSpace(*update.DefaultProjectRoot)
	}
	if update.AutoScanOnOpen != nil {
		settings.AutoScanOnOpen = *update.AutoScanOnOpen
	}
	if update.ScanOnOpen != nil {
		settings.ScanOnOpen = *update.ScanOnOpen
	}
	if update.ExcludePatterns != nil {
		settings.ExcludePatterns = normalizePatterns(update.ExcludePatterns)
	}
	if update.OptimizationDefaultQuality != nil {
		settings.OptimizationDefaultQuality = *update.OptimizationDefaultQuality
	}
	if update.OptimizationAutoApply != nil {
		settings.OptimizationAutoApply = *update.OptimizationAutoApply
	}
	if settings.WorkspaceName == "" {
		return AppSettings{}, apierr.New("settings_workspace_name_required", "workspace name is required")
	}
	if settings.OptimizationDefaultQuality < 0 || settings.OptimizationDefaultQuality > 100 {
		return AppSettings{}, apierr.New("settings_quality_invalid", "optimization quality must be between 0 and 100")
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return AppSettings{}, err
	}
	now := nowUTC()
	if _, err := s.db.Exec(`
		INSERT INTO app_settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`, "app", string(raw), now); err != nil {
		return AppSettings{}, err
	}
	return settings, nil
}

func (s *Store) ExportData() ExportData {
	settings, err := s.Settings()
	if err != nil {
		return ExportData{Version: 1, ExportedAt: nowUTC(), Projects: s.Projects()}
	}
	return ExportData{Version: 1, ExportedAt: nowUTC(), Projects: s.Projects(), Settings: &settings}
}

func (s *Store) ImportData(data ExportData) error {
	if data.Version != 1 {
		return apierr.New("settings_import_version_unsupported", "settings import version is unsupported")
	}
	paths := make([]string, 0, len(data.Projects))
	for _, project := range data.Projects {
		paths = append(paths, project.Path)
	}
	if err := s.AddProjects(paths); err != nil {
		return err
	}
	if data.Settings != nil {
		update := SettingsUpdate{
			WorkspaceName:              &data.Settings.WorkspaceName,
			DefaultProjectRoot:         &data.Settings.DefaultProjectRoot,
			AutoScanOnOpen:             &data.Settings.AutoScanOnOpen,
			ScanOnOpen:                 &data.Settings.ScanOnOpen,
			ExcludePatterns:            data.Settings.ExcludePatterns,
			OptimizationDefaultQuality: &data.Settings.OptimizationDefaultQuality,
			OptimizationAutoApply:      &data.Settings.OptimizationAutoApply,
		}
		_, err := s.UpdateSettings(update)
		return err
	}
	return nil
}

func (s *Store) ResetData() error {
	tables := []string{
		"action_history",
		"tasks",
		"asset_notes",
		"asset_labels",
		"labels",
		"near_duplicate_snapshots",
		"duplicate_group_assets",
		"duplicate_group_snapshots",
		"optimization_snapshots",
		"reference_snapshots",
		"asset_snapshots",
		"scans",
		"projects",
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	for _, table := range tables {
		if _, err = tx.Exec("DELETE FROM " + table); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) RecordScan(catalog scanner.Catalog) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	now := nowUTC()
	result, err := tx.Exec(`
		INSERT INTO scans (
			started_at, completed_at, status, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, catalog.GeneratedAt, now, "completed", len(catalog.Projects), catalog.Stats.TotalFiles,
		catalog.Stats.DuplicateGroups, catalog.Stats.DuplicateFiles, catalog.Stats.UnusedFiles,
		catalog.Stats.NearDuplicates, catalog.Stats.CacheHits)
	if err != nil {
		return err
	}
	scanID, err := result.LastInsertId()
	if err != nil {
		return err
	}

	for _, item := range catalog.Items {
		usedCount := len(item.UsedBy)
		if _, err = tx.Exec(`
			INSERT INTO asset_snapshots (
				scan_id, asset_id, project_id, project_name, repo_path, local_path, ext,
				bytes, content_hash, hash_algorithm, format, width, height, animated,
				alpha, pages, dhash, dhash_flipped, used_count
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, scanID, item.ID, item.ProjectID, item.ProjectName, item.RepoPath, item.LocalPath, item.Ext,
			item.Bytes, item.ContentHash, item.HashAlgorithm, item.Image.Format, item.Image.Width,
			item.Image.Height, boolInt(item.Image.Animated), boolInt(item.Image.Alpha), item.Image.Pages,
			item.DHash, item.DHashFlipped, usedCount); err != nil {
			return err
		}
		for _, ref := range item.References {
			if _, err = tx.Exec(`
				INSERT INTO reference_snapshots (scan_id, asset_id, project_id, repo_path, file, line, specifier, kind)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, scanID, item.ID, item.ProjectID, item.RepoPath, ref.File, ref.Line, ref.Specifier, ref.Kind); err != nil {
				return err
			}
		}
		for _, opt := range item.Optimization {
			if _, err = tx.Exec(`
				INSERT INTO optimization_snapshots (
					scan_id, asset_id, project_id, repo_path, category, severity,
					reason_code, suggestion_code, estimated_bytes, savings_bytes
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, scanID, item.ID, item.ProjectID, item.RepoPath, opt.Category, opt.Severity,
				opt.ReasonCode, opt.SuggestionCode, opt.EstimatedBytes, opt.SavingsBytes); err != nil {
				return err
			}
		}
	}
	for _, group := range catalog.DuplicateGroups {
		if _, err = tx.Exec(`
			INSERT INTO duplicate_group_snapshots (scan_id, group_id, content_hash, hash_algorithm, preferred_path)
			VALUES (?, ?, ?, ?, ?)
		`, scanID, group.ID, group.ContentHash, group.HashAlgorithm, group.PreferredPath); err != nil {
			return err
		}
		for _, path := range group.Paths {
			if _, err = tx.Exec(`
				INSERT INTO duplicate_group_assets (scan_id, group_id, repo_path)
				VALUES (?, ?, ?)
			`, scanID, group.ID, path); err != nil {
				return err
			}
		}
	}
	for _, near := range catalog.NearDuplicates {
		if _, err = tx.Exec(`
			INSERT INTO near_duplicate_snapshots (
				scan_id, near_id, left_id, right_id, left_path, right_path, distance, flipped
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, scanID, near.ID, near.LeftID, near.RightID, near.LeftPath, near.RightPath, near.Distance, boolInt(near.Flipped)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type PathError struct {
	Path    string
	Message string
}

func (e *PathError) Error() string {
	return e.Message + ": " + e.Path
}

func (s *Store) init() error {
	if _, err := s.db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		return err
	}
	if err := s.migrate(); err != nil {
		return err
	}
	return nil
}

func (s *Store) migrate() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			path TEXT NOT NULL UNIQUE,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS scans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			started_at TEXT NOT NULL,
			completed_at TEXT,
			status TEXT NOT NULL,
			project_count INTEGER NOT NULL DEFAULT 0,
			total_files INTEGER NOT NULL DEFAULT 0,
			duplicate_groups INTEGER NOT NULL DEFAULT 0,
			duplicate_files INTEGER NOT NULL DEFAULT 0,
			unused_files INTEGER NOT NULL DEFAULT 0,
			near_duplicates INTEGER NOT NULL DEFAULT 0,
			cache_hits INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS asset_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			asset_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			project_name TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			local_path TEXT NOT NULL,
			ext TEXT NOT NULL,
			bytes INTEGER NOT NULL,
			content_hash TEXT,
			hash_algorithm TEXT,
			format TEXT,
			width INTEGER NOT NULL DEFAULT 0,
			height INTEGER NOT NULL DEFAULT 0,
			animated INTEGER NOT NULL DEFAULT 0,
			alpha INTEGER NOT NULL DEFAULT 0,
			pages INTEGER NOT NULL DEFAULT 0,
			dhash TEXT,
			dhash_flipped TEXT,
			used_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (scan_id, asset_id)
		)`,
		`CREATE TABLE IF NOT EXISTS reference_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			asset_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			file TEXT NOT NULL,
			line INTEGER NOT NULL,
			specifier TEXT NOT NULL,
			kind TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS optimization_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			asset_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			category TEXT NOT NULL,
			severity TEXT NOT NULL,
			reason_code TEXT NOT NULL,
			suggestion_code TEXT NOT NULL,
			estimated_bytes INTEGER NOT NULL DEFAULT 0,
			savings_bytes INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS duplicate_group_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			group_id TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			hash_algorithm TEXT NOT NULL,
			preferred_path TEXT NOT NULL,
			PRIMARY KEY (scan_id, group_id)
		)`,
		`CREATE TABLE IF NOT EXISTS duplicate_group_assets (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			group_id TEXT NOT NULL,
			repo_path TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS near_duplicate_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			near_id TEXT NOT NULL,
			left_id TEXT NOT NULL,
			right_id TEXT NOT NULL,
			left_path TEXT NOT NULL,
			right_path TEXT NOT NULL,
			distance INTEGER NOT NULL,
			flipped INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (scan_id, near_id)
		)`,
		`CREATE TABLE IF NOT EXISTS labels (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			color TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS asset_labels (
			project_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			PRIMARY KEY (project_id, repo_path, label_id)
		)`,
		`CREATE TABLE IF NOT EXISTS asset_notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			body TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			status TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			result_json TEXT,
			error_code TEXT,
			error_message TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS action_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			status TEXT NOT NULL,
			project_id TEXT,
			payload_json TEXT NOT NULL,
			result_json TEXT,
			error_code TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_scans_completed_at ON scans(completed_at)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_project_path ON asset_snapshots(project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_hash ON asset_snapshots(hash_algorithm, content_hash)`,
		`CREATE INDEX IF NOT EXISTS idx_references_project_path ON reference_snapshots(project_id, repo_path)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`, 1, nowUTC())
	return err
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func normalizePatterns(patterns []string) []string {
	out := make([]string, 0, len(patterns))
	seen := map[string]struct{}{}
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		out = append(out, pattern)
	}
	return out
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

package config

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

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
		`CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon_image TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL DEFAULT 'default',
			name TEXT NOT NULL,
			path TEXT NOT NULL,
			icon_image TEXT NOT NULL DEFAULT '',
			scan_intent TEXT NOT NULL DEFAULT 'code',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT,
			UNIQUE(workspace_id, path)
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
			scan_profile TEXT NOT NULL DEFAULT 'fast',
			references_state TEXT NOT NULL DEFAULT 'computed',
			near_duplicates_state TEXT NOT NULL DEFAULT 'computed',
			optimization_state TEXT NOT NULL DEFAULT 'computed',
			project_count INTEGER NOT NULL DEFAULT 0,
			total_files INTEGER NOT NULL DEFAULT 0,
			duplicate_groups INTEGER NOT NULL DEFAULT 0,
			duplicate_files INTEGER NOT NULL DEFAULT 0,
			unused_files INTEGER NOT NULL DEFAULT 0,
			near_duplicates INTEGER NOT NULL DEFAULT 0,
			cache_hits INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS scan_project_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			project_id TEXT NOT NULL,
			scan_intent TEXT NOT NULL DEFAULT 'code',
			PRIMARY KEY (scan_id, project_id)
		)`,
		`CREATE TABLE IF NOT EXISTS asset_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			asset_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			project_name TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			file_name TEXT NOT NULL DEFAULT '',
			local_path TEXT NOT NULL,
			ext TEXT NOT NULL,
			bytes INTEGER NOT NULL,
			modified_unix INTEGER NOT NULL DEFAULT 0,
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
			scan_intent TEXT NOT NULL DEFAULT 'code',
			usage_classification TEXT NOT NULL DEFAULT 'notApplicable',
			delete_unused_allowed INTEGER NOT NULL DEFAULT 0,
			lint_applicability TEXT NOT NULL DEFAULT 'advisory',
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
			asset_id TEXT NOT NULL DEFAULT '',
			project_id TEXT NOT NULL DEFAULT '',
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
		`CREATE TABLE IF NOT EXISTS lint_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			rule_id TEXT NOT NULL,
			severity TEXT NOT NULL,
			file TEXT NOT NULL,
			line INTEGER NOT NULL DEFAULT 0,
			snippet TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			suggestion TEXT NOT NULL DEFAULT '',
			asset_id TEXT NOT NULL DEFAULT ''
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
		`CREATE TABLE IF NOT EXISTS ocr_results (
			project_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			hash_algorithm TEXT NOT NULL,
			engine_name TEXT NOT NULL,
			engine_version TEXT NOT NULL,
			settings_hash TEXT NOT NULL,
			status TEXT NOT NULL,
			text TEXT NOT NULL DEFAULT '',
			normalized_text TEXT NOT NULL DEFAULT '',
			text_status TEXT NOT NULL DEFAULT '',
			languages_json TEXT NOT NULL DEFAULT '[]',
			scripts_json TEXT NOT NULL DEFAULT '[]',
			confidence REAL,
			error_code TEXT,
			error_message TEXT,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT '',
			attempts INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (project_id, repo_path, content_hash, hash_algorithm, engine_name, engine_version, settings_hash)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_scans_completed_at ON scans(completed_at)`,
		`CREATE INDEX IF NOT EXISTS idx_scan_project_snapshots_scan ON scan_project_snapshots(scan_id, project_id)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_project_path ON asset_snapshots(project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_hash ON asset_snapshots(hash_algorithm, content_hash)`,
		`CREATE INDEX IF NOT EXISTS idx_references_project_path ON reference_snapshots(project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_ocr_results_project_path ON ocr_results(project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_ocr_results_hash ON ocr_results(hash_algorithm, content_hash)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	if err := s.migrateProjectsWorkspaceSchema(); err != nil {
		return err
	}
	if err := s.migrateProjectsIconSchema(); err != nil {
		return err
	}
	if err := s.migrateProjectsScanIntentSchema(); err != nil {
		return err
	}
	if err := s.migrateWorkspacesIconSchema(); err != nil {
		return err
	}
	if err := s.migrateAppSettingsSchema(); err != nil {
		return err
	}
	if err := s.migrateDefaultExcludePatterns(); err != nil {
		return err
	}
	if err := s.migrateOCRResultsSchema(); err != nil {
		return err
	}
	if err := s.migrateScanPerformanceSchema(); err != nil {
		return err
	}
	if err := s.migrateScanProfileToFull(); err != nil {
		return err
	}
	if err := s.migrateOptimizationThresholds(); err != nil {
		return err
	}
	if err := s.ensureDefaultWorkspace(); err != nil {
		return err
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`, 1, nowUTC())
	return err
}

func (s *Store) migrateScanPerformanceSchema() error {
	scanColumns, err := s.tableColumns("scans")
	if err != nil {
		return err
	}
	scanStatements := map[string]string{
		"scan_profile":          `ALTER TABLE scans ADD COLUMN scan_profile TEXT NOT NULL DEFAULT 'fast'`,
		"references_state":      `ALTER TABLE scans ADD COLUMN references_state TEXT NOT NULL DEFAULT 'computed'`,
		"near_duplicates_state": `ALTER TABLE scans ADD COLUMN near_duplicates_state TEXT NOT NULL DEFAULT 'computed'`,
		"optimization_state":    `ALTER TABLE scans ADD COLUMN optimization_state TEXT NOT NULL DEFAULT 'computed'`,
	}
	for column, statement := range scanStatements {
		if scanColumns[column] {
			continue
		}
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}

	dupColumns, err := s.tableColumns("duplicate_group_assets")
	if err != nil {
		return err
	}
	dupStatements := map[string]string{
		"asset_id":   `ALTER TABLE duplicate_group_assets ADD COLUMN asset_id TEXT NOT NULL DEFAULT ''`,
		"project_id": `ALTER TABLE duplicate_group_assets ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`,
	}
	for column, statement := range dupStatements {
		if dupColumns[column] {
			continue
		}
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	assetColumns, err := s.tableColumns("asset_snapshots")
	if err != nil {
		return err
	}
	if !assetColumns["file_name"] {
		if _, err := s.db.Exec(`ALTER TABLE asset_snapshots ADD COLUMN file_name TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(`UPDATE asset_snapshots SET file_name = asset_name(repo_path) WHERE file_name = ''`); err != nil {
		return err
	}
	if !assetColumns["modified_unix"] {
		if _, err := s.db.Exec(`ALTER TABLE asset_snapshots ADD COLUMN modified_unix INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
	}
	assetStatements := map[string]string{
		"scan_intent":           `ALTER TABLE asset_snapshots ADD COLUMN scan_intent TEXT NOT NULL DEFAULT 'code'`,
		"usage_classification":  `ALTER TABLE asset_snapshots ADD COLUMN usage_classification TEXT NOT NULL DEFAULT 'notApplicable'`,
		"delete_unused_allowed": `ALTER TABLE asset_snapshots ADD COLUMN delete_unused_allowed INTEGER NOT NULL DEFAULT 0`,
		"lint_applicability":    `ALTER TABLE asset_snapshots ADD COLUMN lint_applicability TEXT NOT NULL DEFAULT 'advisory'`,
	}
	for column, statement := range assetStatements {
		if assetColumns[column] {
			continue
		}
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_file_name ON asset_snapshots(scan_id, file_name COLLATE NOCASE, file_name, project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_project_path ON asset_snapshots(scan_id, project_id, repo_path)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_asset ON asset_snapshots(scan_id, asset_id)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_ext ON asset_snapshots(scan_id, ext)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_modified ON asset_snapshots(scan_id, modified_unix)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_snapshots_scan_used ON asset_snapshots(scan_id, used_count)`,
		`CREATE INDEX IF NOT EXISTS idx_references_scan_asset ON reference_snapshots(scan_id, asset_id)`,
		`CREATE INDEX IF NOT EXISTS idx_optimization_scan_asset ON optimization_snapshots(scan_id, asset_id)`,
		`CREATE INDEX IF NOT EXISTS idx_duplicate_assets_scan_asset ON duplicate_group_assets(scan_id, asset_id)`,
		`CREATE INDEX IF NOT EXISTS idx_near_duplicates_scan_left ON near_duplicate_snapshots(scan_id, left_id)`,
		`CREATE INDEX IF NOT EXISTS idx_near_duplicates_scan_right ON near_duplicate_snapshots(scan_id, right_id)`,
		`CREATE INDEX IF NOT EXISTS idx_lint_snapshots_scan_severity ON lint_snapshots(scan_id, severity)`,
	}
	if _, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS lint_snapshots (
			scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
			rule_id TEXT NOT NULL,
			severity TEXT NOT NULL,
			file TEXT NOT NULL,
			line INTEGER NOT NULL DEFAULT 0,
			snippet TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			suggestion TEXT NOT NULL DEFAULT '',
			asset_id TEXT NOT NULL DEFAULT ''
		)
	`); err != nil {
		return err
	}
	for _, statement := range indexes {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) tableColumns(table string) (map[string]bool, error) {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	return columns, rows.Err()
}

func (s *Store) migrateDefaultExcludePatterns() error {
	const version = 3
	var applied int
	err := s.db.QueryRow(`SELECT 1 FROM schema_migrations WHERE version = ?`, version).Scan(&applied)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	var raw string
	err = s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if raw != "" {
		settings := DefaultAppSettings()
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return err
		}
		if len(settings.ExcludePatterns) == 0 {
			settings.ExcludePatterns = defaultExcludePatterns()
			normalized, err := json.Marshal(settings)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`, string(normalized), nowUTC(), "app"); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, nowUTC()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) migrateOCRResultsSchema() error {
	columns, err := s.tableColumns("ocr_results")
	if err != nil {
		return err
	}
	statements := []struct {
		column string
		sql    string
	}{
		{"text_status", `ALTER TABLE ocr_results ADD COLUMN text_status TEXT NOT NULL DEFAULT ''`},
		{"mode", `ALTER TABLE ocr_results ADD COLUMN mode TEXT NOT NULL DEFAULT ''`},
		{"attempts", `ALTER TABLE ocr_results ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`},
	}
	for _, statement := range statements {
		if columns[statement.column] {
			continue
		}
		if _, err := s.db.Exec(statement.sql); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrateProjectsWorkspaceSchema() error {
	columns, err := s.tableColumns("projects")
	if err != nil {
		return err
	}
	if columns["workspace_id"] {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`ALTER TABLE projects RENAME TO projects_legacy`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		CREATE TABLE projects (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL DEFAULT 'default',
			name TEXT NOT NULL,
			path TEXT NOT NULL,
			icon_image TEXT NOT NULL DEFAULT '',
			scan_intent TEXT NOT NULL DEFAULT 'code',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			deleted_at TEXT,
			UNIQUE(workspace_id, path)
		)
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO projects (id, workspace_id, name, path, icon_image, scan_intent, created_at, updated_at, deleted_at)
		SELECT id, 'default', name, path, '', 'code', created_at, updated_at, deleted_at
		FROM projects_legacy
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE projects_legacy`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) migrateProjectsIconSchema() error {
	columns, err := s.tableColumns("projects")
	if err != nil {
		return err
	}
	if columns["icon_image"] {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE projects ADD COLUMN icon_image TEXT NOT NULL DEFAULT ''`)
	return err
}

func (s *Store) migrateProjectsScanIntentSchema() error {
	columns, err := s.tableColumns("projects")
	if err != nil {
		return err
	}
	if columns["scan_intent"] {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE projects ADD COLUMN scan_intent TEXT NOT NULL DEFAULT 'code'`)
	return err
}

func (s *Store) migrateWorkspacesIconSchema() error {
	columns, err := s.tableColumns("workspaces")
	if err != nil {
		return err
	}
	if columns["icon_image"] {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE workspaces ADD COLUMN icon_image TEXT NOT NULL DEFAULT ''`)
	return err
}

func (s *Store) ensureDefaultWorkspace() error {
	name := "Asset Studio"
	var raw string
	if err := s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw); err == nil && raw != "" {
		var settings AppSettings
		if err := json.Unmarshal([]byte(raw), &settings); err == nil && strings.TrimSpace(settings.WorkspaceName) != "" {
			name = strings.TrimSpace(settings.WorkspaceName)
		}
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	now := nowUTC()
	_, err := s.db.Exec(`
		INSERT INTO workspaces (id, name, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = CASE WHEN workspaces.name = '' THEN excluded.name ELSE workspaces.name END,
			updated_at = workspaces.updated_at
	`, defaultWorkspaceID, name, now, now)
	return err
}

func (s *Store) migrateAppSettingsSchema() error {
	columns, err := s.tableColumns("app_settings")
	if err != nil {
		return err
	}
	if columns["value"] && !columns["value_json"] {
		return nil
	}

	var raw string
	if columns["value"] {
		err = s.db.QueryRow(`SELECT value FROM app_settings WHERE key IN ('app', 'settings') ORDER BY CASE key WHEN 'app' THEN 0 ELSE 1 END LIMIT 1`).Scan(&raw)
	} else if columns["value_json"] {
		err = s.db.QueryRow(`SELECT value_json FROM app_settings WHERE key IN ('app', 'settings') ORDER BY CASE key WHEN 'app' THEN 0 ELSE 1 END LIMIT 1`).Scan(&raw)
	} else {
		err = sql.ErrNoRows
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`ALTER TABLE app_settings RENAME TO app_settings_legacy`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		CREATE TABLE app_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`); err != nil {
		return err
	}
	if raw != "" {
		if _, err := tx.Exec(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, "app", raw, nowUTC()); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DROP TABLE app_settings_legacy`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) migrateScanProfileToFull() error {
	const version = 4
	var applied int
	err := s.db.QueryRow(`SELECT 1 FROM schema_migrations WHERE version = ?`, version).Scan(&applied)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	var raw string
	err = s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if raw != "" {
		settings := DefaultAppSettings()
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return err
		}
		if settings.ScanProfile == "fast" || settings.ScanProfile == "" {
			settings.ScanProfile = "full"
			settings.ScanAnalyses.References = true
			settings.ScanAnalyses.NearDuplicates = true
			settings.ScanAnalyses.Optimization = true
			normalized, err := json.Marshal(settings)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`, string(normalized), nowUTC(), "app"); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, nowUTC()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) migrateOptimizationThresholds() error {
	const version = 5
	var applied int
	err := s.db.QueryRow(`SELECT 1 FROM schema_migrations WHERE version = ?`, version).Scan(&applied)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	var raw string
	err = s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if raw != "" {
		settings := DefaultAppSettings()
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return err
		}
		normalized, err := json.Marshal(settings)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`, string(normalized), nowUTC(), "app"); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, nowUTC()); err != nil {
		return err
	}
	return tx.Commit()
}

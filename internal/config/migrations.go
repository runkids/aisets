package config

import (
	"database/sql"
	"errors"
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
	if err := s.migrateAppSettingsSchema(); err != nil {
		return err
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`, 1, nowUTC())
	return err
}

func (s *Store) migrateAppSettingsSchema() error {
	rows, err := s.db.Query(`PRAGMA table_info(app_settings)`)
	if err != nil {
		return err
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
			return err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
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

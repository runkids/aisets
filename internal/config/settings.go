package config

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"asset-studio/internal/apierr"
)

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

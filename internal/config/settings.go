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
		ActiveWorkspaceID:          defaultWorkspaceID,
		DefaultProjectRoot:         "",
		AutoScanOnOpen:             false,
		ScanOnOpen:                 false,
		ExcludePatterns:            []string{},
		OptimizationDefaultQuality: 80,
		OptimizationAutoApply:      false,
		CustomAssetFilters:         []CustomAssetFilter{},
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
	if settings.ActiveWorkspaceID == "" {
		settings.ActiveWorkspaceID = defaultWorkspaceID
	}
	if settings.ExcludePatterns == nil {
		settings.ExcludePatterns = []string{}
	}
	if settings.CustomAssetFilters == nil {
		settings.CustomAssetFilters = []CustomAssetFilter{}
	}
	return settings, nil
}

func (s *Store) UpdateSettings(update SettingsUpdate) (AppSettings, error) {
	settings, err := s.Settings()
	if err != nil {
		return AppSettings{}, err
	}
	activeWorkspaceChanged := false
	if update.ActiveWorkspaceID != nil {
		workspaceID := strings.TrimSpace(*update.ActiveWorkspaceID)
		workspace, err := s.workspace(workspaceID)
		if err != nil {
			return AppSettings{}, err
		}
		settings.ActiveWorkspaceID = workspace.ID
		settings.WorkspaceName = workspace.Name
		activeWorkspaceChanged = true
	}
	if update.WorkspaceName != nil && !activeWorkspaceChanged {
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
	if update.CustomAssetFilters != nil {
		filters, err := normalizeCustomAssetFilters(update.CustomAssetFilters)
		if err != nil {
			return AppSettings{}, err
		}
		settings.CustomAssetFilters = filters
	}
	if settings.ActiveWorkspaceID == "" {
		settings.ActiveWorkspaceID = defaultWorkspaceID
	}
	if settings.WorkspaceName == "" {
		return AppSettings{}, apierr.New("settings_workspace_name_required", "workspace name is required")
	}
	if _, err := s.workspace(settings.ActiveWorkspaceID); err != nil {
		return AppSettings{}, err
	}
	if update.WorkspaceName != nil && !activeWorkspaceChanged {
		if _, err := s.db.Exec(`
			UPDATE workspaces
			SET name = ?, updated_at = ?
			WHERE id = ? AND deleted_at IS NULL
		`, settings.WorkspaceName, nowUTC(), settings.ActiveWorkspaceID); err != nil {
			return AppSettings{}, err
		}
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
		return ExportData{Version: 1, ExportedAt: nowUTC(), Workspaces: s.Workspaces(), Projects: s.AllProjects()}
	}
	return ExportData{Version: 1, ExportedAt: nowUTC(), Workspaces: s.Workspaces(), Projects: s.AllProjects(), Settings: &settings}
}

func (s *Store) ImportData(data ExportData) error {
	if data.Version != 1 {
		return apierr.New("settings_import_version_unsupported", "settings import version is unsupported")
	}
	for _, workspace := range data.Workspaces {
		workspace.Name = strings.TrimSpace(workspace.Name)
		if workspace.ID == "" || workspace.Name == "" {
			continue
		}
		iconImage, err := normalizeWorkspaceIconImage(workspace.IconImage)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`
			INSERT INTO workspaces (id, name, icon_image, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				icon_image = excluded.icon_image,
				deleted_at = NULL,
				updated_at = excluded.updated_at
		`, workspace.ID, workspace.Name, iconImage, nowUTC(), nowUTC()); err != nil {
			return err
		}
	}
	projectsByWorkspace := map[string][]string{}
	for _, project := range data.Projects {
		workspaceID := project.WorkspaceID
		if workspaceID == "" {
			workspaceID = s.activeWorkspaceID()
		}
		projectsByWorkspace[workspaceID] = append(projectsByWorkspace[workspaceID], project.Path)
	}
	for workspaceID, paths := range projectsByWorkspace {
		if err := s.AddProjectsToWorkspace(workspaceID, paths); err != nil {
			return err
		}
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
			CustomAssetFilters:         data.Settings.CustomAssetFilters,
		}
		if data.Settings.ActiveWorkspaceID != "" {
			update.ActiveWorkspaceID = &data.Settings.ActiveWorkspaceID
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

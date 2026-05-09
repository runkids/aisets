package config

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"aisets/internal/apierr"
	"aisets/internal/imageproc"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

func defaultGlobalExcludePatterns() []string {
	return []string{
		".git",
		".cache",
		".claude",
		".pi",
		".agents",
		".feature-radar",
		".next",
		".nuxt",
		".turbo",
		".venv",
		".pytest_cache",
		"node_modules",
		"storybook-static",
		"dist",
		"build",
		"coverage",
		"target",
		"tmp",
	}
}

func defaultExcludePatterns() []string {
	return []string{
		"**/*.test.*",
		"**/*.spec.*",
		"**/__tests__/**",
		"**/__mocks__/**",
		"**/*.stories.*",
	}
}

func defaultExcludePatternsByIntent() scanner.ExcludePatternsByIntent {
	defaults := defaultExcludePatterns()
	return scanner.ExcludePatternsByIntent{
		scanner.ProjectScanIntentCode:      append([]string{}, defaults...),
		scanner.ProjectScanIntentAssetPack: []string{},
		scanner.ProjectScanIntentLibrary:   append([]string{}, defaults...),
		scanner.ProjectScanIntentMixed:     append([]string{}, defaults...),
	}
}

func emptyExcludePatternsByIntent() scanner.ExcludePatternsByIntent {
	return scanner.ExcludePatternsByIntent{
		scanner.ProjectScanIntentCode:      []string{},
		scanner.ProjectScanIntentAssetPack: []string{},
		scanner.ProjectScanIntentLibrary:   []string{},
		scanner.ProjectScanIntentMixed:     []string{},
	}
}

func normalizeExcludePatternsByIntent(patterns scanner.ExcludePatternsByIntent) scanner.ExcludePatternsByIntent {
	out := emptyExcludePatternsByIntent()
	for intent, values := range patterns {
		normalizedIntent := scanner.NormalizeProjectScanIntent(intent)
		out[normalizedIntent] = normalizePatterns(values)
	}
	return out
}

func equalPatterns(a, b []string) bool {
	a = normalizePatterns(a)
	b = normalizePatterns(b)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func normalizeOptimizationExternalTools(tools []imageproc.OptimizationExternalTool) []imageproc.OptimizationExternalTool {
	defaults := imageproc.DefaultOptimizationExternalTools()
	enabledByID := map[string]bool{}
	for _, tool := range tools {
		enabledByID[strings.TrimSpace(tool.ID)] = tool.Enabled
	}
	for index := range defaults {
		defaults[index].Enabled = enabledByID[defaults[index].ID]
	}
	return defaults
}

func validateOptimizationExternalTools(tools []imageproc.OptimizationExternalTool) ([]imageproc.OptimizationExternalTool, error) {
	known := imageproc.KnownOptimizationExternalToolIDs()
	seen := map[string]bool{}
	for _, tool := range tools {
		id := strings.TrimSpace(tool.ID)
		if !known[id] {
			return nil, apierr.WithParams("settings_optimization_tool_unknown", "optimization tool is not supported", map[string]any{"id": id})
		}
		if seen[id] {
			return nil, apierr.WithParams("settings_optimization_tool_duplicate", "optimization tool is duplicated", map[string]any{"id": id})
		}
		seen[id] = true
	}
	return normalizeOptimizationExternalTools(tools), nil
}

func validateOptimizationStrategies(strategies []imageproc.OptimizationStrategy) ([]imageproc.OptimizationStrategy, error) {
	validFormats := map[string]bool{"svg": true, "png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "avif": true}
	validAlpha := map[string]bool{"any": true, "transparent": true, "opaque": true}
	validAnimated := map[string]bool{"any": true, "true": true, "false": true}
	validOps := map[string]bool{"convert": true, "recompress": true, "resize": true, "svg-minify": true}
	validOutput := map[string]bool{"": true, "svg": true, "png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "avif": true}
	seen := map[string]bool{}
	for _, strategy := range strategies {
		id := strings.TrimSpace(strategy.ID)
		if id == "" {
			return nil, apierr.New("settings_optimization_strategy_id_required", "optimization strategy id is required")
		}
		if seen[id] {
			return nil, apierr.WithParams("settings_optimization_strategy_duplicate", "optimization strategy is duplicated", map[string]any{"id": id})
		}
		seen[id] = true
		if strategy.Priority < 0 {
			return nil, apierr.WithParams("settings_optimization_strategy_priority_invalid", "optimization strategy priority must not be negative", map[string]any{"id": id})
		}
		if !validAlpha[strategy.Match.Alpha] && strategy.Match.Alpha != "" {
			return nil, apierr.WithParams("settings_optimization_strategy_alpha_invalid", "optimization strategy alpha matcher is invalid", map[string]any{"id": id, "alpha": strategy.Match.Alpha})
		}
		if !validAnimated[strategy.Match.Animated] && strategy.Match.Animated != "" {
			return nil, apierr.WithParams("settings_optimization_strategy_animated_invalid", "optimization strategy animated matcher is invalid", map[string]any{"id": id, "animated": strategy.Match.Animated})
		}
		for _, format := range strategy.Match.Formats {
			format = imageproc.NormalizeOptimizationFormat(format)
			if !validFormats[format] {
				return nil, apierr.WithParams("settings_optimization_strategy_format_invalid", "optimization strategy format is invalid", map[string]any{"id": id, "format": format})
			}
		}
		if !validOps[strategy.Action.Operation] {
			return nil, apierr.WithParams("settings_optimization_strategy_operation_invalid", "optimization strategy operation is invalid", map[string]any{"id": id, "operation": strategy.Action.Operation})
		}
		outputFormat := imageproc.NormalizeOptimizationFormat(strategy.Action.OutputFormat)
		if !validOutput[outputFormat] {
			return nil, apierr.WithParams("settings_optimization_strategy_output_invalid", "optimization strategy output format is invalid", map[string]any{"id": id, "outputFormat": strategy.Action.OutputFormat})
		}
		if strategy.Action.Quality != nil && (*strategy.Action.Quality < 0 || *strategy.Action.Quality > 100) {
			return nil, apierr.WithParams("settings_optimization_strategy_quality_invalid", "optimization strategy quality must be between 0 and 100", map[string]any{"id": id})
		}
		if strategy.Action.AvifSpeed != nil && (*strategy.Action.AvifSpeed < 1 || *strategy.Action.AvifSpeed > 10) {
			return nil, apierr.WithParams("settings_optimization_strategy_avif_speed_invalid", "optimization strategy AVIF speed must be between 1 and 10", map[string]any{"id": id})
		}
		if strategy.Action.ResizeMaxDimensionPx != nil && *strategy.Action.ResizeMaxDimensionPx < 0 {
			return nil, apierr.WithParams("settings_optimization_strategy_resize_invalid", "optimization strategy resize max dimension must not be negative", map[string]any{"id": id})
		}
		if strategy.Match.MinBytesKB != nil && *strategy.Match.MinBytesKB < 0 {
			return nil, apierr.WithParams("settings_optimization_strategy_min_bytes_invalid", "optimization strategy min bytes must not be negative", map[string]any{"id": id})
		}
		if strategy.Match.MinWidthPx != nil && *strategy.Match.MinWidthPx < 0 {
			return nil, apierr.WithParams("settings_optimization_strategy_min_width_invalid", "optimization strategy min width must not be negative", map[string]any{"id": id})
		}
		if strategy.Match.MinHeightPx != nil && *strategy.Match.MinHeightPx < 0 {
			return nil, apierr.WithParams("settings_optimization_strategy_min_height_invalid", "optimization strategy min height must not be negative", map[string]any{"id": id})
		}
	}
	return imageproc.NormalizeOptimizationStrategies(strategies), nil
}

func DefaultAppSettings() AppSettings {
	return AppSettings{
		WorkspaceName:              "Aisets",
		ActiveWorkspaceID:          defaultWorkspaceID,
		DefaultProjectRoot:         "",
		AutoScanOnOpen:             false,
		ScanOnOpen:                 false,
		ScanProfile:                scanner.ScanProfileFull,
		ScanAnalyses:               scanner.FullScanOptions().Analyses,
		OCREnabled:                 false,
		OCRLanguages:               []string{"eng"},
		OCRMaxPixels:               ocr.DefaultMaxPixels,
		OCRBatchSize:               ocr.DefaultBatchSize,
		OCRConcurrency:             ocr.DefaultConcurrency,
		OCRFuzzySearch:             true,
		ExcludePatterns:            defaultGlobalExcludePatterns(),
		ExcludePatternsByIntent:    defaultExcludePatternsByIntent(),
		OptimizationDefaultQuality: 80,
		OptimizationWorkers:        1,
		OptimizationAvifSpeed:      6,
		OptimizationAutoApply:      false,
		OptimizationThresholds:     imageproc.DefaultOptimizationThresholds(),
		OptimizationExternalTools:  imageproc.DefaultOptimizationExternalTools(),
		OptimizationStrategies:     imageproc.DefaultOptimizationStrategies(),
		CustomAssetFilters:         []CustomAssetFilter{},
		PreferredEditor:            "vscode",
		LLMProvider:                "",
		LLMEndpoint:                defaultLLMEndpoint(),
		LLMVisionModel:             "",
		LLMEmbedModel:              "",
	}
}

func normalizeOCRSettings(settings AppSettings) AppSettings {
	ocrSettings := ocr.NormalizeSettings(ocr.Settings{
		Enabled:     settings.OCREnabled,
		Languages:   settings.OCRLanguages,
		MaxPixels:   settings.OCRMaxPixels,
		BatchSize:   settings.OCRBatchSize,
		Concurrency: settings.OCRConcurrency,
	})
	settings.OCREnabled = ocrSettings.Enabled
	settings.OCRLanguages = ocrSettings.Languages
	settings.OCRMaxPixels = ocrSettings.MaxPixels
	settings.OCRBatchSize = ocrSettings.BatchSize
	settings.OCRConcurrency = ocrSettings.Concurrency
	return settings
}

func defaultLLMEndpoint() string {
	if v := os.Getenv("AISETS_LLM_ENDPOINT"); v != "" {
		return normalizeLLMEndpoint(v)
	}
	return "http://localhost:11434"
}

func normalizeLLMEndpoint(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	endpoint = strings.TrimRight(endpoint, "/")
	return endpoint
}

func normalizeScanSettings(settings AppSettings) AppSettings {
	options := scanner.NormalizeScanOptions(scanner.ScanOptions{
		Profile:  settings.ScanProfile,
		Analyses: settings.ScanAnalyses,
	})
	settings.ScanProfile = options.Profile
	settings.ScanAnalyses = options.Analyses
	return settings
}

func (s *Store) Settings() (AppSettings, error) {
	settings := DefaultAppSettings()
	var raw string
	err := s.rdb.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, "app").Scan(&raw)
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
	settings.ExcludePatternsByIntent = normalizeExcludePatternsByIntent(settings.ExcludePatternsByIntent)
	if settings.CustomAssetFilters == nil {
		settings.CustomAssetFilters = []CustomAssetFilter{}
	}
	if settings.OptimizationThresholds == (imageproc.OptimizationThresholds{}) {
		settings.OptimizationThresholds = imageproc.DefaultOptimizationThresholds()
	}
	settings.OptimizationExternalTools = normalizeOptimizationExternalTools(settings.OptimizationExternalTools)
	settings.OptimizationStrategies = imageproc.NormalizeOptimizationStrategies(settings.OptimizationStrategies)
	settings = normalizeScanSettings(settings)
	settings = normalizeOCRSettings(settings)
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
		settings.ScanOnOpen = settings.ScanOnOpen || *update.AutoScanOnOpen
	}
	if update.ScanOnOpen != nil {
		settings.ScanOnOpen = *update.ScanOnOpen
	}
	if update.ScanProfile != nil {
		settings.ScanProfile = *update.ScanProfile
	}
	if update.ScanAnalyses != nil {
		settings.ScanAnalyses = *update.ScanAnalyses
	}
	if update.OCREnabled != nil {
		settings.OCREnabled = *update.OCREnabled
	}
	if update.OCRLanguages != nil {
		settings.OCRLanguages = ocr.NormalizeLanguages(update.OCRLanguages)
	}
	if update.OCRMaxPixels != nil {
		if *update.OCRMaxPixels <= 0 {
			return AppSettings{}, apierr.New("settings_ocr_max_pixels_invalid", "OCR max pixels must be greater than zero")
		}
		settings.OCRMaxPixels = *update.OCRMaxPixels
	}
	if update.OCRBatchSize != nil {
		if *update.OCRBatchSize <= 0 {
			return AppSettings{}, apierr.New("settings_ocr_batch_size_invalid", "OCR batch size must be greater than zero")
		}
		settings.OCRBatchSize = *update.OCRBatchSize
	}
	if update.OCRConcurrency != nil {
		if *update.OCRConcurrency < 1 || *update.OCRConcurrency > ocr.MaxConcurrency {
			return AppSettings{}, apierr.New("settings_ocr_concurrency_invalid", "OCR concurrency must be between 1 and 2")
		}
		settings.OCRConcurrency = *update.OCRConcurrency
	}
	if update.OCRFuzzySearch != nil {
		settings.OCRFuzzySearch = *update.OCRFuzzySearch
	}
	if update.ExcludePatterns != nil {
		settings.ExcludePatterns = normalizePatterns(update.ExcludePatterns)
	}
	if update.ExcludePatternsByIntent != nil {
		settings.ExcludePatternsByIntent = normalizeExcludePatternsByIntent(update.ExcludePatternsByIntent)
	}
	if update.OptimizationDefaultQuality != nil {
		settings.OptimizationDefaultQuality = *update.OptimizationDefaultQuality
	}
	if update.OptimizationWorkers != nil {
		settings.OptimizationWorkers = *update.OptimizationWorkers
	}
	if update.OptimizationAvifSpeed != nil {
		settings.OptimizationAvifSpeed = *update.OptimizationAvifSpeed
	}
	if update.OptimizationAutoApply != nil {
		settings.OptimizationAutoApply = *update.OptimizationAutoApply
	}
	if update.OptimizationThresholds != nil {
		t := *update.OptimizationThresholds
		if t.SVGMinSavingsPercent < 0 || t.SVGMinSavingsPercent > 100 {
			return AppSettings{}, apierr.New("settings_svg_savings_invalid", "SVG min savings percent must be between 0 and 100")
		}
		if t.MaxDimensionPx < 0 {
			return AppSettings{}, apierr.New("settings_max_dimension_invalid", "max dimension must not be negative")
		}
		if t.FileSizeWarningKB < 0 {
			return AppSettings{}, apierr.New("settings_file_size_warning_invalid", "file size warning must not be negative")
		}
		if t.FileSizeCriticalKB < 0 {
			return AppSettings{}, apierr.New("settings_file_size_critical_invalid", "file size critical must not be negative")
		}
		if t.FileSizeWarningKB > 0 && t.FileSizeCriticalKB > 0 && t.FileSizeCriticalKB < t.FileSizeWarningKB {
			return AppSettings{}, apierr.New("settings_file_size_critical_below_warning", "critical threshold must be >= warning threshold")
		}
		settings.OptimizationThresholds = t
	}
	if update.OptimizationExternalTools != nil {
		tools, err := validateOptimizationExternalTools(update.OptimizationExternalTools)
		if err != nil {
			return AppSettings{}, err
		}
		settings.OptimizationExternalTools = tools
	}
	if update.OptimizationStrategies != nil {
		strategies, err := validateOptimizationStrategies(update.OptimizationStrategies)
		if err != nil {
			return AppSettings{}, err
		}
		settings.OptimizationStrategies = strategies
	}
	if update.CustomAssetFilters != nil {
		filters, err := normalizeCustomAssetFilters(update.CustomAssetFilters)
		if err != nil {
			return AppSettings{}, err
		}
		settings.CustomAssetFilters = filters
	}
	if update.PreferredEditor != nil {
		settings.PreferredEditor = *update.PreferredEditor
	}
	if update.LLMEnabled != nil {
		settings.LLMEnabled = *update.LLMEnabled
	}
	if update.LLMProvider != nil {
		p := strings.TrimSpace(*update.LLMProvider)
		if p != "" && p != "ollama" && p != "openai-compat" {
			return AppSettings{}, apierr.New("settings_llm_provider_invalid", "LLM provider must be empty, ollama, or openai-compat")
		}
		settings.LLMProvider = p
	}
	if update.LLMEndpoint != nil {
		settings.LLMEndpoint = normalizeLLMEndpoint(*update.LLMEndpoint)
	}
	if update.LLMVisionModel != nil {
		settings.LLMVisionModel = strings.TrimSpace(*update.LLMVisionModel)
	}
	if update.LLMEmbedModel != nil {
		settings.LLMEmbedModel = strings.TrimSpace(*update.LLMEmbedModel)
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
	if settings.OptimizationWorkers < 1 {
		settings.OptimizationWorkers = 1
	} else if settings.OptimizationWorkers > 4 {
		settings.OptimizationWorkers = 4
	}
	if settings.OptimizationAvifSpeed < 1 {
		settings.OptimizationAvifSpeed = 1
	} else if settings.OptimizationAvifSpeed > 10 {
		settings.OptimizationAvifSpeed = 10
	}
	settings.OptimizationExternalTools = normalizeOptimizationExternalTools(settings.OptimizationExternalTools)
	settings.OptimizationStrategies = imageproc.NormalizeOptimizationStrategies(settings.OptimizationStrategies)
	settings = normalizeScanSettings(settings)
	settings = normalizeOCRSettings(settings)
	if len(settings.OCRLanguages) == 0 {
		return AppSettings{}, apierr.New("settings_ocr_languages_required", "at least one OCR language is required")
	}
	if settings.OCRMaxPixels <= 0 {
		return AppSettings{}, apierr.New("settings_ocr_max_pixels_invalid", "OCR max pixels must be greater than zero")
	}
	if settings.OCRBatchSize <= 0 {
		return AppSettings{}, apierr.New("settings_ocr_batch_size_invalid", "OCR batch size must be greater than zero")
	}
	if settings.OCRConcurrency < 1 || settings.OCRConcurrency > ocr.MaxConcurrency {
		return AppSettings{}, apierr.New("settings_ocr_concurrency_invalid", "OCR concurrency must be between 1 and 2")
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
	projectsByWorkspace := map[string][]Project{}
	for _, project := range data.Projects {
		if strings.TrimSpace(project.Path) == "" {
			continue
		}
		project.ScanIntent = scanner.NormalizeProjectScanIntent(project.ScanIntent)
		workspaceID := project.WorkspaceID
		if workspaceID == "" {
			workspaceID = s.activeWorkspaceID()
		}
		project.WorkspaceID = workspaceID
		projectsByWorkspace[workspaceID] = append(projectsByWorkspace[workspaceID], project)
	}
	for workspaceID, projects := range projectsByWorkspace {
		for _, project := range projects {
			if err := s.AddProjectsToWorkspaceWithIntent(workspaceID, []string{project.Path}, project.ScanIntent); err != nil {
				return err
			}
			name := strings.TrimSpace(project.Name)
			if name == "" {
				continue
			}
			abs, err := filepath.Abs(project.Path)
			if err != nil {
				return err
			}
			if err := s.RenameProject(projectID(workspaceID, abs), name, project.IconImage, project.ScanIntent); err != nil {
				return err
			}
		}
	}
	if data.Settings != nil {
		excludePatterns := data.Settings.ExcludePatterns
		excludePatternsByIntent := data.Settings.ExcludePatternsByIntent
		if excludePatternsByIntent == nil {
			if equalPatterns(excludePatterns, defaultExcludePatterns()) {
				excludePatterns = []string{}
				excludePatternsByIntent = defaultExcludePatternsByIntent()
			} else {
				excludePatternsByIntent = emptyExcludePatternsByIntent()
			}
		}
		mergedScanOnOpen := data.Settings.ScanOnOpen || data.Settings.AutoScanOnOpen
		update := SettingsUpdate{
			WorkspaceName:              &data.Settings.WorkspaceName,
			DefaultProjectRoot:         &data.Settings.DefaultProjectRoot,
			ScanOnOpen:                 &mergedScanOnOpen,
			OCREnabled:                 &data.Settings.OCREnabled,
			OCRLanguages:               data.Settings.OCRLanguages,
			OCRMaxPixels:               &data.Settings.OCRMaxPixels,
			OCRBatchSize:               &data.Settings.OCRBatchSize,
			OCRConcurrency:             &data.Settings.OCRConcurrency,
			OCRFuzzySearch:             &data.Settings.OCRFuzzySearch,
			ExcludePatterns:            excludePatterns,
			ExcludePatternsByIntent:    excludePatternsByIntent,
			OptimizationDefaultQuality: &data.Settings.OptimizationDefaultQuality,
			OptimizationAutoApply:      &data.Settings.OptimizationAutoApply,
			OptimizationThresholds:     &data.Settings.OptimizationThresholds,
			OptimizationExternalTools:  data.Settings.OptimizationExternalTools,
			OptimizationStrategies:     data.Settings.OptimizationStrategies,
			CustomAssetFilters:         data.Settings.CustomAssetFilters,
			PreferredEditor:            &data.Settings.PreferredEditor,
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
		"ocr_results",
		"ai_tags",
		"asset_notes",
		"asset_labels",
		"labels",
		"near_duplicate_snapshots",
		"duplicate_group_assets",
		"duplicate_group_snapshots",
		"lint_snapshots",
		"optimization_snapshots",
		"reference_snapshots",
		"asset_snapshots",
		"scans",
		"projects",
		"workspaces",
		"app_settings",
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
	if err = tx.Commit(); err != nil {
		return err
	}
	return s.ensureDefaultWorkspace()
}

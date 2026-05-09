package server

import (
	"context"
	"net/http"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/ocr"
	"aisets/internal/optimize"
)

func settingsErrorStatus(err error) int {
	if _, ok := err.(apierr.Error); ok {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

type settingsInfo struct {
	config.AppSettings
	Workspaces               []config.Workspace     `json:"workspaces"`
	Projects                 []config.Project       `json:"projects"`
	DatabasePath             string                 `json:"databasePath"`
	DataDir                  string                 `json:"dataDir"`
	CacheDir                 string                 `json:"cacheDir"`
	OCRRuntime               ocr.RuntimeStatus      `json:"ocrRuntime"`
	OptimizationToolRuntime  []optimize.ToolRuntime `json:"optimizationToolRuntime"`
	OptimizationStrategyHash string                 `json:"optimizationStrategyHash"`
}

func (s *Server) currentSettingsInfo() (settingsInfo, error) {
	settings, err := s.store.Settings()
	if err != nil {
		return settingsInfo{}, err
	}
	return settingsInfo{
		AppSettings:              settings,
		Workspaces:               s.store.Workspaces(),
		Projects:                 s.store.AllProjects(),
		DatabasePath:             s.store.Path(),
		DataDir:                  config.DataDir(),
		CacheDir:                 config.CacheDir(),
		OCRRuntime:               ocr.Runtime(context.Background(), config.DataDir(), s.ocrEngine),
		OptimizationToolRuntime:  optimize.ToolRuntimeStatus(settings.OptimizationExternalTools),
		OptimizationStrategyHash: imageproc.OptimizationStrategyHash(settings.OptimizationStrategies, settings.OptimizationThresholds),
	}, nil
}

func (s *Server) handleSettings(w http.ResponseWriter, _ *http.Request) {
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body config.SettingsUpdate
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.ActiveWorkspaceID != nil {
		s.clearCatalog()
	}
	if body.OptimizationThresholds != nil || body.OptimizationStrategies != nil || body.ExcludePatterns != nil || body.ExcludePatternsByIntent != nil {
		s.markCatalogStale()
	}
	if _, err := s.store.UpdateSettings(body); err != nil {
		writeError(w, settingsErrorStatus(err), err)
		return
	}
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleSettingsExport(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-disposition", `attachment; filename="aisets-export.json"`)
	writeJSON(w, http.StatusOK, s.store.ExportData())
}

func (s *Server) handleSettingsImport(w http.ResponseWriter, r *http.Request) {
	var body config.ExportData
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.ImportData(body); err != nil {
		if _, ok := err.(apierr.Error); ok {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeError(w, http.StatusBadRequest, projectPathError(err, ""))
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleSettingsResetDatabase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Confirm != "RESET" {
		writeError(w, http.StatusBadRequest, apierr.New("reset_confirmation_required", "reset confirmation is required"))
		return
	}
	if err := s.store.ResetData(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

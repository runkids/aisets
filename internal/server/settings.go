package server

import (
	"context"
	"net/http"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
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
	LLMRuntime               llm.RuntimeStatus      `json:"llmRuntime"`
	AgentRuntime             agent.RuntimeStatus    `json:"agentRuntime"`
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
		LLMRuntime:               s.currentLLMRuntime(settings),
		AgentRuntime:             s.agentStatus,
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
	if body.LLMEnabled != nil || body.LLMProvider != nil || body.LLMEndpoint != nil {
		s.initLLMProvider()
	}
	if body.AgentEnabled != nil || body.AgentAdapter != nil ||
		body.LLMEnabled != nil || body.LLMProvider != nil || body.LLMVisionModel != nil {
		s.initAgentStatus()
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
	if s.rejectCatalogMutationWhileScanRunning(w) {
		return
	}
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
	if s.rejectCatalogMutationWhileScanRunning(w) {
		return
	}
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

func (s *Server) currentLLMRuntime(settings config.AppSettings) llm.RuntimeStatus {
	status := llm.RuntimeStatus{
		Provider:    settings.LLMProvider,
		Endpoint:    settings.LLMEndpoint,
		VisionModel: settings.LLMVisionModel,
		EmbedModel:  settings.LLMEmbedModel,
	}
	if s.llmProvider == nil {
		return status
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	models, err := s.llmProvider.ListModels(ctx)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.Connected = true
	status.Models = models
	return status
}

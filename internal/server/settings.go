package server

import (
	"context"
	"net/http"
	"reflect"
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
	settings.LLMEndpoint = config.ResolveEndpointForRuntime(settings.LLMEndpoint)
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
	previous, err := s.store.Settings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	updated, err := s.store.UpdateSettings(body)
	if err != nil {
		writeError(w, settingsErrorStatus(err), err)
		return
	}
	if previous.ActiveWorkspaceID != updated.ActiveWorkspaceID {
		s.clearCatalog()
	} else if settingsCatalogInputsChanged(body, previous, updated) {
		s.markCatalogStale()
	}
	if body.LLMEnabled != nil || body.LLMProvider != nil || body.LLMEndpoint != nil {
		s.initLLMProvider()
	}
	agentChanged := body.AgentEnabled != nil || body.AgentAdapter != nil
	llmAffectsAgent := s.agentStatus.Active == agent.AdapterLocalLLM &&
		(body.LLMEnabled != nil || body.LLMProvider != nil || body.LLMVisionModel != nil)
	if agentChanged || llmAffectsAgent {
		s.initAgentStatus()
		s.initAgentChat()
	}
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func settingsCatalogInputsChanged(update config.SettingsUpdate, previous, updated config.AppSettings) bool {
	return (update.OptimizationThresholds != nil && !reflect.DeepEqual(previous.OptimizationThresholds, updated.OptimizationThresholds)) ||
		(update.OptimizationStrategies != nil && !reflect.DeepEqual(previous.OptimizationStrategies, updated.OptimizationStrategies)) ||
		(update.ExcludePatterns != nil && !reflect.DeepEqual(previous.ExcludePatterns, updated.ExcludePatterns)) ||
		(update.ExcludePatternsByIntent != nil && !reflect.DeepEqual(previous.ExcludePatternsByIntent, updated.ExcludePatternsByIntent)) ||
		(update.LintRules != nil && !reflect.DeepEqual(previous.LintRules, updated.LintRules))
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

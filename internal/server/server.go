package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"aisets/internal/actions"
	"aisets/internal/agent"
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

type Options struct {
	Addr      string
	BasePath  string
	Store     *config.Store
	UIDistDir string
	Version   string
}

type Server struct {
	addr           string
	basePath       string
	store          *config.Store
	uiDistDir      string
	version        string
	mux            *http.ServeMux
	handler        http.Handler
	scanner        *scanner.Scanner
	ocrEngine      ocr.Engine
	llmProvider    llm.Provider
	agentStatus    agent.RuntimeStatus
	agentProviders map[string]agent.ChatProvider
	onReady        func()

	mu                 sync.Mutex
	catalog            scanner.Catalog
	catalogStale       bool
	previews           map[string]actions.Preview
	batchPreviews      map[string]actions.BatchPreview
	imageToolDownloads map[string]imageToolDownload

	scanMu       sync.Mutex
	scanRunning  bool
	scanProgress scanner.ScanProgress
}

func New(opts Options) (*Server, error) {
	s := &Server{
		addr:               opts.Addr,
		basePath:           normalizeBasePath(opts.BasePath),
		store:              opts.Store,
		uiDistDir:          opts.UIDistDir,
		version:            opts.Version,
		mux:                http.NewServeMux(),
		scanner:            scanner.NewWithCacheDir(config.CacheDir()),
		ocrEngine:          ocr.NewDefaultEngine(config.DataDir()),
		previews:           map[string]actions.Preview{},
		batchPreviews:      map[string]actions.BatchPreview{},
		imageToolDownloads: map[string]imageToolDownload{},
	}
	s.initLLMProvider()
	s.initAgentStatus()
	s.initAgentChat()
	s.routes()
	s.handler = s.wrapBasePath(s.mux)
	return s, nil
}

func (s *Server) SetOnReady(fn func()) {
	s.onReady = fn
}

func (s *Server) StartWithContext(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: s.handler}
	errCh := make(chan error, 1)
	go func() {
		if s.onReady != nil {
			s.onReady()
		}
		errCh <- server.Serve(listener)
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/projects", s.handleProjects)
	s.mux.HandleFunc("POST /api/workspaces/add", s.handleAddWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/switch", s.handleSwitchWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/rename", s.handleRenameWorkspace)
	s.mux.HandleFunc("POST /api/workspaces/remove", s.handleRemoveWorkspace)
	s.mux.HandleFunc("POST /api/projects/add", s.handleAddProject)
	s.mux.HandleFunc("POST /api/projects/detect-scan-intent", s.handleDetectProjectScanIntent)
	s.mux.HandleFunc("POST /api/projects/remove", s.handleRemoveProject)
	s.mux.HandleFunc("POST /api/projects/rename", s.handleRenameProject)
	s.mux.HandleFunc("GET /api/fs/directories", s.handleDirectories)
	s.mux.HandleFunc("GET /api/settings", s.handleSettings)
	s.mux.HandleFunc("GET /api/version", s.handleVersion)
	s.mux.HandleFunc("POST /api/update", s.handleUpdate)
	s.mux.HandleFunc("POST /api/restart", s.handleRestart)
	s.mux.HandleFunc("PATCH /api/settings", s.handleUpdateSettings)
	s.mux.HandleFunc("GET /api/settings/export", s.handleSettingsExport)
	s.mux.HandleFunc("POST /api/settings/import", s.handleSettingsImport)
	s.mux.HandleFunc("POST /api/settings/reset-database", s.handleSettingsResetDatabase)
	s.mux.HandleFunc("GET /api/catalog", s.handleCatalog)
	s.mux.HandleFunc("GET /api/catalog/items", s.handleCatalogItems)
	s.mux.HandleFunc("POST /api/catalog/favorites", s.handleCatalogFavorites)
	s.mux.HandleFunc("GET /api/catalog/folders", s.handleCatalogFolders)
	s.mux.HandleFunc("GET /api/catalog/items/{id}", s.handleCatalogItem)
	s.mux.HandleFunc("POST /api/catalog/items/{id}/favorite", s.handleCatalogItemFavorite)
	s.mux.HandleFunc("DELETE /api/catalog/items/{id}/favorite", s.handleCatalogItemFavorite)
	s.mux.HandleFunc("GET /api/catalog/duplicates", s.handleCatalogDuplicates)
	s.mux.HandleFunc("GET /api/catalog/lint", s.handleCatalogLint)
	s.mux.HandleFunc("POST /api/scan", s.handleScan)
	s.mux.HandleFunc("GET /api/scan/status", s.handleScanStatus)
	s.mux.HandleFunc("POST /api/ocr/install", s.handleOCRInstall)
	s.mux.HandleFunc("POST /api/ocr/remove", s.handleOCRRemove)
	s.mux.HandleFunc("POST /api/ocr/clear", s.handleOCRClear)
	s.mux.HandleFunc("POST /api/ocr/run", s.handleOCRRun)
	s.mux.HandleFunc("GET /api/scans", s.handleScans)
	s.mux.HandleFunc("POST /api/scans/clear", s.handleClearScans)
	s.mux.HandleFunc("GET /api/scans/{id}", s.handleScanSummary)
	s.mux.HandleFunc("GET /api/scans/diff", s.handleScanDiff)
	s.mux.HandleFunc("GET /api/assets/{id}", s.handleAsset)
	s.mux.HandleFunc("GET /api/thumbs/{id}", s.handleThumb)
	s.mux.HandleFunc("POST /api/actions/optimization/preview", s.handleOptimizationPreview)
	s.mux.HandleFunc("POST /api/actions/optimization/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/image-tools/assets/preview", s.handleImageToolAssetPreview)
	s.mux.HandleFunc("POST /api/image-tools/assets/process", s.handleImageToolAssetProcess)
	s.mux.HandleFunc("POST /api/image-tools/uploads/process", s.handleImageToolUploadProcess)
	s.mux.HandleFunc("GET /api/image-tools/download/{token}", s.handleImageToolDownload)
	s.mux.HandleFunc("POST /api/image-tools/assets/render-preview", s.handleImageToolRenderPreview)
	s.mux.HandleFunc("POST /api/image-tools/uploads/render-preview", s.handleImageToolUploadRenderPreview)
	s.mux.HandleFunc("GET /api/image-tools/preview/{token}", s.handleImageToolPreviewServe)
	s.mux.HandleFunc("GET /api/image-tools/metadata/{assetId}", s.handleImageToolMetadata)
	s.mux.HandleFunc("POST /api/actions/rename/preview", s.handleRenamePreview)
	s.mux.HandleFunc("POST /api/actions/rename/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/preview", s.handleMergePreview)
	s.mux.HandleFunc("POST /api/actions/merge-duplicates/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/delete-unused/preview", s.handleDeletePreview)
	s.mux.HandleFunc("POST /api/actions/delete-unused/apply", s.handleApply)
	s.mux.HandleFunc("POST /api/actions/batch/delete", s.handleBatchDelete)
	s.mux.HandleFunc("POST /api/actions/batch/move/preview", s.handleBatchMovePreview)
	s.mux.HandleFunc("POST /api/actions/batch/move/apply", s.handleBatchApply)
	s.mux.HandleFunc("POST /api/actions/batch/rename/preview", s.handleBatchRenamePreview)
	s.mux.HandleFunc("POST /api/actions/batch/rename/apply", s.handleBatchApply)
	s.mux.HandleFunc("GET /api/catalog/duplicates/trend", s.handleDuplicateTrend)
	s.mux.HandleFunc("POST /api/actions/batch/merge-duplicates/preview", s.handleBatchMergePreview)
	s.mux.HandleFunc("POST /api/actions/batch/merge-duplicates/apply", s.handleBatchApply)
	s.mux.HandleFunc("POST /api/actions/batch/copy", s.handleBatchCopy)
	s.mux.HandleFunc("POST /api/actions/batch/export", s.handleBatchExport)
	s.mux.HandleFunc("POST /api/pre-check", s.handlePreCheck)
	s.mux.HandleFunc("POST /api/pre-check/ai", s.handlePreCheckAI)
	s.mux.HandleFunc("POST /api/actions/optimization/estimate", s.handleOptimizationEstimate)
	s.mux.HandleFunc("POST /api/actions/optimization/estimate-stream", s.handleOptimizationEstimateStream)
	s.mux.HandleFunc("POST /api/actions/optimization/generate-script", s.handleOptimizationGenerateScript)
	s.mux.HandleFunc("GET /api/llm/models", s.handleLLMModels)
	s.mux.HandleFunc("POST /api/llm/health", s.handleLLMHealth)
	s.mux.HandleFunc("GET /api/tags", s.handleTagList)
	s.mux.HandleFunc("GET /api/tags/categories", s.handleTagCategories)
	s.mux.HandleFunc("GET /api/tags/category-list", s.handleTagCategoryList)
	s.mux.HandleFunc("GET /api/tags/suggest", s.handleTagSuggest)
	s.mux.HandleFunc("POST /api/tags/rename", s.handleTagRename)
	s.mux.HandleFunc("POST /api/tags/merge", s.handleTagMerge)
	s.mux.HandleFunc("POST /api/tags/delete", s.handleTagDelete)
	s.mux.HandleFunc("POST /api/tags/categories/rename", s.handleTagCategoryRename)
	s.mux.HandleFunc("POST /api/tags/categories/merge", s.handleTagCategoryMerge)
	s.mux.HandleFunc("POST /api/tags/categories/clear", s.handleTagCategoryClear)
	s.mux.HandleFunc("POST /api/assets/tags", s.handleAssetSetTags)
	s.mux.HandleFunc("POST /api/assets/description", s.handleAssetSetDescription)
	s.mux.HandleFunc("POST /api/assets/ocr-text", s.handleAssetSetOCRText)
	s.mux.HandleFunc("POST /api/ai/tag/run", s.handleAITagRun)
	s.mux.HandleFunc("POST /api/ai/tag/clear", s.handleAITagClear)
	s.mux.HandleFunc("POST /api/ai/tag/translate", s.handleAITagTranslate)
	s.mux.HandleFunc("POST /api/ai/ocr/run", s.handleVLMOCRRun)
	s.mux.HandleFunc("POST /api/ai/optimize-advice", s.handleOptimizeAIAdvice)
	s.mux.HandleFunc("POST /api/ai/duplicate-explain", s.handleDuplicateExplain)
	s.mux.HandleFunc("POST /api/ai/embed/run", s.handleEmbedRun)
	s.mux.HandleFunc("POST /api/ai/embed/clear", s.handleEmbedClear)
	s.mux.HandleFunc("POST /api/ai/embed/repair", s.handleEmbedRepair)
	s.mux.HandleFunc("GET /api/ai/embed/search", s.handleEmbedSearch)
	s.mux.HandleFunc("GET /api/ai/embed/similar/{id}", s.handleEmbedSimilar)
	s.mux.HandleFunc("GET /api/ai/embed/stats", s.handleEmbedStats)
	s.mux.HandleFunc("/api/ai/embed/calibration/labels", s.handleEmbedCalibrationLabels)
	s.mux.HandleFunc("DELETE /api/ai/embed/calibration/labels/{id}", s.handleEmbedCalibrationLabelDelete)
	s.mux.HandleFunc("POST /api/ai/embed/calibration/analyze", s.handleEmbedCalibrationAnalyze)
	s.mux.HandleFunc("POST /api/ai/canvas/chat", s.handleCanvasChat)
	s.mux.HandleFunc("POST /api/ai/canvas/upload", s.handleCanvasUpload)
	s.mux.HandleFunc("POST /api/canvas/capture", s.handleCanvasCapture)
	s.mux.HandleFunc("POST /api/canvas/capture/save", s.handleCanvasCaptureSave)
	s.mux.HandleFunc("GET /api/canvas/sessions", s.handleListCanvasSessions)
	s.mux.HandleFunc("GET /api/canvas/sessions/{id}", s.handleGetCanvasSession)
	s.mux.HandleFunc("GET /api/canvas/sessions/{id}/thumbnail", s.handleGetCanvasSessionThumbnail)
	s.mux.HandleFunc("POST /api/canvas/sessions", s.handleCreateCanvasSession)
	s.mux.HandleFunc("PATCH /api/canvas/sessions/{id}", s.handleUpdateCanvasSession)
	s.mux.HandleFunc("PATCH /api/canvas/sessions/{id}/name", s.handleRenameCanvasSession)
	s.mux.HandleFunc("DELETE /api/canvas/sessions/{id}", s.handleDeleteCanvasSession)
	s.mux.HandleFunc("GET /api/agent/status", s.handleAgentStatus)
	s.mux.HandleFunc("POST /api/agent/detect", s.handleAgentDetect)
	s.mux.HandleFunc("GET /api/prompt-presets", s.handleListPromptPresets)
	s.mux.HandleFunc("POST /api/prompt-presets", s.handleCreatePromptPreset)
	s.mux.HandleFunc("PATCH /api/prompt-presets/{id}", s.handleUpdatePromptPreset)
	s.mux.HandleFunc("DELETE /api/prompt-presets/{id}", s.handleDeletePromptPreset)
	s.mux.HandleFunc("POST /api/prompt-presets/{id}/default", s.handleSetPromptPresetDefault)
	if s.uiDistDir != "" {
		s.mux.Handle("/", spaHandlerFromDisk(s.uiDistDir, s.basePath))
	} else {
		s.mux.HandleFunc("/", uiPlaceholderHandler)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.version})
}

func (s *Server) initLLMProvider() {
	if s.store == nil {
		return
	}
	settings, err := s.store.Settings()
	if err != nil {
		return
	}
	if settings.LLMEnabled {
		s.llmProvider = newLLMProvider(settings.LLMProvider, settings.LLMEndpoint, settings.LLMApiKey)
	} else {
		s.llmProvider = nil
	}
}

func (s *Server) initAgentStatus() {
	if s.store == nil {
		return
	}
	settings, err := s.store.Settings()
	if err != nil {
		return
	}
	adapter := settings.AgentAdapter
	if !settings.AgentEnabled {
		s.agentStatus = agent.RuntimeStatus{}
		return
	}
	llmInfo := agent.LLMInfo{
		Enabled:  settings.LLMEnabled,
		Provider: settings.LLMProvider,
		Model:    settings.LLMVisionModel,
	}
	s.agentStatus = agent.BuildRuntimeStatus(context.Background(), adapter, llmInfo)
}

func (s *Server) initAgentChat() {
	for _, p := range s.agentProviders {
		_ = p.Close()
	}
	s.agentProviders = map[string]agent.ChatProvider{}
	if !s.agentStatus.Available {
		return
	}
	for _, info := range s.agentStatus.Adapters {
		chat, err := agent.NewChatProvider(info.ID, info, s.llmProvider, prepareImageForVLM)
		if err != nil {
			continue
		}
		s.agentProviders[info.ID] = chat
	}
}

func (s *Server) hasVLMBackend(settings config.AppSettings) bool {
	hasLLM := settings.LLMEnabled && settings.LLMProvider != "" && settings.LLMVisionModel != "" && s.llmProvider != nil
	return hasLLM || (settings.AgentEnabled && len(s.agentProviders) > 0)
}

func (s *Server) featureBackend(settings config.AppSettings, feature string) string {
	var perFeature string
	switch feature {
	case agent.FeatureTag:
		perFeature = settings.VLMBackendTag
	case agent.FeatureOCR:
		perFeature = settings.VLMBackendOcr
	case agent.FeatureOptimize:
		perFeature = settings.VLMBackendOptimize
	case agent.FeatureDuplicate:
		perFeature = settings.VLMBackendDuplicate
	case agent.FeaturePrecheck:
		perFeature = settings.VLMBackendPrecheck
	case agent.FeatureTranslate:
		perFeature = settings.VLMBackendTranslate
	case agent.FeatureCanvas:
		perFeature = settings.VLMBackendCanvas
	}
	if perFeature != "" {
		return perFeature
	}
	if settings.VLMBackend != "" {
		return settings.VLMBackend
	}
	return "local-llm"
}

func (s *Server) resolveVLMProviderForFeature(settings config.AppSettings, feature string) (backend, providerName, modelName string) {
	backend = s.featureBackend(settings, feature)
	if id, ok := agent.AgentBackendID(backend); ok {
		if _, ok := s.agentProviders[id]; ok {
			model := agent.AgentBackendModel(backend)
			if model == "" {
				model = settings.AgentModel
			}
			if model == "" {
				model = "default"
			}
			return backend, agent.FormatAgentBackend(id), model
		}
	}
	model := agent.LocalLLMBackendModel(backend)
	if model == "" {
		model = settings.LLMVisionModel
	}
	return "local-llm", settings.LLMProvider, model
}

func newLLMProvider(provider, endpoint, apiKey string) llm.Provider {
	return llm.NewProvider(provider, config.ResolveEndpointForRuntime(endpoint), apiKey)
}

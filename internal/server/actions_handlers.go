package server

import (
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"aisets/internal/actions"
	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/optimize"
	"aisets/internal/precheck"
	"aisets/internal/scanner"
)

func (s *Server) handleOptimizationPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
		optimize.Request
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.AssetID != "" && len(body.AssetIDs) == 0 {
		body.AssetIDs = []string{body.AssetID}
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("optimization_selection_empty", "optimization selection is empty"))
		return
	}
	project, err := s.projectByID(items[0].ProjectID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	for _, item := range items {
		if item.ProjectID != project.ID {
			writeError(w, http.StatusBadRequest, apierr.New("optimization_project_mixed", "optimization preview can only apply one project at a time"))
			return
		}
	}
	req := s.optimizationRequest(body.Request)
	preview, err := optimize.Preview(project, items, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) optimizationRequest(req optimize.Request) optimize.Request {
	settings, err := s.store.Settings()
	if err != nil {
		return req
	}
	req.Quality = settings.OptimizationDefaultQuality
	req.MaxDimensionPx = settings.OptimizationThresholds.MaxDimensionPx
	req.AvifSpeed = settings.OptimizationAvifSpeed
	req.Workers = settings.OptimizationWorkers
	req.Strategies = settings.OptimizationStrategies
	req.ExternalTools = settings.OptimizationExternalTools
	req.StrategyHash = imageproc.OptimizationStrategyHash(settings.OptimizationStrategies, settings.OptimizationThresholds)
	return req
}

func (s *Server) handleRenamePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID    string `json:"assetId"`
		TargetPath string `json:"targetPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.RenamePreview(project, item, body.TargetPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleMergePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID       string `json:"assetId"`
		PreferredPath string `json:"preferredPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.MergePreview(project, item, body.PreferredPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleDeletePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview := actions.DeleteUnusedPreview(item)
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

type optimizationSelectionBody struct {
	AssetIDs []string `json:"assetIds"`
}

func (s *Server) selectOptimizationItems(ctx context.Context, ids []string) ([]scanner.AssetItem, error) {
	if _, err := s.ensureLatestScan(ctx); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return s.store.AllOptimizableItems(0)
	}
	items, err := s.store.CatalogItemsWithOptimizationByIDs(0, ids)
	if err != nil {
		return nil, err
	}
	missing := missingAssetIDs(ids, items)
	if len(missing) > 0 {
		return nil, apierr.WithParams("asset_not_found", "one or more assets were not found", map[string]any{"assetIds": missing})
	}
	return items, nil
}

func (s *Server) handleOptimizationEstimate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		optimize.Request
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.Request.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	byProject := map[string][]scanner.AssetItem{}
	for _, item := range items {
		byProject[item.ProjectID] = append(byProject[item.ProjectID], item)
	}
	result := optimize.Estimate{BySeverity: map[string]int{"critical": 0, "warning": 0, "info": 0}}
	categorySavings := map[string]*optimize.CategoryBreakdown{}
	toolSeen := map[string]optimize.ToolStatus{}
	for projectID, projectItems := range byProject {
		project, err := s.projectByID(projectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		estimate := optimize.ComputeWithProject(project, projectItems, s.optimizationRequest(body.Request))
		result.ItemCount += estimate.ItemCount
		result.TotalBytes += estimate.TotalBytes
		result.SavingsBytes += estimate.SavingsBytes
		result.Items = append(result.Items, estimate.Items...)
		result.Operations = append(result.Operations, estimate.Operations...)
		for severity, count := range estimate.BySeverity {
			result.BySeverity[severity] += count
		}
		for _, category := range estimate.ByCategory {
			current := categorySavings[category.Category]
			if current == nil {
				current = &optimize.CategoryBreakdown{Category: category.Category}
				categorySavings[category.Category] = current
			}
			current.Count += category.Count
			current.SavingsBytes += category.SavingsBytes
		}
		for _, tool := range estimate.Tools {
			toolSeen[tool.Name] = tool
		}
	}
	for _, category := range categorySavings {
		result.ByCategory = append(result.ByCategory, *category)
	}
	for _, tool := range toolSeen {
		result.Tools = append(result.Tools, tool)
	}
	writeJSON(w, http.StatusOK, result)
}

func optimizationEstimateCost(item scanner.AssetItem, op optimize.Operation) int64 {
	width := int64(item.Image.Width)
	height := int64(item.Image.Height)
	pixels := width * height
	if pixels <= 0 {
		pixels = max(item.Bytes/1024, 1)
	}
	pages := int64(item.Image.Pages)
	if pages <= 0 {
		pages = 1
	}
	if item.Image.Animated {
		pixels *= pages
	}
	switch op.Operation {
	case "convert-avif":
		pixels *= 4
	case "convert-webp", "webp-recompress":
		pixels *= 2
	}
	return pixels + max(item.Bytes/1024, 1)
}

func (s *Server) handleOptimizationEstimateStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	var body struct {
		optimize.Request
	}
	if err := readJSON(r, &body); err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": map[string]string{"code": "bad_request", "message": err.Error()}})
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.Request.AssetIDs)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": map[string]string{"code": "internal", "message": err.Error()}})
		return
	}

	type projectGroup struct {
		project scanner.Project
		items   []scanner.AssetItem
	}
	byProject := map[string]*projectGroup{}
	for _, item := range items {
		g := byProject[item.ProjectID]
		if g == nil {
			project, err := s.projectByID(item.ProjectID)
			if err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": map[string]string{"code": "project_not_found", "message": err.Error()}})
				return
			}
			g = &projectGroup{project: project}
			byProject[item.ProjectID] = g
		}
		g.items = append(g.items, item)
	}

	type estimateWork struct {
		operation optimize.ProjectOperation
		cost      int64
	}
	var workItems []estimateWork
	for _, g := range byProject {
		itemsByID := make(map[string]scanner.AssetItem, len(g.items))
		for _, item := range g.items {
			itemsByID[item.ID] = item
		}
		req := s.optimizationRequest(body.Request)
		ops := optimize.Plan(g.items, req)
		for _, op := range ops {
			item := itemsByID[op.AssetID]
			workItems = append(workItems, estimateWork{
				operation: optimize.ProjectOperation{Project: g.project, Op: op},
				cost:      optimizationEstimateCost(item, op),
			})
		}
	}
	sort.SliceStable(workItems, func(i, j int) bool {
		return workItems[i].cost < workItems[j].cost
	})
	work := make([]optimize.ProjectOperation, 0, len(workItems))
	for _, item := range workItems {
		work = append(work, item.operation)
	}

	req := s.optimizationRequest(body.Request)
	sendNDJSON(w, map[string]any{"type": "start", "total": len(work), "workers": req.Workers})

	if req.AvifSpeed <= 0 {
		req.AvifSpeed = 10
	}
	workers := req.Workers
	if workers <= 0 {
		workers = 1
	}
	optimize.StreamMeasureOperations(r.Context(), work, req, workers, func(op optimize.Operation) {
		sendNDJSON(w, map[string]any{"type": "operation", "operation": op})
	})

	sendNDJSON(w, map[string]any{"type": "done", "total": len(work)})
}

func missingAssetIDs(ids []string, items []scanner.AssetItem) []string {
	found := map[string]bool{}
	for _, item := range items {
		found[item.ID] = true
	}
	missing := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || found[id] || seen[id] {
			continue
		}
		seen[id] = true
		missing = append(missing, id)
	}
	return missing
}

func (s *Server) handleOptimizationGenerateScript(w http.ResponseWriter, r *http.Request) {
	var body optimizationSelectionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":    "bash",
		"script":    optimize.GenerateScript(items, s.optimizationRequest(optimize.Request{})),
		"itemCount": len(items),
	})
}

func (s *Server) handlePreCheck(w http.ResponseWriter, r *http.Request) {
	const maxUploadBytes = 64 << 20 // 64 MiB total
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_parse_failed", "failed to parse upload"))
		return
	}
	if r.MultipartForm == nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	results := make([]precheck.Result, 0, len(files))
	for _, header := range files {
		res, perr := analyzeUpload(r.Context(), header, catalog)
		if perr != nil {
			writeError(w, http.StatusBadRequest, perr)
			return
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func analyzeUpload(ctx context.Context, header *multipart.FileHeader, catalog scanner.Catalog) (precheck.Result, error) {
	src, err := header.Open()
	if err != nil {
		return precheck.Result{}, apierr.New("upload_open_failed", "failed to open upload")
	}
	defer src.Close()
	tmp, err := os.CreateTemp("", "aisets-precheck-*"+filepath.Ext(header.Filename))
	if err != nil {
		return precheck.Result{}, apierr.New("upload_tempfile_failed", "failed to allocate temp file")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return precheck.Result{}, apierr.New("upload_write_failed", "failed to write upload")
	}
	if err := tmp.Close(); err != nil {
		return precheck.Result{}, apierr.New("upload_close_failed", "failed to close upload")
	}
	return precheck.Analyze(ctx, header.Filename, tmpPath, catalog)
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, ok := s.takePreview(body.Token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	project, err := s.projectByID(preview.ProjectID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var result actions.ApplyResult
	if preview.Type == "optimization" {
		result, err = optimize.Apply(project, preview)
	} else {
		result, err = actions.Apply(project, preview)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.markCatalogStale()
	go func() {
		_, _, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) projectAndItem(ctx context.Context, assetID string) (scanner.Project, scanner.AssetItem, error) {
	if _, err := s.ensureLatestScan(ctx); err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	detail, err := s.store.CatalogItemDetail(0, assetID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	project, err := s.projectByID(detail.Item.ProjectID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	return project, detail.Item, nil
}

func (s *Server) storePreview(preview actions.Preview) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.previews[preview.ID] = preview
}

func (s *Server) takePreview(id string) (actions.Preview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	preview, ok := s.previews[id]
	if ok {
		delete(s.previews, id)
	}
	return preview, ok
}

func (s *Server) handlePreCheckAI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "precheck_ai_settings_failed")})
		return
	}
	if !s.hasVLMBackend(settings) {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("llm_not_configured", "AI provider or agent adapter not configured")})
		return
	}

	const maxUploadBytes = 64 << 20
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("upload_parse_failed", "failed to parse upload")})
		return
	}
	if r.MultipartForm == nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("upload_missing", "no files uploaded")})
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("upload_missing", "no files uploaded")})
		return
	}

	catalog, _ := s.ensureCatalog(r.Context())

	backend, _, modelName := s.resolveVLMProviderForFeature(settings, agent.FeaturePrecheck)
	timeoutSec := settings.LLMTimeout
	if timeoutSec < llm.MinChatTimeout {
		timeoutSec = llm.DefaultChatTimeout
	}

	prompt := settings.LLMPrecheckPrompt
	if presetID := r.URL.Query().Get("presetId"); presetID != "" {
		if preset, perr := s.store.GetPromptPreset(presetID); perr == nil {
			prompt = config.FormatPrompt(preset.Content)
		}
	}
	if prompt == "" {
		prompt = precheck.PrecheckAIPrompt
		prompt = replaceDynamicVars(prompt, map[string]string{
			"categories":    `"icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork", "other"`,
			"qualityIssues": `"blurry", "low_resolution", "noisy", "truncated", "watermarked"`,
		})
	}
	prompt = llm.AppendLocaleInstruction(prompt, settings.LLMAutoLocale,
		r.URL.Query().Get("lang"), "Write the description, quality assessment, suitability reason, and format recommendation in")
	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)

	total := len(files)
	ready := 0
	failed := 0

	sendNDJSON(w, map[string]any{"type": "start", "total": total})

	for _, header := range files {
		result := s.analyzeUploadAI(r.Context(), header, backend, modelName, timeoutSec, systemPrompt, prompt, catalog)
		if result.Status == "ready" {
			ready++
		} else {
			failed++
		}
		sendNDJSON(w, map[string]any{"type": "result", "ai": result})
	}

	sendNDJSON(w, map[string]any{"type": "done", "counts": map[string]int{
		"total":  total,
		"ready":  ready,
		"failed": failed,
	}})
}

func (s *Server) analyzeUploadAI(ctx context.Context, header *multipart.FileHeader, backend, modelName string, timeoutSec int, systemPrompt, prompt string, catalog scanner.Catalog) precheck.AIResult {
	name := header.Filename
	src, err := header.Open()
	if err != nil {
		return precheck.AIResult{Name: name, Status: "failed", ErrorCode: "upload_open_failed", ErrorMsg: "failed to open upload"}
	}
	defer src.Close()

	ext := strings.ToLower(filepath.Ext(name))
	tmp, err := os.CreateTemp("", "aisets-precheck-ai-*"+ext)
	if err != nil {
		return precheck.AIResult{Name: name, Status: "failed", ErrorCode: "upload_tempfile_failed", ErrorMsg: "failed to allocate temp file"}
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return precheck.AIResult{Name: name, Status: "failed", ErrorCode: "upload_write_failed", ErrorMsg: "failed to write upload"}
	}
	tmp.Close()

	precheckResult, _ := precheck.Analyze(ctx, name, tmpPath, catalog)
	findings := precheck.FormatPrecheckFindings(precheckResult)
	filePrompt := strings.ReplaceAll(prompt, "{{precheckFindings}}", findings)

	start := time.Now()
	rawContent, _, err := s.chatVLM(ctx, []vlmImage{{Path: tmpPath, Ext: ext}}, backend, modelName, systemPrompt, filePrompt, timeoutSec)
	if err != nil {
		return precheck.AIResult{Name: name, Status: "failed", ErrorCode: "precheck_ai_llm_failed", ErrorMsg: err.Error()}
	}

	result := precheck.ParseAIResponse(name, rawContent)
	result.DurationMs = time.Since(start).Milliseconds()
	return result
}

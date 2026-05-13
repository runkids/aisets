package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"aisets/internal/agent"
	"aisets/internal/aitag"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/embedding"
	"aisets/internal/llm"
	"aisets/internal/scanner"
	"aisets/internal/semantic"
)

type embedCounts struct {
	Queued    int `json:"queued"`
	Processed int `json:"processed"`
	Ready     int `json:"ready"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
	CacheHit  int `json:"cacheHit"`
}

type embedWorkResult struct {
	item      scanner.AssetItem
	embedType string
	result    config.EmbeddingResult
	vector    []float32
}

type embedJob struct {
	item       scanner.AssetItem
	embedType  string
	input      string
	inputHash  string
	sourceHash string
}

func (s *Server) handleEmbedRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "embed_settings_failed")})
		return
	}
	if !settings.LLMEnabled || s.llmProvider == nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("embed_not_configured", "LLM provider not configured")})
		return
	}
	embedModel := settings.LLMEmbedModel
	visionModel := settings.LLMVisionModel
	if embedModel == "" {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("embed_model_missing", "Embed model not configured")})
		return
	}

	var body struct {
		AssetIDs []string `json:"assetIds"`
		Types    []string `json:"types"`
		Force    bool     `json:"force"`
	}
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	forceReprocess := body.Force || len(body.AssetIDs) > 0

	requestedTypes := map[string]bool{"text": true}
	if len(body.Types) > 0 {
		requestedTypes = map[string]bool{}
		for _, t := range body.Types {
			if t == "text" || t == "image" {
				requestedTypes[t] = true
			}
		}
	}

	sendNDJSON(w, map[string]any{"type": "phase", "phase": "loading"})

	activeProjectIDs := s.store.ActiveProjectIDs()
	activeProjectSet := map[string]struct{}{}
	for _, projectID := range activeProjectIDs {
		activeProjectSet[projectID] = struct{}{}
	}

	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "embed_catalog_failed")})
		return
	}

	providerName := s.llmProvider.Name()

	var sourceItems []scanner.AssetItem
	if forceReprocess {
		sourceItems, err = s.store.CatalogItemsByIDs(0, body.AssetIDs)
		if err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "embed_catalog_failed")})
			return
		}
		if activeProjectIDs != nil {
			filtered := sourceItems[:0]
			for _, item := range sourceItems {
				if _, ok := activeProjectSet[item.ProjectID]; ok {
					filtered = append(filtered, item)
				}
			}
			sourceItems = filtered
		}
	} else {
		projectFilter := parseProjectFilter(r.URL.Query().Get("projectIds"))
		sourceItems = make([]scanner.AssetItem, 0, len(catalog.Items))
		for _, rawItem := range catalog.Items {
			item := rawItem
			if _, ok := activeProjectSet[item.ProjectID]; !ok {
				continue
			}
			if projectFilter != nil {
				if _, ok := projectFilter[item.ProjectID]; !ok {
					continue
				}
			}
			sourceItems = append(sourceItems, item)
		}
	}

	var preparedItems []scanner.AssetItem
	var candidates []embedJob
	counts := embedCounts{}

	sendNDJSON(w, map[string]any{"type": "phase", "phase": "filtering", "total": len(sourceItems)})

	for i := range sourceItems {
		item := sourceItems[i]
		if !eligibleForAITag(item) {
			counts.Skipped++
			continue
		}
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			sum, algorithm, herr := scanner.ContentHash(r.Context(), item.LocalPath)
			if herr != nil {
				counts.Skipped++
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
		}
		preparedItems = append(preparedItems, item)
	}

	if requestedTypes["text"] && visionModel != "" && len(preparedItems) > 0 {
		var hashes []string
		for _, item := range preparedItems {
			hashes = append(hashes, item.ContentHash)
		}
		targetLocales := targetTranslationLocales(settings, r.URL.Query().Get("lang"))
		translateBackend, _, translateModel := s.resolveVLMProviderForFeature(settings, agent.FeatureTranslate)
		s.backfillI18nBatch(r.Context(), w, hashes, activeProjectIDs, translateBackend, translateModel, targetLocales)
	}

	for _, item := range preparedItems {
		for embedType := range requestedTypes {
			job := embedJob{item: item, embedType: embedType}
			if embedType == "text" {
				input, inputHash, sourceHash, ok, ierr := s.embeddingInputForItem(item, settings.EmbedInputFields)
				if ierr != nil {
					sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(ierr, "embed_input_failed")})
					return
				}
				if !ok {
					counts.Skipped++
					continue
				}
				job.input = input
				job.inputHash = inputHash
				job.sourceHash = sourceHash
			}
			if !forceReprocess {
				exists, cerr := s.store.HasReadyEmbedding(
					item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm,
					embedType, providerName, embedModel, job.inputHash,
				)
				if cerr != nil {
					sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(cerr, "embed_cache_failed")})
					return
				}
				if exists {
					counts.CacheHit++
					continue
				}
			}
			candidates = append(candidates, job)
			counts.Queued++
		}
	}

	sendNDJSON(w, map[string]any{"type": "start", "counts": counts, "providerName": providerName, "modelName": embedModel})

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	concurrency := min(max(settings.LLMConcurrency, 1), llm.MaxConcurrency)
	if concurrency > len(candidates) && len(candidates) > 0 {
		concurrency = len(candidates)
	}

	jobs := make(chan embedJob)
	results := make(chan embedWorkResult)
	var wg sync.WaitGroup
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				wr := s.processEmbed(ctx, job, providerName, embedModel)
				select {
				case results <- wr:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, job := range candidates {
			select {
			case <-ctx.Done():
				return
			case jobs <- job:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var firstError string
	for work := range results {
		if work.result.Status == "error" {
			counts.Failed++
			if firstError == "" {
				firstError = work.result.ErrorMessage
			}
		} else {
			counts.Ready++
		}
		counts.Processed++

		if err := s.store.UpsertEmbedding(work.result, work.vector); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "embed_persist_failed"), "counts": counts})
			return
		}

		progressEvent := map[string]any{
			"type": "progress", "assetId": work.item.ID, "repoPath": work.item.RepoPath,
			"embedType": work.embedType, "status": work.result.Status, "counts": counts,
		}
		if work.result.Status == "error" && work.result.ErrorMessage != "" {
			progressEvent["errorMessage"] = work.result.ErrorMessage
		}
		sendNDJSON(w, progressEvent)
	}

	doneEvent := map[string]any{"type": "done", "counts": counts, "providerName": providerName, "modelName": embedModel}
	if firstError != "" {
		doneEvent["firstError"] = firstError
	}
	sendNDJSON(w, doneEvent)
}

func (s *Server) processEmbed(ctx context.Context, job embedJob, providerName, modelName string) embedWorkResult {
	item := job.item
	result := config.EmbeddingResult{
		AssetID:       item.ID,
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		InputHash:     job.inputHash,
		SourceHash:    job.sourceHash,
		EmbedType:     job.embedType,
		ProviderName:  providerName,
		ModelName:     modelName,
		Status:        "ready",
	}

	var req llm.EmbedRequest
	req.Model = modelName

	switch job.embedType {
	case "text":
		if strings.TrimSpace(job.input) == "" {
			result.Status = "error"
			result.ErrorCode = "embed_no_aitag"
			result.ErrorMessage = "no usable AI Tag text for this asset"
			return embedWorkResult{item: item, embedType: job.embedType, result: result}
		}
		req.Input = job.input

	case "image":
		result.SourceHash = item.ContentHash
		dataURI, err := prepareImageForVLM(item.LocalPath, item.Ext, "embed")
		if err != nil {
			result.Status = "error"
			result.ErrorCode = "embed_image_prep_failed"
			result.ErrorMessage = err.Error()
			return embedWorkResult{item: item, embedType: job.embedType, result: result}
		}
		req.Images = []string{dataURI}
	}

	start := time.Now()
	resp, err := s.llmProvider.Embed(ctx, req)
	result.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		if errors.Is(err, llm.ErrImageEmbedNotSupported) {
			result.Status = "error"
			result.ErrorCode = "embed_image_not_supported"
			result.ErrorMessage = "provider does not support image embedding"
		} else {
			result.Status = "error"
			result.ErrorCode = "embed_llm_failed"
			result.ErrorMessage = err.Error()
		}
		return embedWorkResult{item: item, embedType: job.embedType, result: result}
	}

	result.Dimensions = resp.Dimensions
	return embedWorkResult{item: item, embedType: job.embedType, result: result, vector: resp.Embedding}
}

func (s *Server) embeddingInputForItem(item scanner.AssetItem, fields []string) (string, string, string, bool, error) {
	tagResult, err := s.store.AITagResultAnyWithEnglishForAsset(item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm)
	if err != nil {
		return "", "", "", false, err
	}
	if tagResult == nil {
		return "", "", "", false, nil
	}
	var ocrText string
	if embedInputFieldsContain(fields, "ocrText") {
		ocrText, err = s.store.LatestReadyOCRTextForAsset(item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm)
		if err != nil {
			return "", "", "", false, err
		}
	}
	input := buildEmbeddingInput(item, *tagResult, ocrText, fields)
	if strings.TrimSpace(input) == "" {
		return "", "", "", false, nil
	}
	inputHash := hashEmbeddingInput(input)
	sourceHash := hashEmbeddingInput(strings.Join(normalizeEmbedInputFields(fields), "\x00") + "\x00" + input)
	return input, inputHash, sourceHash, true, nil
}

const i18nBatchSize = 10

var localeDisplayNames = map[string]string{
	"en": "English", "zh-TW": "Traditional Chinese", "zh-CN": "Simplified Chinese",
	"ja": "Japanese", "ko": "Korean",
}

type i18nBackfillItem struct {
	ID          int      `json:"id"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Description string   `json:"description"`
}

type i18nPromptRow struct {
	ID          int      `json:"id"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Description string   `json:"description"`
}

type i18nBackfillSummary struct {
	Translated int      `json:"translated"`
	Total      int      `json:"total"`
	Skipped    int      `json:"skipped"`
	Locales    []string `json:"locales"`
	Warnings   []string `json:"warnings,omitempty"`
}

func (s *i18nBackfillSummary) addWarning(message string) {
	if message == "" || len(s.Warnings) >= 5 {
		return
	}
	s.Warnings = append(s.Warnings, message)
}

func parseI18nBackfillResponse(content string) ([]i18nBackfillItem, error) {
	cleaned := llm.CleanJSON(content)
	var wrapped struct {
		Translations []i18nBackfillItem `json:"translations"`
	}
	if err := json.Unmarshal([]byte(cleaned), &wrapped); err == nil && len(wrapped.Translations) > 0 {
		return wrapped.Translations, nil
	}
	var direct []i18nBackfillItem
	if err := json.Unmarshal([]byte(cleaned), &direct); err != nil {
		return nil, err
	}
	return direct, nil
}

func i18nBackfillPrompt(langName string, rows []config.AITagI18nRow) string {
	promptRows := make([]i18nPromptRow, 0, len(rows))
	for j, row := range rows {
		promptRows = append(promptRows, i18nPromptRow{
			ID:          j + 1,
			Category:    row.Category,
			Tags:        row.Tags,
			Description: row.Description,
		})
	}
	rowsJSON, _ := json.Marshal(promptRows)
	return "Translate each item to " + langName + ". Return ONLY valid JSON in this exact shape: " +
		`{"translations":[{"id":1,"category":"...","tags":["..."],"description":"..."}]}` + "\n" +
		"Rules: preserve each id exactly, return exactly " + strconv.Itoa(len(rows)) + " translation objects, keep tags in the same count and order as the input tags, and do not use numbering or template placeholders.\n\n" +
		"Input items JSON:\n" + string(rowsJSON)
}

func (s *Server) translateI18nRows(ctx context.Context, locale, langName string, rows []config.AITagI18nRow, backend, modelName string) (int, []config.AITagI18nRow, int, string) {
	content, err := s.chatText(ctx, backend, modelName, i18nBackfillPrompt(langName, rows), 30)
	if err != nil {
		return 0, rows, 0, "failed to translate " + locale + " batch: " + err.Error()
	}

	items, err := parseI18nBackfillResponse(content)
	if err != nil {
		return 0, rows, 0, "invalid " + locale + " translation response: " + err.Error()
	}

	seen := map[int]bool{}
	translated := 0
	skipped := 0
	retryRows := []config.AITagI18nRow{}
	for _, item := range items {
		if item.ID < 1 || item.ID > len(rows) || seen[item.ID] {
			skipped++
			continue
		}
		seen[item.ID] = true
		row := rows[item.ID-1]
		raw := aitag.Result{Status: aitag.StatusReady, Category: row.Category, Tags: row.Tags, Description: row.Description}
		if !aitag.IsLocaleTranslationUsableForLocale(raw, locale, item.Category, item.Tags, item.Description) {
			retryRows = append(retryRows, row)
			continue
		}
		applied, err := s.store.BackfillLocaleI18nForAssetApplied(row.ProjectID, row.RepoPath, row.ContentHash, row.HashAlgorithm, locale, item.Category, item.Tags, item.Description)
		if err != nil || !applied {
			retryRows = append(retryRows, row)
			continue
		}
		translated++
	}
	for i, row := range rows {
		if !seen[i+1] {
			retryRows = append(retryRows, row)
		}
	}
	return translated, retryRows, skipped, ""
}

func (s *Server) backfillI18nBatch(ctx context.Context, w http.ResponseWriter, contentHashes []string, projectIDs []string, backend, modelName string, targetLocales []string) i18nBackfillSummary {
	summary := i18nBackfillSummary{Locales: targetLocales}
	for _, locale := range targetLocales {
		missing, err := s.store.AITagsMissingLocaleForProjects(locale, contentHashes, projectIDs)
		if err != nil {
			warning := "failed to load missing " + locale + " translations"
			summary.addWarning(warning)
			sendNDJSON(w, map[string]any{"type": "translating", "locale": locale, "locales": targetLocales, "warning": warning})
			continue
		}
		if len(missing) == 0 {
			continue
		}
		summary.Total += len(missing)

		langName := localeDisplayNames[locale]
		if langName == "" {
			langName = locale
		}

		sendNDJSON(w, map[string]any{"type": "translating", "locale": locale, "locales": targetLocales, "total": len(missing)})

		localeTranslated := 0
		localeSkipped := 0
		for i := 0; i < len(missing); i += i18nBatchSize {
			if ctx.Err() != nil {
				return summary
			}
			end := min(i+i18nBatchSize, len(missing))
			batch := missing[i:end]

			translated, retryRows, skipped, warning := s.translateI18nRows(ctx, locale, langName, batch, backend, modelName)
			if warning != "" {
				summary.addWarning(warning)
			}
			if len(retryRows) > 0 {
				for _, row := range retryRows {
					if ctx.Err() != nil {
						return summary
					}
					retryTranslated, retryFailedRows, retrySkipped, retryWarning := s.translateI18nRows(ctx, locale, langName, []config.AITagI18nRow{row}, backend, modelName)
					translated += retryTranslated
					skipped += retrySkipped
					if retryWarning != "" {
						summary.addWarning(retryWarning)
					}
					if len(retryFailedRows) > 0 {
						skipped += len(retryFailedRows)
					}
				}
			}
			if skipped > 0 {
				summary.addWarning("some " + locale + " translations were skipped after retry")
			}
			summary.Translated += translated
			summary.Skipped += skipped
			localeTranslated += translated
			localeSkipped += skipped
			event := map[string]any{"type": "translating", "locale": locale, "locales": targetLocales, "translated": localeTranslated, "total": len(missing), "skipped": localeSkipped}
			if warning != "" {
				event["warning"] = warning
			}
			sendNDJSON(w, event)
		}
	}
	return summary
}

func (s *Server) chatText(ctx context.Context, backend, modelName, prompt string, timeoutSec int) (string, error) {
	if id, ok := agent.AgentBackendID(backend); ok {
		if provider, ok := s.agentProviders[id]; ok {
			cliModel := modelName
			if cliModel == "default" {
				cliModel = ""
			}
			var res agent.ChatResult
			_ = provider.ChatBatch(ctx, []agent.ChatRequest{{
				Model:      cliModel,
				Prompt:     prompt,
				TimeoutSec: timeoutSec,
			}}, func(_ int, r agent.ChatResult) { res = r })
			if res.Err != nil {
				return "", res.Err
			}
			return res.Content, nil
		}
	}
	resp, err := s.llmProvider.Chat(ctx, llm.ChatRequest{
		Model: modelName,
		Messages: []llm.ChatMessage{
			{Role: "user", Content: prompt},
		},
		TimeoutSec: timeoutSec,
	})
	if err != nil {
		return "", err
	}
	return resp.Content, nil
}

func (s *Server) handleAITagTranslate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "translate_settings_failed")})
		return
	}
	if !s.hasVLMBackend(settings) {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("translate_not_configured", "LLM provider not configured")})
		return
	}

	backend, _, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureTranslate)

	targetLocales := targetTranslationLocales(settings, r.URL.Query().Get("lang"))

	activeProjectIDs := s.store.ActiveProjectIDs()
	hashes, err := s.store.AllReadyAITagHashesForProjects(activeProjectIDs)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "translate_hash_failed")})
		return
	}
	if len(hashes) == 0 {
		sendNDJSON(w, map[string]any{"type": "done", "translated": 0})
		return
	}

	summary := s.backfillI18nBatch(r.Context(), w, hashes, activeProjectIDs, backend, modelName, targetLocales)
	sendNDJSON(w, map[string]any{"type": "done", "translated": summary.Translated, "total": summary.Total, "skipped": summary.Skipped, "locales": summary.Locales, "warnings": summary.Warnings})
}

func (s *Server) handleEmbedClear(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.RemoveEmbeddings(); err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_clear_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleEmbedRepair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Apply bool `json:"apply"`
	}
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	report, err := s.store.RepairEmbeddingInputs(body.Apply)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_repair_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dryRun": !body.Apply,
		"apply":  body.Apply,
		"counts": report,
	})
}

func (s *Server) handleEmbedSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_settings_failed"))
		return
	}

	embedType := r.URL.Query().Get("type")
	limit := settings.EmbedSearchLimit
	if limit == 0 {
		limit = 20
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 100 {
		limit = n
	}
	threshold := float32(settings.EmbedSearchThreshold)
	if threshold == 0 {
		threshold = 0.4
	}
	if f, err := strconv.ParseFloat(r.URL.Query().Get("threshold"), 32); err == nil {
		threshold = float32(f)
	}
	filter, statusCode, err := s.semanticCatalogFilter(r, settings)
	if err != nil {
		writeError(w, statusCode, err)
		return
	}
	response, err := semantic.Search(r.Context(), s.store, s.llmProvider, settings, semantic.Query{
		Text:       q,
		Type:       embedType,
		Limit:      limit,
		Threshold:  threshold,
		Filter:     filter,
		ProjectIDs: s.store.ActiveProjectIDs(),
	})
	if err != nil {
		writeError(w, semanticSearchErrorStatus(err), err)
		return
	}
	if r.URL.Query().Get("includeItems") == "true" && len(response.Results) > 0 {
		if err := s.attachSemanticItems(r.Context(), &response, filter.ScanID, settings); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func semanticSearchErrorStatus(err error) int {
	switch apierr.From(err, "embed_search_failed").Code {
	case "embed_query_failed", "embed_load_failed":
		return http.StatusInternalServerError
	default:
		return http.StatusBadRequest
	}
}

func (s *Server) semanticCatalogFilter(r *http.Request, settings config.AppSettings) (config.CatalogItemQuery, int, error) {
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		return config.CatalogItemQuery{}, http.StatusBadRequest, err
	}
	query := config.CatalogItemQuery{
		ScanID:               scanID,
		AssetID:              r.URL.Query().Get("assetId"),
		ProjectID:            r.URL.Query().Get("projectId"),
		ProjectName:          r.URL.Query().Get("projectName"),
		Ext:                  r.URL.Query().Get("ext"),
		Folder:               r.URL.Query().Get("folder"),
		Query:                r.URL.Query().Get("catalogQ"),
		Status:               r.URL.Query().Get("status"),
		CustomFilterID:       r.URL.Query().Get("customFilter"),
		OptimizationCategory: r.URL.Query().Get("optimizationCategory"),
		OptimizationSeverity: r.URL.Query().Get("optimizationSeverity"),
		Operation:            r.URL.Query().Get("operation"),
		AICategory:           r.URL.Query().Get("aiCategory"),
		Locale:               sanitizeLocale(r.URL.Query().Get("lang")),
		AIOcrStatus:          r.URL.Query().Get("aiOcrStatus"),
	}
	if v := r.URL.Query().Get("hasGPS"); v != "" {
		val := v == "true"
		query.HasGPS = &val
	}
	_, vlmProvider, vlmModel := s.resolveVLMProviderForFeature(settings, agent.FeatureOCR)
	if vlmProvider != "" && vlmModel != "" {
		query.VLMEngineVersion = vlmProvider + "/" + vlmModel
	}
	return query, http.StatusOK, nil
}

func (s *Server) attachSemanticItems(ctx context.Context, response *semantic.Response, scanID int64, settings config.AppSettings) error {
	ids := make([]string, 0, len(response.Results))
	for _, result := range response.Results {
		ids = append(ids, result.AssetID)
	}
	items, err := s.store.CatalogItemsWithOptimizationByIDs(scanID, ids)
	if err != nil {
		return err
	}
	catalog := scanner.Catalog{Items: items}
	catalog, err = s.enrichCatalogOCR(ctx, catalog)
	if err != nil {
		return err
	}
	catalog, err = s.enrichCatalogAITag(catalog, settings)
	if err != nil {
		return err
	}
	catalog, err = s.enrichCatalogEXIF(catalog, scanID)
	if err != nil {
		return err
	}
	byID := make(map[string]scanner.AssetItem, len(catalog.Items))
	for _, item := range catalog.Items {
		byID[item.ID] = item
	}
	for i := range response.Results {
		if item, ok := byID[response.Results[i].AssetID]; ok {
			copy := item
			response.Results[i].Item = &copy
		}
	}
	return nil
}

func (s *Server) handleEmbedSimilar(w http.ResponseWriter, r *http.Request) {
	assetID := r.PathValue("id")
	if assetID == "" {
		writeJSON(w, http.StatusBadRequest, apierr.New("embed_missing_id", "asset id is required"))
		return
	}

	embedType := r.URL.Query().Get("type")
	if embedType == "" {
		embedType = "text"
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 10
	if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 100 {
		limit = n
	}

	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_settings_failed"))
		return
	}
	if !settings.LLMEnabled || s.llmProvider == nil || settings.LLMEmbedModel == "" {
		writeJSON(w, http.StatusBadRequest, apierr.New("embed_not_configured", "LLM provider or embed model not configured"))
		return
	}
	providerName := s.llmProvider.Name()
	activeProjectIDs := s.store.ActiveProjectIDs()
	source, err := s.store.EmbeddingForAssetScopedInProjects(assetID, embedType, providerName, settings.LLMEmbedModel, activeProjectIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_lookup_failed"))
		return
	}
	if source == nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}, "totalEmbeddings": 0})
		return
	}

	allEmbeddings, err := s.store.ReadyEmbeddings(config.EmbeddingQuery{
		EmbedType:    embedType,
		ProviderName: providerName,
		ModelName:    settings.LLMEmbedModel,
		Dimensions:   source.Dimensions,
		ProjectIDs:   activeProjectIDs,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_load_failed"))
		return
	}

	type scoredResult struct {
		AssetID      string  `json:"assetId"`
		ProjectID    string  `json:"projectId"`
		RepoPath     string  `json:"repoPath"`
		Similarity   float32 `json:"similarity"`
		ThumbnailURL string  `json:"thumbnailUrl"`
	}

	var matches []scoredResult
	for _, emb := range allEmbeddings {
		if emb.AssetID == assetID {
			continue
		}
		sim := embedding.CosineSimilarity(source.Vector, emb.Vector)
		if sim > 0 {
			matches = append(matches, scoredResult{
				AssetID:      emb.AssetID,
				ProjectID:    emb.ProjectID,
				RepoPath:     emb.RepoPath,
				Similarity:   sim,
				ThumbnailURL: "/api/thumbs/" + emb.AssetID + "?v=" + emb.ContentHash,
			})
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Similarity > matches[j].Similarity })
	if len(matches) > limit {
		matches = matches[:limit]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"results":         matches,
		"totalEmbeddings": len(allEmbeddings),
	})
}

func (s *Server) handleEmbedStats(w http.ResponseWriter, _ *http.Request) {
	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_settings_failed"))
		return
	}
	providerName := settings.LLMProvider
	if s.llmProvider != nil {
		providerName = s.llmProvider.Name()
	}
	if providerName == "" || settings.LLMEmbedModel == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"textCount": 0, "imageCount": 0,
			"providerName": providerName, "modelName": settings.LLMEmbedModel,
			"dimensions": 0,
		})
		return
	}
	activeProjectIDs := s.store.ActiveProjectIDs()
	textCount, imageCount, err := s.store.EmbeddingReadyCountsForModelInProjects(providerName, settings.LLMEmbedModel, activeProjectIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_stats_failed"))
		return
	}
	dimensions, err := s.store.EmbeddingReadyDimensionsForModelInProjects(providerName, settings.LLMEmbedModel, activeProjectIDs)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_stats_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"textCount": textCount, "imageCount": imageCount,
		"providerName": providerName, "modelName": settings.LLMEmbedModel,
		"dimensions": dimensions,
	})
}

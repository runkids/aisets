package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"aisets/internal/agent"
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
	} else {
		projectFilter := parseProjectFilter(r.URL.Query().Get("projectIds"))
		sourceItems = make([]scanner.AssetItem, 0, len(catalog.Items))
		for _, rawItem := range catalog.Items {
			item := rawItem
			if projectFilter != nil {
				if _, ok := projectFilter[item.ProjectID]; !ok {
					continue
				}
			}
			sourceItems = append(sourceItems, item)
		}
	}

	type embedJob struct {
		item      scanner.AssetItem
		embedType string
	}

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

		for embedType := range requestedTypes {
			if !forceReprocess {
				exists, cerr := s.store.HasReadyEmbedding(
					item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm,
					embedType, providerName, embedModel,
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
			candidates = append(candidates, embedJob{item: item, embedType: embedType})
			counts.Queued++
		}
	}

	if requestedTypes["text"] && visionModel != "" {
		var hashes []string
		for _, job := range candidates {
			if job.embedType == "text" {
				hashes = append(hashes, job.item.ContentHash)
			}
		}
		if len(hashes) > 0 {
			targetLocales := settings.LLMTranslationLocales
			if len(targetLocales) == 0 {
				targetLocales = []string{"en"}
			}
			translateBackend, _, translateModel := s.resolveVLMProviderForFeature(settings, agent.FeatureTranslate)
			s.backfillI18nBatch(r.Context(), w, hashes, translateBackend, translateModel, targetLocales)
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
				wr := s.processEmbed(ctx, job.item, job.embedType, providerName, embedModel)
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

func (s *Server) processEmbed(ctx context.Context, item scanner.AssetItem, embedType, providerName, modelName string) embedWorkResult {
	result := config.EmbeddingResult{
		AssetID:       item.ID,
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		EmbedType:     embedType,
		ProviderName:  providerName,
		ModelName:     modelName,
		Status:        "ready",
	}

	var req llm.EmbedRequest
	req.Model = modelName

	switch embedType {
	case "text":
		tagResult, err := s.store.AITagResultAnyWithEnglish(item.ContentHash, item.HashAlgorithm)
		if err != nil || tagResult == nil {
			result.Status = "error"
			result.ErrorCode = "embed_no_aitag"
			result.ErrorMessage = "no ready AI Tag result for this asset"
			return embedWorkResult{item: item, embedType: embedType, result: result}
		}
		parts := []string{tagResult.Category}
		if len(tagResult.Tags) > 0 {
			parts = append(parts, tagResult.Tags...)
		}
		if tagResult.Description != "" {
			parts = append(parts, tagResult.Description)
		}
		name := filepath.Base(item.RepoPath)
		if ext := filepath.Ext(name); ext != "" {
			name = strings.TrimSuffix(name, ext)
		}
		name = strings.ReplaceAll(strings.ReplaceAll(name, "_", " "), "-", " ")
		parts = append(parts, name)
		req.Input = strings.Join(parts, " ")

	case "image":
		dataURI, err := prepareImageForVLM(item.LocalPath, item.Ext, "embed")
		if err != nil {
			result.Status = "error"
			result.ErrorCode = "embed_image_prep_failed"
			result.ErrorMessage = err.Error()
			return embedWorkResult{item: item, embedType: embedType, result: result}
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
		return embedWorkResult{item: item, embedType: embedType, result: result}
	}

	result.Dimensions = resp.Dimensions
	return embedWorkResult{item: item, embedType: embedType, result: result, vector: resp.Embedding}
}

const i18nBatchSize = 50

var localeDisplayNames = map[string]string{
	"en": "English", "zh-TW": "Traditional Chinese", "zh-CN": "Simplified Chinese",
	"ja": "Japanese", "ko": "Korean",
}

func (s *Server) backfillI18nBatch(ctx context.Context, w http.ResponseWriter, contentHashes []string, backend, modelName string, targetLocales []string) {
	for _, locale := range targetLocales {
		missing, err := s.store.AITagsMissingLocale(locale, contentHashes)
		if err != nil || len(missing) == 0 {
			continue
		}

		langName := localeDisplayNames[locale]
		if langName == "" {
			langName = locale
		}

		sendNDJSON(w, map[string]any{"type": "translating", "locale": locale, "total": len(missing)})

		for i := 0; i < len(missing); i += i18nBatchSize {
			if ctx.Err() != nil {
				return
			}
			end := min(i+i18nBatchSize, len(missing))
			batch := missing[i:end]

			prompt := "Translate each numbered item to " + langName + ". Return ONLY the translations, one per line, same numbering. Format: category | tag1, tag2, ... | description\n\n"
			for j, row := range batch {
				text := row.Category
				if len(row.Tags) > 0 {
					text += " | " + strings.Join(row.Tags, ", ")
				}
				if row.Description != "" {
					text += " | " + row.Description
				}
				prompt += strconv.Itoa(j+1) + ". " + text + "\n"
			}

			content, err := s.chatText(ctx, backend, modelName, prompt, 30)
			if err != nil {
				continue
			}

			lines := strings.Split(strings.TrimSpace(content), "\n")
			for j, row := range batch {
				if j >= len(lines) {
					break
				}
				line := strings.TrimSpace(lines[j])
				if idx := strings.Index(line, ". "); idx >= 0 && idx <= 3 {
					line = strings.TrimSpace(line[idx+2:])
				}
				parts := strings.SplitN(line, "|", 3)
				cat := strings.TrimSpace(parts[0])
				var tags []string
				var desc string
				if len(parts) >= 2 {
					for _, t := range strings.Split(parts[1], ",") {
						if t = strings.TrimSpace(t); t != "" {
							tags = append(tags, t)
						}
					}
				}
				if len(parts) >= 3 {
					desc = strings.TrimSpace(parts[2])
				}
				if cat == "" {
					continue
				}
				_ = s.store.BackfillLocaleI18n(row.ContentHash, row.HashAlgorithm, locale, cat, tags, desc)
			}

			sendNDJSON(w, map[string]any{"type": "translating", "locale": locale, "translated": min(end, len(missing)), "total": len(missing)})
		}
	}
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

	targetLocales := settings.LLMTranslationLocales
	if len(targetLocales) == 0 {
		targetLocales = []string{"en"}
	}

	hashes, err := s.store.AllReadyAITagHashes()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "translate_hash_failed")})
		return
	}
	if len(hashes) == 0 {
		sendNDJSON(w, map[string]any{"type": "done", "translated": 0})
		return
	}

	s.backfillI18nBatch(r.Context(), w, hashes, backend, modelName, targetLocales)
	sendNDJSON(w, map[string]any{"type": "done"})
}

func (s *Server) handleEmbedClear(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.RemoveEmbeddings(); err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_clear_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
		threshold = 0.5
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
		Text:      q,
		Type:      embedType,
		Limit:     limit,
		Threshold: threshold,
		Filter:    filter,
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

	source, err := s.store.EmbeddingForAsset(assetID, embedType)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_lookup_failed"))
		return
	}
	if source == nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}, "totalEmbeddings": 0})
		return
	}

	allEmbeddings, err := s.store.AllReadyEmbeddings(embedType)
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
	textCount, imageCount, err := s.store.EmbeddingReadyCounts()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_stats_failed"))
		return
	}
	dimensions, err := s.store.EmbeddingReadyDimensions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_stats_failed"))
		return
	}
	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_settings_failed"))
		return
	}
	providerName := settings.LLMProvider
	if s.llmProvider != nil {
		providerName = s.llmProvider.Name()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"textCount": textCount, "imageCount": imageCount,
		"providerName": providerName, "modelName": settings.LLMEmbedModel,
		"dimensions": dimensions,
	})
}

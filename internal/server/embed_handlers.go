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

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/embedding"
	"aisets/internal/llm"
	"aisets/internal/scanner"
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
	if embedModel == "" {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("embed_model_missing", "Embed model not configured")})
		return
	}

	var body struct {
		AssetIDs []string `json:"assetIds"`
		Types    []string `json:"types"`
	}
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	forceReprocess := len(body.AssetIDs) > 0

	requestedTypes := map[string]bool{"text": true}
	if len(body.Types) > 0 {
		requestedTypes = map[string]bool{}
		for _, t := range body.Types {
			if t == "text" || t == "image" {
				requestedTypes[t] = true
			}
		}
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
		tagResult, err := s.store.AITagResultAny(item.ContentHash, item.HashAlgorithm)
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

func (s *Server) handleEmbedClear(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.RemoveEmbeddings(); err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_clear_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleEmbedSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, apierr.New("embed_search_empty", "query parameter q is required"))
		return
	}

	embedType := r.URL.Query().Get("type")
	if embedType == "" {
		embedType = "text"
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 100 {
		limit = n
	}
	thresholdStr := r.URL.Query().Get("threshold")
	threshold := float32(0.3)
	if f, err := strconv.ParseFloat(thresholdStr, 32); err == nil {
		threshold = float32(f)
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

	start := time.Now()
	queryResp, err := s.llmProvider.Embed(r.Context(), llm.EmbedRequest{
		Model: settings.LLMEmbedModel,
		Input: q,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_query_failed"))
		return
	}

	allEmbeddings, err := s.store.AllReadyEmbeddings(embedType)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_load_failed"))
		return
	}

	type scoredResult struct {
		AssetID    string  `json:"assetId"`
		ProjectID  string  `json:"projectId"`
		RepoPath   string  `json:"repoPath"`
		Similarity float32 `json:"similarity"`
	}

	var matches []scoredResult
	for _, emb := range allEmbeddings {
		sim := embedding.CosineSimilarity(queryResp.Embedding, emb.Vector)
		if sim >= threshold {
			matches = append(matches, scoredResult{
				AssetID:    emb.AssetID,
				ProjectID:  emb.ProjectID,
				RepoPath:   emb.RepoPath,
				Similarity: sim,
			})
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Similarity > matches[j].Similarity })
	if len(matches) > limit {
		matches = matches[:limit]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"results":         matches,
		"queryDurationMs": time.Since(start).Milliseconds(),
		"totalEmbeddings": len(allEmbeddings),
	})
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
		AssetID    string  `json:"assetId"`
		ProjectID  string  `json:"projectId"`
		RepoPath   string  `json:"repoPath"`
		Similarity float32 `json:"similarity"`
	}

	var matches []scoredResult
	for _, emb := range allEmbeddings {
		if emb.AssetID == assetID {
			continue
		}
		sim := embedding.CosineSimilarity(source.Vector, emb.Vector)
		if sim > 0 {
			matches = append(matches, scoredResult{
				AssetID:    emb.AssetID,
				ProjectID:  emb.ProjectID,
				RepoPath:   emb.RepoPath,
				Similarity: sim,
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
	writeJSON(w, http.StatusOK, map[string]any{"textCount": textCount, "imageCount": imageCount})
}

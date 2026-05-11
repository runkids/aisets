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

func containsNonLatin(s string) bool {
	for _, r := range s {
		if r > 0x024F {
			return true
		}
	}
	return false
}

func (s *Server) translateToEnglish(ctx context.Context, text, model string) string {
	resp, err := s.llmProvider.Chat(ctx, llm.ChatRequest{
		Model: model,
		Messages: []llm.ChatMessage{
			{Role: "system", Content: "Translate the user's text to English. Output ONLY the English translation, nothing else. Keep it concise."},
			{Role: "user", Content: text},
		},
		TimeoutSec: 10,
	})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(resp.Content)
}

func (s *Server) handleEmbedSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, apierr.New("embed_search_empty", "query parameter q is required"))
		return
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

	embedType := r.URL.Query().Get("type")
	if embedType == "" {
		embedType = settings.EmbedSearchType
		if embedType == "" {
			embedType = "hybrid"
		}
	}
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

	start := time.Now()

	queryTexts := []string{q}
	if containsNonLatin(q) {
		if translated := s.translateToEnglish(r.Context(), q, settings.LLMVisionModel); translated != "" && translated != q {
			queryTexts = []string{translated}
		}
	}

	var queryVectors [][]float32
	for _, text := range queryTexts {
		resp, err := s.llmProvider.Embed(r.Context(), llm.EmbedRequest{
			Model: settings.LLMEmbedModel,
			Input: text,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_query_failed"))
			return
		}
		queryVectors = append(queryVectors, resp.Embedding)
	}

	// Load embeddings: hybrid queries both text and image, takes max per asset.
	typesToQuery := []string{embedType}
	if embedType == "hybrid" {
		typesToQuery = []string{"text", "image"}
	}

	type assetScore struct {
		projectID   string
		repoPath    string
		contentHash string
		similarity  float32
	}
	bestPerAsset := map[string]*assetScore{}

	var totalEmbeddings int
	for _, et := range typesToQuery {
		embs, err := s.store.AllReadyEmbeddings(et)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apierr.From(err, "embed_load_failed"))
			return
		}
		totalEmbeddings += len(embs)
		for _, emb := range embs {
			var best float32
			for _, qv := range queryVectors {
				if sim := embedding.CosineSimilarity(qv, emb.Vector); sim > best {
					best = sim
				}
			}
			if prev, ok := bestPerAsset[emb.AssetID]; ok {
				if best > prev.similarity {
					prev.similarity = best
				}
			} else {
				bestPerAsset[emb.AssetID] = &assetScore{
					projectID:   emb.ProjectID,
					repoPath:    emb.RepoPath,
					contentHash: emb.ContentHash,
					similarity:  best,
				}
			}
		}
	}

	type scoredResult struct {
		AssetID      string  `json:"assetId"`
		ProjectID    string  `json:"projectId"`
		RepoPath     string  `json:"repoPath"`
		Similarity   float32 `json:"similarity"`
		ThumbnailURL string  `json:"thumbnailUrl"`
	}

	var matches []scoredResult
	for assetID, sc := range bestPerAsset {
		if sc.similarity >= threshold {
			matches = append(matches, scoredResult{
				AssetID:      assetID,
				ProjectID:    sc.projectID,
				RepoPath:     sc.repoPath,
				Similarity:   sc.similarity,
				ThumbnailURL: "/api/thumbs/" + assetID + "?v=" + sc.contentHash,
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
		"totalEmbeddings": totalEmbeddings,
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
	writeJSON(w, http.StatusOK, map[string]any{"textCount": textCount, "imageCount": imageCount})
}

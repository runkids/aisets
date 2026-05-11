package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"aisets/internal/agent"
	"aisets/internal/aitag"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/imgtools"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

const VLMNormalizeVersion = "vlm-norm-v1"

var vlmNormFallbackOnce sync.Once

func prepareImageForVLM(localPath, ext, purpose string) (string, error) {
	maxSize := 768
	if purpose == "ocr" {
		maxSize = 1536
	}

	bin, err := imgtools.Binary()
	if err != nil {
		vlmNormFallbackOnce.Do(func() {
			log.Printf("[warn] imgtools not available, using fallback VLM image prep: %v", err)
		})
		return prepareImageForVLMFallback(localPath, ext)
	}

	tmp, err := os.CreateTemp("", "vlm-norm-*.png")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	cmd := exec.Command(bin, "vlm-normalize",
		"--purpose", purpose,
		"--max-size", strconv.Itoa(maxSize),
		"--background", "white",
		localPath, tmpPath)
	if _, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmpPath)
		return prepareImageForVLMFallback(localPath, ext)
	}

	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

func prepareImageForVLMFallback(localPath, ext string) (string, error) {
	ext = strings.ToLower(ext)
	switch ext {
	case ".svg":
		bin, err := imgtools.Binary()
		if err != nil {
			return "", fmt.Errorf("imgtools not available for SVG: %w", err)
		}
		tmp, err := os.CreateTemp("", "svgpng-*.png")
		if err != nil {
			return "", err
		}
		tmpPath := tmp.Name()
		tmp.Close()
		defer os.Remove(tmpPath)
		cmd := exec.Command(bin, "svg-to-png", "--max-size", "512", localPath, tmpPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("imgtools svg-to-png: %w: %s", err, strings.TrimSpace(string(out)))
		}
		data, err := os.ReadFile(tmpPath)
		if err != nil {
			return "", err
		}
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
	case ".avif", ".heic", ".heif":
		pngData, err := imageproc.ImageToPNG(localPath, 512)
		if err != nil {
			return "", err
		}
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData), nil
	default:
		data, err := os.ReadFile(localPath)
		if err != nil {
			return "", err
		}
		return "data:" + extToMIME(ext) + ";base64," + base64.StdEncoding.EncodeToString(data), nil
	}
}

func extToMIME(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

type vlmImage struct {
	Path string
	Ext  string
}

func (s *Server) chatVLM(ctx context.Context, images []vlmImage, backend, modelName, systemPrompt, prompt, purpose string, timeoutSec int) (string, llm.ChatResponse, error) {
	if id, ok := agent.AgentBackendID(backend); ok {
		if provider, ok := s.agentProviders[id]; ok {
			paths := make([]string, len(images))
			for i, img := range images {
				paths[i] = img.Path
			}
			cliModel := modelName
			if cliModel == "default" {
				cliModel = ""
			}
			var res agent.ChatResult
			_ = provider.ChatBatch(ctx, []agent.ChatRequest{{
				Model:        cliModel,
				SystemPrompt: systemPrompt,
				Prompt:       prompt,
				ImagePaths:   paths,
				TimeoutSec:   timeoutSec,
			}}, func(_ int, r agent.ChatResult) { res = r })
			if res.Err != nil {
				return "", llm.ChatResponse{DurationMs: res.DurationMs}, res.Err
			}
			return res.Content, llm.ChatResponse{
				Content:      res.Content,
				InputTokens:  res.InputTokens,
				OutputTokens: res.OutputTokens,
				DurationMs:   res.DurationMs,
			}, nil
		}
	}

	var dataURIs []string
	for _, img := range images {
		dataURI, err := prepareImageForVLM(img.Path, img.Ext, purpose)
		if err != nil {
			return "", llm.ChatResponse{}, err
		}
		dataURIs = append(dataURIs, dataURI)
	}
	resp, err := s.llmProvider.Chat(ctx, llm.ChatRequest{
		Model:      modelName,
		Messages:   buildChatMessages(systemPrompt, prompt, dataURIs),
		TimeoutSec: timeoutSec,
	})
	if err != nil {
		return "", resp, err
	}
	return resp.Content, resp, nil
}

type aiTagWorkResult struct {
	item     scanner.AssetItem
	result   aitag.Result
	chatResp llm.ChatResponse
}

type aiTagCounts struct {
	Queued       int   `json:"queued"`
	Processed    int   `json:"processed"`
	Ready        int   `json:"ready"`
	Failed       int   `json:"failed"`
	Skipped      int   `json:"skipped"`
	CacheHit     int   `json:"cacheHit"`
	Dedup        int   `json:"dedup"`
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
}

func (s *Server) handleAITagRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_settings_failed")})
		return
	}
	if !s.hasVLMBackend(settings) {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("aitag_not_configured", "AI provider or agent adapter not configured")})
		return
	}

	var body struct {
		AssetIDs []string `json:"assetIds"`
	}
	if r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	forceReprocess := len(body.AssetIDs) > 0

	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_catalog_failed")})
		return
	}

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureTag)

	prompt := settings.LLMTagPrompt
	if presetID := r.URL.Query().Get("presetId"); presetID != "" {
		if preset, err := s.store.GetPromptPreset(presetID); err == nil {
			prompt = config.FormatPrompt(preset.Content)
		}
	}
	lang := r.URL.Query().Get("lang")
	isLocalized := settings.LLMAutoLocale && lang != "" && lang != "en"
	targetLocales := settings.LLMTranslationLocales
	if len(targetLocales) == 0 {
		targetLocales = aitag.AllI18nLocales
	}
	if prompt == "" && isLocalized {
		prompt = aitag.TagPromptLocalizedForLocales(lang, targetLocales)
	} else {
		if prompt == "" {
			prompt = aitag.TagPrompt
		}
		var translationsBlock string
		if isLocalized {
			translationsBlock = aitag.TagTranslationsBlockForLocales(lang, targetLocales)
		} else {
			translationsBlock = aitag.TagTranslationsBlockDefault(targetLocales)
		}
		prompt = replaceDynamicVars(prompt, map[string]string{
			"translations": translationsBlock,
		})
		prompt = llm.AppendLocaleInstruction(prompt, settings.LLMAutoLocale,
			lang, "Write the description, tags, and all human-readable text in")
	}
	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)

	var sourceItems []scanner.AssetItem
	if forceReprocess {
		sourceItems, err = s.store.CatalogItemsByIDs(0, body.AssetIDs)
		if err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_catalog_failed")})
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

	eligible := make([]scanner.AssetItem, 0, len(sourceItems))
	for i := range sourceItems {
		item := sourceItems[i]
		if !eligibleForAITag(item) {
			continue
		}
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			sum, algorithm, herr := scanner.ContentHash(r.Context(), item.LocalPath)
			if herr != nil {
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
		}
		eligible = append(eligible, item)
	}

	counts := aiTagCounts{Skipped: len(sourceItems) - len(eligible)}
	candidates := []scanner.AssetItem{}
	inFlightHashes := map[string]struct{}{}
	pendingDuplicates := map[string][]scanner.AssetItem{}
	readyByHash := map[string]aitag.Result{}

	if forceReprocess {
		for _, item := range eligible {
			key := contentHashKey(item)
			if _, ok := inFlightHashes[key]; ok {
				pendingDuplicates[key] = append(pendingDuplicates[key], item)
				counts.Dedup++
				continue
			}
			candidates = append(candidates, item)
			counts.Queued++
			inFlightHashes[key] = struct{}{}
		}
	} else {
		cachedResults, cerr := s.store.AITagResults(eligible, providerName, modelName)
		if cerr != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(cerr, "aitag_cache_failed")})
			return
		}

		for _, item := range eligible {
			key := contentHashKey(item)

			if result, ok := cachedResults[item.ProjectID+"\x00"+item.RepoPath]; ok && result.Status == aitag.StatusReady {
				readyByHash[key] = result
				counts.CacheHit++
				continue
			}

			if result, ok := readyByHash[key]; ok {
				copied := copyAITagResultForItem(result, item)
				if err := s.store.UpsertAITagResult(copied); err != nil {
					sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed")})
					return
				}
				counts.CacheHit++
				continue
			}

			if result, found, cerr := s.store.AITagResultForContentHash(item.ContentHash, item.HashAlgorithm, providerName, modelName); cerr != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(cerr, "aitag_cache_failed")})
				return
			} else if found {
				copied := copyAITagResultForItem(result, item)
				if err := s.store.UpsertAITagResult(copied); err != nil {
					sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed")})
					return
				}
				readyByHash[key] = result
				counts.CacheHit++
				continue
			}

			if _, ok := inFlightHashes[key]; ok {
				pendingDuplicates[key] = append(pendingDuplicates[key], item)
				counts.Dedup++
				continue
			}

			candidates = append(candidates, item)
			counts.Queued++
			inFlightHashes[key] = struct{}{}
		}
	}

	sendNDJSON(w, map[string]any{"type": "start", "counts": counts, "providerName": providerName, "modelName": modelName})

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	timeoutSec := settings.LLMTimeout
	concurrency := min(max(settings.LLMConcurrency, 1), llm.MaxConcurrency)
	if concurrency > len(candidates) && len(candidates) > 0 {
		concurrency = len(candidates)
	}

	jobs := make(chan scanner.AssetItem)
	results := make(chan aiTagWorkResult)
	var wg sync.WaitGroup
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				result, chatResp := s.processAITag(ctx, item, backend, providerName, modelName, systemPrompt, prompt, timeoutSec)
				select {
				case results <- aiTagWorkResult{item: item, result: result, chatResp: chatResp}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, item := range candidates {
			select {
			case <-ctx.Done():
				return
			case jobs <- item:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var firstError string
	for work := range results {
		if work.result.Status == aitag.StatusFailed {
			counts.Failed++
			if firstError == "" {
				firstError = work.result.ErrorMessage
			}
		} else {
			counts.Ready++
		}
		counts.Processed++
		counts.InputTokens += work.chatResp.InputTokens
		counts.OutputTokens += work.chatResp.OutputTokens

		if err := s.store.UpsertAITagResult(work.result); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed"), "counts": counts})
			return
		}

		key := contentHashKey(work.item)
		for _, dup := range pendingDuplicates[key] {
			copied := copyAITagResultForItem(work.result, dup)
			if err := s.store.UpsertAITagResult(copied); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed"), "counts": counts})
				return
			}
		}

		progressEvent := map[string]any{"type": "progress", "assetId": work.item.ID, "repoPath": work.item.RepoPath, "status": work.result.Status, "counts": counts}
		if work.result.Status == aitag.StatusFailed && work.result.ErrorMessage != "" {
			progressEvent["errorMessage"] = work.result.ErrorMessage
		}
		sendNDJSON(w, progressEvent)
	}

	doneEvent := map[string]any{"type": "done", "counts": counts, "providerName": providerName, "modelName": modelName}
	if firstError != "" {
		doneEvent["firstError"] = firstError
	}
	sendNDJSON(w, doneEvent)
}

func (s *Server) processAITag(ctx context.Context, item scanner.AssetItem, backend, providerName, modelName, systemPrompt, prompt string, timeoutSec int) (aitag.Result, llm.ChatResponse) {
	result := aitag.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		ProviderName:  providerName,
		ModelName:     modelName,
		Status:        aitag.StatusReady,
	}

	start := time.Now()
	rawContent, resp, err := s.chatVLM(ctx, []vlmImage{{Path: item.LocalPath, Ext: item.Ext}}, backend, modelName, systemPrompt, prompt, "tag", timeoutSec)
	result.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		result.Status = aitag.StatusFailed
		result.ErrorCode = "aitag_llm_failed"
		result.ErrorMessage = err.Error()
		return result, llm.ChatResponse{}
	}

	content := llm.CleanJSON(rawContent)

	var parsed struct {
		Category           json.RawMessage `json:"category"`
		CategoryI18n       json.RawMessage `json:"categoryI18n"`
		Tags               json.RawMessage `json:"tags"`
		TagsI18n           json.RawMessage `json:"tagsI18n"`
		Description        string          `json:"description"`
		DescriptionI18n    json.RawMessage `json:"descriptionI18n"`
		Languages          json.RawMessage `json:"languages"`
		ContainsFace       bool            `json:"containsFace"`
		SceneType          string          `json:"sceneType"`
		EstimatedLocation  *string         `json:"estimatedLocation"`
		LocationConfidence string          `json:"locationConfidence"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		preview := rawContent
		if len(preview) > 300 {
			preview = preview[:300] + "..."
		}
		log.Printf("[warn] aitag: failed to parse VLM response for %s: %v\n  raw(%d bytes): %s", item.RepoPath, err, len(rawContent), preview)
		result.Status = aitag.StatusFailed
		result.ErrorCode = "aitag_parse_failed"
		result.ErrorMessage = "failed to parse VLM JSON response: " + err.Error()
		return result, resp
	}

	result.Category = strings.ToLower(strings.TrimSpace(unmarshalStringOrFirst(parsed.Category)))
	_ = json.Unmarshal(parsed.CategoryI18n, &result.CategoryI18n)
	if result.CategoryI18n == nil {
		result.CategoryI18n = map[string]string{}
	}
	_ = json.Unmarshal(parsed.Tags, &result.Tags)
	_ = json.Unmarshal(parsed.TagsI18n, &result.TagsI18n)
	if result.Tags == nil {
		result.Tags = []string{}
	}
	if result.TagsI18n == nil {
		result.TagsI18n = map[string][]string{}
	}
	result.Description = strings.TrimSpace(parsed.Description)
	_ = json.Unmarshal(parsed.DescriptionI18n, &result.DescriptionI18n)
	if result.DescriptionI18n == nil {
		result.DescriptionI18n = map[string]string{}
	}
	result.Languages = unmarshalStringArray(parsed.Languages)
	result.ContainsFace = parsed.ContainsFace
	result.SceneType = strings.ToLower(strings.TrimSpace(parsed.SceneType))
	if parsed.EstimatedLocation != nil {
		result.EstimatedLocation = strings.TrimSpace(*parsed.EstimatedLocation)
	}
	result.LocationConfidence = strings.ToLower(strings.TrimSpace(parsed.LocationConfidence))
	if result.Tags == nil {
		result.Tags = []string{}
	}
	if result.Languages == nil {
		result.Languages = []string{}
	}
	return result, resp
}

func eligibleForAITag(item scanner.AssetItem) bool {
	ext := strings.ToLower(item.Ext)
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".heic", ".heif":
	default:
		return false
	}
	if item.Image.Animated {
		return false
	}
	if item.Image.Width <= 0 || item.Image.Height <= 0 {
		ext2 := strings.ToLower(item.Ext)
		if ext2 != ".heic" && ext2 != ".heif" {
			return false
		}
	}
	const maxBytes = 20 * 1024 * 1024 // 20MB
	if item.Bytes > maxBytes {
		return false
	}
	return true
}

func (s *Server) handleAITagClear(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.RemoveAITagResults(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func copyAITagResultForItem(result aitag.Result, item scanner.AssetItem) aitag.Result {
	result.ProjectID = item.ProjectID
	result.RepoPath = item.RepoPath
	result.ContentHash = item.ContentHash
	result.HashAlgorithm = item.HashAlgorithm
	result.UpdatedAt = ""
	return result
}

// unmarshalStringOrFirst tolerates LLMs returning either "value" or ["value", ...].
func unmarshalStringOrFirst(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var arr []string
	if json.Unmarshal(raw, &arr) == nil && len(arr) > 0 {
		return arr[0]
	}
	return ""
}

// unmarshalStringArray tolerates LLMs returning languages as ["eng"], {"en":"English"}, or other shapes.
func unmarshalStringArray(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var arr []string
	if json.Unmarshal(raw, &arr) == nil {
		return arr
	}
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		out := make([]string, 0, len(obj))
		for k := range obj {
			out = append(out, k)
		}
		return out
	}
	return nil
}

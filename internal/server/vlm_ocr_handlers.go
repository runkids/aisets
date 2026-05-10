package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"aisets/internal/apierr"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

const (
	vlmOCREngineName    = "vlm"
	vlmOCRPromptVersion = "aisets-vlm-ocr-v1"
	vlmOCRMode          = "vlm"
)

const vlmOCRPrompt = `Analyze this image and respond with a JSON object:
- "text": all visible text exactly as it appears, preserving original layout, line breaks, indentation and formatting. If the image contains code, preserve indentation exactly. Empty string if no text is visible.
- "languages": array of ISO 639-3 language codes detected in the text (e.g. ["eng"], ["zho", "eng"]). Empty array if no text.

Respond ONLY with valid JSON, no markdown or explanation.`

type vlmOcrCounts struct {
	Queued    int `json:"queued"`
	Processed int `json:"processed"`
	Ready     int `json:"ready"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
	CacheHit  int `json:"cacheHit"`
}

func vlmOCRSettingsHash(modelName string) string {
	payload := struct {
		PromptVersion string `json:"promptVersion"`
		ModelName     string `json:"modelName"`
	}{
		PromptVersion: vlmOCRPromptVersion,
		ModelName:     modelName,
	}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func eligibleForVLMOCR(item scanner.AssetItem) bool {
	ext := strings.ToLower(item.Ext)
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg":
	default:
		return false
	}
	if item.Image.Animated {
		return false
	}
	if item.Image.Width <= 0 || item.Image.Height <= 0 {
		return false
	}
	const maxBytes = 20 * 1024 * 1024 // 20MB
	if item.Bytes > maxBytes {
		return false
	}
	return true
}

func (s *Server) handleVLMOCRRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_settings_failed")})
		return
	}
	if !settings.LLMEnabled || settings.LLMProvider == "" || settings.LLMVisionModel == "" {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("vlm_ocr_not_configured", "AI provider or vision model not configured")})
		return
	}
	if s.llmProvider == nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("vlm_ocr_provider_unavailable", "LLM provider is not available")})
		return
	}

	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_catalog_failed")})
		return
	}

	providerName := settings.LLMProvider
	modelName := settings.LLMVisionModel
	engineVersion := providerName + "/" + modelName
	settingsHash := vlmOCRSettingsHash(modelName)

	prompt := settings.LLMOcrPrompt
	if prompt == "" {
		prompt = vlmOCRPrompt
	}

	eligible := make([]scanner.AssetItem, 0, len(catalog.Items))
	for _, rawItem := range catalog.Items {
		item := rawItem
		if !eligibleForVLMOCR(item) {
			continue
		}
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			sum, algorithm, err := scanner.ContentHash(r.Context(), item.LocalPath)
			if err != nil {
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
		}
		eligible = append(eligible, item)
	}

	cachedResults, err := s.store.VLMOCRResults(eligible, engineVersion, settingsHash)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_cache_failed")})
		return
	}

	counts := vlmOcrCounts{Skipped: len(catalog.Items) - len(eligible)}
	candidates := []scanner.AssetItem{}
	inFlightHashes := map[string]struct{}{}
	pendingDuplicates := map[string][]scanner.AssetItem{}
	readyByHash := map[string]ocr.Result{}

	for _, item := range eligible {
		key := contentHashKey(item)

		if result, ok := cachedResults[item.ProjectID+"\x00"+item.RepoPath]; ok && result.Status == ocr.StatusReady {
			readyByHash[key] = result
			counts.CacheHit++
			continue
		}

		if result, ok := readyByHash[key]; ok {
			copied := copyOCRResultForVLMItem(result, item)
			if err := s.store.UpsertOCRResult(copied); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_persist_failed")})
				return
			}
			counts.CacheHit++
			continue
		}

		// Check content-hash dedup from DB
		if result, found, err := s.store.VLMOCRResultForContentHash(item.ContentHash, item.HashAlgorithm, engineVersion, settingsHash); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_cache_failed")})
			return
		} else if found {
			copied := copyOCRResultForVLMItem(result, item)
			if err := s.store.UpsertOCRResult(copied); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_persist_failed")})
				return
			}
			readyByHash[key] = result
			counts.CacheHit++
			continue
		}

		// Dedup in-flight
		if _, ok := inFlightHashes[key]; ok {
			pendingDuplicates[key] = append(pendingDuplicates[key], item)
			counts.CacheHit++
			continue
		}

		candidates = append(candidates, item)
		counts.Queued++
		inFlightHashes[key] = struct{}{}
	}

	sendNDJSON(w, map[string]any{"type": "start", "counts": counts})

	// Single worker — process sequentially
	for _, item := range candidates {
		if r.Context().Err() != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(r.Context().Err(), "vlm_ocr_canceled"), "counts": counts})
			return
		}

		result := s.processVLMOCR(r.Context(), item, providerName, modelName, prompt)
		if result.Status == ocr.StatusFailed {
			counts.Failed++
		} else {
			counts.Ready++
		}
		counts.Processed++

		if err := s.store.UpsertOCRResult(result); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_persist_failed"), "counts": counts})
			return
		}

		// Copy result to pending duplicates
		key := contentHashKey(item)
		for _, dup := range pendingDuplicates[key] {
			copied := copyOCRResultForVLMItem(result, dup)
			if err := s.store.UpsertOCRResult(copied); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "vlm_ocr_persist_failed"), "counts": counts})
				return
			}
		}

		sendNDJSON(w, map[string]any{"type": "progress", "assetId": item.ID, "repoPath": item.RepoPath, "status": result.Status, "counts": counts})
	}

	sendNDJSON(w, map[string]any{"type": "done", "counts": counts})
}

func (s *Server) processVLMOCR(ctx context.Context, item scanner.AssetItem, providerName, modelName, prompt string) ocr.Result {
	engineVersion := providerName + "/" + modelName
	result := ocr.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		EngineName:    vlmOCREngineName,
		EngineVersion: engineVersion,
		SettingsHash:  vlmOCRSettingsHash(modelName),
		Mode:          vlmOCRMode,
		Attempts:      1,
		Status:        ocr.StatusReady,
	}

	dataURI, err := prepareImageForVLM(item.LocalPath, item.Ext)
	if err != nil {
		result.Status = ocr.StatusFailed
		result.ErrorCode = "vlm_ocr_read_failed"
		result.ErrorMessage = err.Error()
		return result
	}

	start := time.Now()
	resp, err := s.llmProvider.Chat(ctx, llm.ChatRequest{
		Model: modelName,
		Messages: []llm.ChatMessage{{
			Role:    "user",
			Content: prompt,
			Images:  []string{dataURI},
		}},
	})
	result.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		result.Status = ocr.StatusFailed
		result.ErrorCode = "vlm_ocr_llm_failed"
		result.ErrorMessage = err.Error()
		return result
	}

	// Parse JSON from response, stripping markdown fences if present
	content := strings.TrimSpace(resp.Content)
	content = stripMarkdownFences(content)

	var parsed struct {
		Text      string   `json:"text"`
		Languages []string `json:"languages"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		result.Status = ocr.StatusFailed
		result.ErrorCode = "vlm_ocr_parse_failed"
		result.ErrorMessage = "failed to parse VLM JSON response: " + err.Error()
		return result
	}

	result.Text = parsed.Text
	result.NormalizedText = ocr.NormalizeText(parsed.Text)
	result.Languages = parsed.Languages
	if result.Languages == nil {
		result.Languages = []string{}
	}
	result.Scripts = ocr.DetectScripts(result.Text)
	ocr.FinalizeResult(&result)
	return result
}

func copyOCRResultForVLMItem(result ocr.Result, item scanner.AssetItem) ocr.Result {
	result.ProjectID = item.ProjectID
	result.RepoPath = item.RepoPath
	result.ContentHash = item.ContentHash
	result.HashAlgorithm = item.HashAlgorithm
	result.UpdatedAt = ""
	ocr.FinalizeResult(&result)
	return result
}

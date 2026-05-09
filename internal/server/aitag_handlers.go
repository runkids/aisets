package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"aisets/internal/aitag"
	"aisets/internal/apierr"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

func prepareImageForVLM(localPath, ext string) (string, error) {
	ext = strings.ToLower(ext)
	switch ext {
	case ".avif", ".svg":
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

type aiTagCounts struct {
	Queued    int `json:"queued"`
	Processed int `json:"processed"`
	Ready     int `json:"ready"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
	CacheHit  int `json:"cacheHit"`
}

func (s *Server) handleAITagRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")

	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_settings_failed")})
		return
	}
	if settings.LLMProvider == "" || settings.LLMVisionModel == "" {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("aitag_not_configured", "AI provider or vision model not configured")})
		return
	}
	if s.llmProvider == nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.New("aitag_provider_unavailable", "LLM provider is not available")})
		return
	}

	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_catalog_failed")})
		return
	}

	providerName := settings.LLMProvider
	modelName := settings.LLMVisionModel

	eligible := make([]scanner.AssetItem, 0, len(catalog.Items))
	for _, rawItem := range catalog.Items {
		item := rawItem
		if !eligibleForAITag(item) {
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

	cachedResults, err := s.store.AITagResults(eligible, providerName, modelName)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_cache_failed")})
		return
	}

	counts := aiTagCounts{Skipped: len(catalog.Items) - len(eligible)}
	candidates := []scanner.AssetItem{}
	inFlightHashes := map[string]struct{}{}
	pendingDuplicates := map[string][]scanner.AssetItem{}
	readyByHash := map[string]aitag.Result{}

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

		// Check content-hash dedup from DB
		if result, found, err := s.store.AITagResultForContentHash(item.ContentHash, item.HashAlgorithm, providerName, modelName); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_cache_failed")})
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
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(r.Context().Err(), "aitag_canceled"), "counts": counts})
			return
		}

		result := s.processAITag(r.Context(), item, providerName, modelName)
		if result.Status == aitag.StatusFailed {
			counts.Failed++
		} else {
			counts.Ready++
		}
		counts.Processed++

		if err := s.store.UpsertAITagResult(result); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed"), "counts": counts})
			return
		}

		// Copy result to pending duplicates
		key := contentHashKey(item)
		for _, dup := range pendingDuplicates[key] {
			copied := copyAITagResultForItem(result, dup)
			if err := s.store.UpsertAITagResult(copied); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "aitag_persist_failed"), "counts": counts})
				return
			}
		}

		sendNDJSON(w, map[string]any{"type": "progress", "assetId": item.ID, "repoPath": item.RepoPath, "status": result.Status, "counts": counts})
	}

	sendNDJSON(w, map[string]any{"type": "done", "counts": counts})
}

func (s *Server) processAITag(ctx context.Context, item scanner.AssetItem, providerName, modelName string) aitag.Result {
	result := aitag.Result{
		ProjectID:     item.ProjectID,
		RepoPath:      item.RepoPath,
		ContentHash:   item.ContentHash,
		HashAlgorithm: item.HashAlgorithm,
		ProviderName:  providerName,
		ModelName:     modelName,
		Status:        aitag.StatusReady,
	}

	dataURI, err := prepareImageForVLM(item.LocalPath, item.Ext)
	if err != nil {
		result.Status = aitag.StatusFailed
		result.ErrorCode = "aitag_read_failed"
		result.ErrorMessage = err.Error()
		return result
	}

	start := time.Now()
	resp, err := s.llmProvider.Chat(ctx, llm.ChatRequest{
		Model: modelName,
		Messages: []llm.ChatMessage{{
			Role:    "user",
			Content: aitag.TagPrompt,
			Images:  []string{dataURI},
		}},
	})
	result.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		result.Status = aitag.StatusFailed
		result.ErrorCode = "aitag_llm_failed"
		result.ErrorMessage = err.Error()
		return result
	}

	// Parse JSON from response, stripping markdown fences if present
	content := strings.TrimSpace(resp.Content)
	content = stripMarkdownFences(content)

	var parsed struct {
		Category    string   `json:"category"`
		Tags        []string `json:"tags"`
		Description string   `json:"description"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		result.Status = aitag.StatusFailed
		result.ErrorCode = "aitag_parse_failed"
		result.ErrorMessage = "failed to parse VLM JSON response: " + err.Error()
		return result
	}

	result.Category = strings.ToLower(strings.TrimSpace(parsed.Category))
	result.Tags = parsed.Tags
	result.Description = strings.TrimSpace(parsed.Description)
	if result.Tags == nil {
		result.Tags = []string{}
	}
	return result
}

func eligibleForAITag(item scanner.AssetItem) bool {
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

func stripMarkdownFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
	}
	return strings.TrimSpace(s)
}

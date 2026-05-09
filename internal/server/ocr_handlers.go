package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

type ocrCounts struct {
	Queued      int            `json:"queued"`
	Processed   int            `json:"processed"`
	Ready       int            `json:"ready"`
	Failed      int            `json:"failed"`
	Skipped     int            `json:"skipped"`
	CacheHit    int            `json:"cacheHit"`
	SkipReasons map[string]int `json:"skipReasons,omitempty"`
}

type ocrWorkResult struct {
	item   scanner.AssetItem
	result ocr.Result
}

func (s *Server) handleOCRInstall(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Languages []string `json:"languages"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Languages) == 0 {
		settings, err := s.store.Settings()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		body.Languages = settings.OCRLanguages
	}
	packs, err := ocr.InstallLanguagePacks(r.Context(), config.DataDir(), body.Languages)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.From(err, "ocr_install_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": packs, "runtime": ocr.Runtime(r.Context(), config.DataDir(), s.ocrEngine)})
}

func (s *Server) handleOCRRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Languages []string `json:"languages"`
	}
	if r.Body != nil {
		_ = readJSON(r, &body)
	}
	packs, err := ocr.RemoveLanguagePacks(config.DataDir(), body.Languages)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.From(err, "ocr_remove_failed"))
		return
	}
	if err := s.store.RemoveOCRResults(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": packs, "runtime": ocr.Runtime(r.Context(), config.DataDir(), s.ocrEngine)})
}

func (s *Server) handleOCRRun(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	settings, err := s.store.Settings()
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_settings_failed")})
		return
	}
	if !settings.OCREnabled {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(apierr.New("ocr_disabled", "OCR is disabled"), "ocr_disabled")})
		return
	}
	if checker, ok := s.ocrEngine.(ocr.AvailabilityChecker); ok {
		if err := checker.Available(r.Context()); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(apierr.New("ocr_engine_unavailable", err.Error()), "ocr_engine_unavailable")})
			return
		}
	}
	ocrSettings := config.OCRSettingsFromApp(settings)
	installed := ocr.InstalledLanguages(config.DataDir(), ocrSettings.Languages)
	if len(installed) != len(ocrSettings.Languages) {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(apierr.New("ocr_not_installed", "OCR language data is not installed for all selected languages"), "ocr_not_installed")})
		return
	}
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_catalog_failed")})
		return
	}
	counts := ocrCounts{}
	candidates := []scanner.AssetItem{}
	pendingDuplicates := map[string][]scanner.AssetItem{}
	inFlightHashes := map[string]struct{}{}
	readyByHash := map[string]ocr.Result{}
	workCount := 0
	hasMore := false
	for _, rawItem := range catalog.Items {
		item := rawItem
		eligibility := eligibleForOCRMetadata(item, ocrSettings)
		if eligibility.Status == ocr.StatusSkipped {
			addOCRSkip(&counts, eligibility.ErrorCode)
			if item.ContentHash != "" && item.HashAlgorithm != "" {
				_ = s.store.UpsertOCRResult(ocrResultForItem(item, ocrSettings, s.ocrEngine, eligibility))
			}
			continue
		}
		computedHash := false
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			if workCount >= ocrSettings.BatchSize {
				hasMore = true
				break
			}
			sum, algorithm, err := scanner.ContentHash(r.Context(), item.LocalPath)
			if err != nil {
				addOCRSkip(&counts, "ocr_hash_failed")
				_ = s.store.UpsertOCRResult(ocrResultForItem(item, ocrSettings, s.ocrEngine, ocr.Result{
					Status:       ocr.StatusSkipped,
					ErrorCode:    "ocr_hash_failed",
					ErrorMessage: err.Error(),
				}))
				workCount++
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
			s.updateCatalogOCRHash(item)
			computedHash = true
			workCount++
		}
		if result, ok, err := s.store.OCRResultForItem(item, ocrSettings, s.ocrEngine.Name(), s.ocrEngine.Version()); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_cache_failed")})
			return
		} else if ok {
			if shouldRefreshOCRResult(result) {
				if !queueOCRCandidate(item, computedHash, ocrSettings.BatchSize, &workCount, &hasMore, &counts, &candidates, inFlightHashes, pendingDuplicates) {
					break
				}
				continue
			}
			if result.Status == ocr.StatusReady {
				readyByHash[ocrContentKey(item)] = result
			}
			counts.CacheHit++
			continue
		}
		key := ocrContentKey(item)
		if result, ok := readyByHash[key]; ok && !shouldRefreshOCRResult(result) {
			if err := s.store.UpsertOCRResult(copyOCRResultForItem(result, item)); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_persist_failed"), "counts": counts})
				return
			}
			counts.CacheHit++
			continue
		}
		if result, ok, err := s.store.OCRResultForContentHash(item.ContentHash, item.HashAlgorithm, ocrSettings, s.ocrEngine.Name(), s.ocrEngine.Version()); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_cache_failed")})
			return
		} else if ok && !shouldRefreshOCRResult(result) {
			if err := s.store.UpsertOCRResult(copyOCRResultForItem(result, item)); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_persist_failed"), "counts": counts})
				return
			}
			readyByHash[key] = result
			counts.CacheHit++
			continue
		}
		if _, ok := inFlightHashes[key]; ok {
			pendingDuplicates[key] = append(pendingDuplicates[key], item)
			counts.CacheHit++
			continue
		}
		if !queueOCRCandidate(item, computedHash, ocrSettings.BatchSize, &workCount, &hasMore, &counts, &candidates, inFlightHashes, pendingDuplicates) {
			break
		}
	}
	sendNDJSON(w, map[string]any{"type": "start", "counts": counts})
	concurrency := min(max(ocrSettings.Concurrency, 1), ocr.MaxConcurrency)
	if concurrency > len(candidates) {
		concurrency = len(candidates)
	}
	if concurrency == 0 {
		concurrency = 1
	}
	jobs := make(chan scanner.AssetItem)
	results := make(chan ocrWorkResult)
	var wg sync.WaitGroup
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				results <- ocrWorkResult{
					item:   item,
					result: s.extractOCRResult(r.Context(), item, installed, ocrSettings),
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, item := range candidates {
			select {
			case <-r.Context().Done():
				return
			case jobs <- item:
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()
	for work := range results {
		result := work.result
		if result.Status == ocr.StatusFailed {
			counts.Failed++
		} else {
			counts.Ready++
		}
		counts.Processed++
		if err := s.store.UpsertOCRResult(result); err != nil {
			sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_persist_failed"), "counts": counts})
			return
		}
		for _, duplicate := range pendingDuplicates[ocrContentKey(work.item)] {
			if err := s.store.UpsertOCRResult(copyOCRResultForItem(result, duplicate)); err != nil {
				sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_persist_failed"), "counts": counts})
				return
			}
		}
		sendNDJSON(w, map[string]any{"type": "progress", "assetId": work.item.ID, "repoPath": work.item.RepoPath, "status": result.Status, "counts": counts})
	}
	if err := r.Context().Err(); err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "ocr_canceled"), "counts": counts})
		return
	}
	sendNDJSON(w, map[string]any{"type": "done", "counts": counts, "hasMore": hasMore})
}

func queueOCRCandidate(
	item scanner.AssetItem,
	hashComputed bool,
	batchSize int,
	workCount *int,
	hasMore *bool,
	counts *ocrCounts,
	candidates *[]scanner.AssetItem,
	inFlightHashes map[string]struct{},
	pendingDuplicates map[string][]scanner.AssetItem,
) bool {
	key := ocrContentKey(item)
	if _, ok := inFlightHashes[key]; ok {
		pendingDuplicates[key] = append(pendingDuplicates[key], item)
		counts.CacheHit++
		return true
	}
	if *workCount >= batchSize && !hashComputed {
		*hasMore = true
		return false
	}
	*candidates = append(*candidates, item)
	counts.Queued++
	inFlightHashes[key] = struct{}{}
	if !hashComputed {
		(*workCount)++
	}
	return true
}

func (s *Server) extractOCRResult(ctx context.Context, item scanner.AssetItem, installed []string, ocrSettings ocr.Settings) ocr.Result {
	extraction, err := s.ocrEngine.Extract(ctx, item.LocalPath, installed)
	result := ocr.Result{
		ProjectID:      item.ProjectID,
		RepoPath:       item.RepoPath,
		ContentHash:    item.ContentHash,
		HashAlgorithm:  item.HashAlgorithm,
		EngineName:     s.ocrEngine.Name(),
		EngineVersion:  s.ocrEngine.Version(),
		SettingsHash:   ocr.SettingsHash(ocrSettings),
		Status:         ocr.StatusReady,
		Text:           extraction.Text,
		NormalizedText: ocr.NormalizeText(extraction.Text),
		Languages:      extraction.Languages,
		Scripts:        extraction.Scripts,
		DurationMs:     extraction.DurationMs,
		Mode:           extraction.Mode,
		Attempts:       extraction.Attempts,
	}
	if result.Attempts <= 0 {
		result.Attempts = 1
	}
	ocr.FinalizeResult(&result)
	if err != nil {
		result.Status = ocr.StatusFailed
		result.TextStatus = ""
		result.EmptyText = false
		result.ErrorCode = "ocr_extract_failed"
		if errors.Is(err, ocr.ErrNotInstalled) {
			result.ErrorCode = "ocr_not_installed"
		}
		result.ErrorMessage = err.Error()
	}
	return result
}

func ocrContentKey(item scanner.AssetItem) string {
	if item.ContentHash == "" || item.HashAlgorithm == "" {
		return ""
	}
	return item.HashAlgorithm + "\x00" + item.ContentHash
}

func copyOCRResultForItem(result ocr.Result, item scanner.AssetItem) ocr.Result {
	result.ProjectID = item.ProjectID
	result.RepoPath = item.RepoPath
	result.ContentHash = item.ContentHash
	result.HashAlgorithm = item.HashAlgorithm
	result.UpdatedAt = ""
	ocr.FinalizeResult(&result)
	return result
}

func shouldRefreshOCRResult(result ocr.Result) bool {
	if result.Status != ocr.StatusReady {
		return false
	}
	if result.Attempts == 0 {
		return true
	}
	return result.Attempts < ocr.MaxExtractionAttempts &&
		strings.Contains(result.Mode, "psm_6") &&
		!strings.Contains(result.Mode, "psm_11")
}

func addOCRSkip(counts *ocrCounts, code string) {
	if code == "" {
		code = "ocr_skipped"
	}
	counts.Skipped++
	if counts.SkipReasons == nil {
		counts.SkipReasons = map[string]int{}
	}
	counts.SkipReasons[code]++
}

func eligibleForOCR(item scanner.AssetItem, settings ocr.Settings) ocr.Result {
	result := eligibleForOCRMetadata(item, settings)
	if result.Status == ocr.StatusSkipped {
		return result
	}
	if item.ContentHash == "" || item.HashAlgorithm == "" {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_missing_hash"
		result.ErrorMessage = "asset has no content hash"
		return result
	}
	return result
}

func eligibleForOCRMetadata(item scanner.AssetItem, settings ocr.Settings) ocr.Result {
	result := ocr.Result{Status: ocr.StatusPending}
	if item.Image.ErrorCode != "" {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_image_unreadable"
		result.ErrorMessage = item.Image.Error
		return result
	}
	if item.Image.Animated {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_animated_unsupported"
		result.ErrorMessage = "animated images are skipped"
		return result
	}
	ext := strings.ToLower(item.Ext)
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_extension_unsupported"
		result.ErrorMessage = "asset extension is not supported for OCR"
		return result
	}
	pixels := item.Image.Width * item.Image.Height
	if pixels <= 0 {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_dimensions_missing"
		result.ErrorMessage = "asset dimensions are missing"
		return result
	}
	if pixels > settings.MaxPixels {
		result.Status = ocr.StatusSkipped
		result.ErrorCode = "ocr_oversized"
		result.ErrorMessage = "asset exceeds OCR max pixels"
		return result
	}
	return result
}

func (s *Server) updateCatalogOCRHash(item scanner.AssetItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.catalog.Items {
		if s.catalog.Items[index].ProjectID == item.ProjectID && s.catalog.Items[index].RepoPath == item.RepoPath {
			s.catalog.Items[index].ContentHash = item.ContentHash
			s.catalog.Items[index].HashAlgorithm = item.HashAlgorithm
			return
		}
	}
}

func ocrResultForItem(item scanner.AssetItem, settings ocr.Settings, engine ocr.Engine, result ocr.Result) ocr.Result {
	result.ProjectID = item.ProjectID
	result.RepoPath = item.RepoPath
	result.ContentHash = item.ContentHash
	result.HashAlgorithm = item.HashAlgorithm
	result.EngineName = engine.Name()
	result.EngineVersion = engine.Version()
	result.SettingsHash = ocr.SettingsHash(settings)
	return result
}

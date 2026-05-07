package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/ocr"
	"asset-studio/internal/scanner"
)

func scanErrorStatus(err error) int {
	if coded, ok := err.(apierr.Error); ok {
		switch coded.Code {
		case "scan_not_found":
			return http.StatusNotFound
		case "scan_id_required", "scan_id_invalid", "scan_diff_same_scan":
			return http.StatusBadRequest
		}
	}
	return http.StatusInternalServerError
}

func parseScanIDParam(raw, name string) (int64, error) {
	if raw == "" {
		return 0, apierr.WithParams("scan_id_required", "scan id is required", map[string]any{"param": name})
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, apierr.WithParams("scan_id_invalid", "scan id is invalid", map[string]any{"param": name, "value": raw})
	}
	return id, nil
}

func parseOptionalScanID(raw string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	return parseScanIDParam(raw, "scanId")
}

func parseOptionalInt(raw, name string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, apierr.WithParams("integer_param_invalid", "integer query parameter is invalid", map[string]any{"param": name, "value": raw})
	}
	return value, nil
}

type scanRequest struct {
	Profile  scanner.ScanProfile     `json:"profile"`
	Analyses scanner.AnalysisOptions `json:"analyses"`
}

func (s *Server) scanOptionsFromRequest(r *http.Request) (scanner.ScanOptions, error) {
	if r.Body == nil {
		return scanner.ScanOptions{}, nil
	}
	defer r.Body.Close()
	bytes, err := io.ReadAll(r.Body)
	if err != nil {
		return scanner.ScanOptions{}, err
	}
	if len(bytes) == 0 {
		return scanner.ScanOptions{}, nil
	}
	var body scanRequest
	if err := json.Unmarshal(bytes, &body); err != nil {
		return scanner.ScanOptions{}, err
	}
	return scanner.ScanOptions{Profile: body.Profile, Analyses: body.Analyses}, nil
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	summary, err := s.store.CatalogSummary()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleCatalogItems(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	limit, err := parseOptionalInt(r.URL.Query().Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	page, err := s.store.CatalogItems(config.CatalogItemQuery{
		ScanID:         scanID,
		AssetID:        r.URL.Query().Get("assetId"),
		ProjectID:      r.URL.Query().Get("projectId"),
		ProjectName:    r.URL.Query().Get("projectName"),
		Ext:            r.URL.Query().Get("ext"),
		Folder:         r.URL.Query().Get("folder"),
		Query:          r.URL.Query().Get("q"),
		Status:         r.URL.Query().Get("status"),
		Sort:           r.URL.Query().Get("sort"),
		CustomFilterID: r.URL.Query().Get("customFilter"),
		Limit:          limit,
		Cursor:         r.URL.Query().Get("cursor"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleCatalogFolders(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	page, err := s.store.CatalogFolders(config.CatalogFolderQuery{
		ScanID:         scanID,
		ProjectID:      r.URL.Query().Get("projectId"),
		ProjectName:    r.URL.Query().Get("projectName"),
		Ext:            r.URL.Query().Get("ext"),
		Folder:         r.URL.Query().Get("folder"),
		Query:          r.URL.Query().Get("q"),
		Status:         r.URL.Query().Get("status"),
		CustomFilterID: r.URL.Query().Get("customFilter"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleCatalogItem(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	detail, err := s.store.CatalogItemDetail(scanID, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleCatalogDuplicates(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	limit, err := parseOptionalInt(r.URL.Query().Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	page, err := s.store.CatalogDuplicates(scanID, r.URL.Query().Get("kind"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleCatalogLint(w http.ResponseWriter, r *http.Request) {
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	scanID, err := parseOptionalScanID(r.URL.Query().Get("scanId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	limit, err := parseOptionalInt(r.URL.Query().Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	page, err := s.store.CatalogLint(config.CatalogLintQuery{
		ScanID:    scanID,
		ProjectID: r.URL.Query().Get("projectId"),
		Severity:  r.URL.Query().Get("severity"),
		Limit:     limit,
		Cursor:    r.URL.Query().Get("cursor"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	sendNDJSON(w, map[string]any{"type": "start"})
	progress := func(event scanner.ScanProgress) {
		sendNDJSON(w, map[string]any{
			"type":    "progress",
			"phase":   event.Phase,
			"current": event.Current,
			"total":   event.Total,
			"message": event.Message,
		})
	}
	options, err := s.scanOptionsFromRequest(r)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "scan_invalid_request")})
		return
	}
	catalog, scanID, err := s.scanWithProgress(r.Context(), options, progress)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "scan_failed")})
		return
	}
	sendNDJSON(w, map[string]any{"type": "done", "scanId": scanID, "stats": catalog.Stats, "analysis": catalog.Analysis})
}

func (s *Server) handleScans(w http.ResponseWriter, _ *http.Request) {
	scans, err := s.store.ListScans()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"scans": scans})
}

func (s *Server) handleScanSummary(w http.ResponseWriter, r *http.Request) {
	id, err := parseScanIDParam(r.PathValue("id"), "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	scan, err := s.store.Scan(id)
	if err != nil {
		writeError(w, scanErrorStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"scan": scan})
}

func (s *Server) handleScanDiff(w http.ResponseWriter, r *http.Request) {
	baseID, err := parseScanIDParam(r.URL.Query().Get("base"), "base")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	targetID, err := parseScanIDParam(r.URL.Query().Get("target"), "target")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	diff, err := s.store.DiffScans(baseID, targetID)
	if err != nil {
		writeError(w, scanErrorStatus(err), apierr.From(err, "scan_diff_failed"))
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	http.ServeFile(w, r, item.LocalPath)
}

func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.ensureLatestScan(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	item, err := s.store.CatalogItem(0, id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	catalog := scanner.Catalog{Items: []scanner.AssetItem{item}}
	result, err := s.scanner.Thumbnail(r.Context(), catalog, id, 256)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "asset not found"))
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("content-type", result.MimeType)
	w.Header().Set("cache-control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, result.Path)
}

func (s *Server) handleDuplicateTrend(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	points, err := s.store.DuplicateTrend(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if points == nil {
		points = []config.DuplicateTrendPoint{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points})
}

func (s *Server) ensureCatalog(ctx context.Context) (scanner.Catalog, error) {
	s.mu.Lock()
	hasCatalog := s.catalog.GeneratedAt != ""
	catalog := s.catalog
	s.mu.Unlock()
	if hasCatalog {
		return catalog, nil
	}
	catalog, _, err := s.scan(ctx)
	return catalog, err
}

func (s *Server) scan(ctx context.Context) (scanner.Catalog, int64, error) {
	return s.scanWithProgress(ctx, scanner.ScanOptions{}, nil)
}

func (s *Server) scanWithProgress(ctx context.Context, override scanner.ScanOptions, progress scanner.ProgressFunc) (scanner.Catalog, int64, error) {
	projects := toScannerProjects(s.store.Projects())
	settings, err := s.store.Settings()
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	options := scanner.NormalizeScanOptions(scanner.ScanOptions{
		Profile:                settings.ScanProfile,
		Analyses:               settings.ScanAnalyses,
		ExcludePatterns:        settings.ExcludePatterns,
		OptimizationThresholds: settings.OptimizationThresholds,
	})
	if override.Profile != "" || override.Analyses != (scanner.AnalysisOptions{}) {
		options.Profile = override.Profile
		options.Analyses = override.Analyses
		options = scanner.NormalizeScanOptions(options)
		options.ExcludePatterns = settings.ExcludePatterns
	}
	catalog, err := s.scanner.ScanWithOptions(ctx, projects, options, progress)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	if progress != nil {
		progress(scanner.ScanProgress{Phase: scanner.ScanPhasePersisting})
	}
	scanID, err := s.store.RecordScan(catalog)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	catalog.ScanID = scanID
	s.mu.Lock()
	s.catalog = catalog
	s.catalogStale = false
	s.mu.Unlock()
	return catalog, scanID, nil
}

func (s *Server) ensureLatestScan(ctx context.Context) (config.CatalogSummary, error) {
	s.mu.Lock()
	stale := s.catalogStale
	s.mu.Unlock()
	if !stale {
		summary, err := s.store.CatalogSummary()
		if err == nil && !s.analysisIncomplete(summary) {
			return summary, nil
		}
	}
	_, _, err := s.scan(ctx)
	if err != nil {
		return config.CatalogSummary{}, err
	}
	return s.store.CatalogSummary()
}

func (s *Server) analysisIncomplete(summary config.CatalogSummary) bool {
	settings, err := s.store.Settings()
	if err != nil {
		return false
	}
	a := summary.Analysis
	want := settings.ScanAnalyses
	if want.References && a.References != scanner.AnalysisComputed {
		return true
	}
	if want.NearDuplicates && a.NearDuplicates != scanner.AnalysisComputed {
		return true
	}
	if want.Optimization && a.Optimization != scanner.AnalysisComputed {
		return true
	}
	return false
}

func (s *Server) clearCatalog() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog = scanner.Catalog{}
	s.catalogStale = true
	s.previews = map[string]actions.Preview{}
}

func (s *Server) markCatalogStale() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog = scanner.Catalog{}
	s.catalogStale = true
}

func (s *Server) enrichCatalogOCR(ctx context.Context, catalog scanner.Catalog) (scanner.Catalog, error) {
	settings, err := s.store.Settings()
	if err != nil {
		return scanner.Catalog{}, err
	}
	if !settings.OCREnabled {
		return catalog, nil
	}
	ocrSettings := config.OCRSettingsFromApp(settings)
	for index := range catalog.Items {
		item := &catalog.Items[index]
		if item.ContentHash != "" && item.HashAlgorithm != "" {
			continue
		}
		if eligibleForOCRMetadata(*item, ocrSettings).Status != ocr.StatusPending {
			continue
		}
		sum, algorithm, err := scanner.ContentHash(ctx, item.LocalPath)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return scanner.Catalog{}, err
			}
			continue
		}
		item.ContentHash = sum
		item.HashAlgorithm = algorithm
		s.updateCatalogOCRHash(*item)
	}
	results, err := s.store.OCRResults(catalog.Items, ocrSettings, s.ocrEngine.Name(), s.ocrEngine.Version())
	if err != nil {
		return scanner.Catalog{}, err
	}
	for index := range catalog.Items {
		result, ok := results[catalog.Items[index].ProjectID+"\x00"+catalog.Items[index].RepoPath]
		if ok {
			copy := result
			catalog.Items[index].OCR = &copy
			continue
		}
		if eligibleForOCRMetadata(catalog.Items[index], ocrSettings).Status == ocr.StatusPending {
			result := ocr.Result{Status: ocr.StatusPending}
			catalog.Items[index].OCR = &result
		}
	}
	return catalog, nil
}

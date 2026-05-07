package server

import (
	"context"
	"errors"
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

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	catalog, err = s.enrichCatalogOCR(r.Context(), catalog)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
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
	catalog, scanID, err := s.scanWithProgress(r.Context(), progress)
	if err != nil {
		sendNDJSON(w, map[string]any{"type": "error", "error": apierr.From(err, "scan_failed")})
		return
	}
	sendNDJSON(w, map[string]any{"type": "done", "scanId": scanID, "stats": catalog.Stats})
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
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, item := range catalog.Items {
		if item.ID != id {
			continue
		}
		http.ServeFile(w, r, item.LocalPath)
		return
	}
	writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "asset not found"))
}

func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
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
	return s.scanWithProgress(ctx, nil)
}

func (s *Server) scanWithProgress(ctx context.Context, progress scanner.ProgressFunc) (scanner.Catalog, int64, error) {
	projects := toScannerProjects(s.store.Projects())
	settings, err := s.store.Settings()
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	catalog, err := s.scanner.ScanWithProgress(ctx, projects, settings.ExcludePatterns, progress)
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
	s.mu.Lock()
	s.catalog = catalog
	s.mu.Unlock()
	return catalog, scanID, nil
}

func (s *Server) clearCatalog() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalog = scanner.Catalog{}
	s.previews = map[string]actions.Preview{}
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

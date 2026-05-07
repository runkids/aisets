package server

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/optimize"
	"asset-studio/internal/precheck"
	"asset-studio/internal/scanner"
)

func (s *Server) handleOptimizationPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	script := ""
	if len(item.Optimization) > 0 {
		script = "# Preview only. Asset Studio v1.1 does not apply image optimization.\n"
		script += "# Review recommendation codes before running a dedicated optimizer.\n"
		for _, opt := range item.Optimization {
			script += fmt.Sprintf("# %s: %s\n", opt.Category, opt.SuggestionCode)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"assetId":         item.ID,
		"recommendations": item.Optimization,
		"script":          script,
		"canApply":        false,
	})
}

func (s *Server) handleRenamePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID    string `json:"assetId"`
		TargetPath string `json:"targetPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.RenamePreview(project, item, body.TargetPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleMergePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID       string `json:"assetId"`
		PreferredPath string `json:"preferredPath"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	project, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, err := actions.MergePreview(project, item, body.PreferredPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleDeletePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetID string `json:"assetId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, item, err := s.projectAndItem(r.Context(), body.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview := actions.DeleteUnusedPreview(item)
	s.storePreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

type optimizationSelectionBody struct {
	AssetIDs []string `json:"assetIds"`
}

func (s *Server) selectOptimizationItems(ctx context.Context, ids []string) ([]scanner.AssetItem, error) {
	if _, err := s.ensureLatestScan(ctx); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return s.store.AllOptimizableItems(0)
	}
	items, err := s.store.CatalogItemsWithOptimizationByIDs(0, ids)
	if err != nil {
		return nil, err
	}
	missing := missingAssetIDs(ids, items)
	if len(missing) > 0 {
		return nil, apierr.WithParams("asset_not_found", "one or more assets were not found", map[string]any{"assetIds": missing})
	}
	return items, nil
}

func (s *Server) handleOptimizationEstimate(w http.ResponseWriter, r *http.Request) {
	var body optimizationSelectionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, optimize.Compute(items))
}

func missingAssetIDs(ids []string, items []scanner.AssetItem) []string {
	found := map[string]bool{}
	for _, item := range items {
		found[item.ID] = true
	}
	missing := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || found[id] || seen[id] {
			continue
		}
		seen[id] = true
		missing = append(missing, id)
	}
	return missing
}

func (s *Server) handleOptimizationGenerateScript(w http.ResponseWriter, r *http.Request) {
	var body optimizationSelectionBody
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	items, err := s.selectOptimizationItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":    "bash",
		"script":    optimize.GenerateScript(items),
		"itemCount": len(items),
	})
}

func (s *Server) handlePreCheck(w http.ResponseWriter, r *http.Request) {
	const maxUploadBytes = 64 << 20 // 64 MiB total
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_parse_failed", "failed to parse upload"))
		return
	}
	if r.MultipartForm == nil {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("upload_missing", "no files uploaded"))
		return
	}
	catalog, err := s.ensureCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	results := make([]precheck.Result, 0, len(files))
	for _, header := range files {
		res, perr := analyzeUpload(r.Context(), header, catalog)
		if perr != nil {
			writeError(w, http.StatusBadRequest, perr)
			return
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func analyzeUpload(ctx context.Context, header *multipart.FileHeader, catalog scanner.Catalog) (precheck.Result, error) {
	src, err := header.Open()
	if err != nil {
		return precheck.Result{}, apierr.New("upload_open_failed", "failed to open upload")
	}
	defer src.Close()
	tmp, err := os.CreateTemp("", "asset-studio-precheck-*"+filepath.Ext(header.Filename))
	if err != nil {
		return precheck.Result{}, apierr.New("upload_tempfile_failed", "failed to allocate temp file")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return precheck.Result{}, apierr.New("upload_write_failed", "failed to write upload")
	}
	if err := tmp.Close(); err != nil {
		return precheck.Result{}, apierr.New("upload_close_failed", "failed to close upload")
	}
	return precheck.Analyze(ctx, header.Filename, tmpPath, catalog)
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, ok := s.takePreview(body.Token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	project, err := s.projectByID(preview.ProjectID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := actions.Apply(project, preview)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.markCatalogStale()
	go func() {
		_, _, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) projectAndItem(ctx context.Context, assetID string) (scanner.Project, scanner.AssetItem, error) {
	if _, err := s.ensureLatestScan(ctx); err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	detail, err := s.store.CatalogItemDetail(0, assetID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	project, err := s.projectByID(detail.Item.ProjectID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	return project, detail.Item, nil
}

func (s *Server) storePreview(preview actions.Preview) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.previews[preview.ID] = preview
}

func (s *Server) takePreview(id string) (actions.Preview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	preview, ok := s.previews[id]
	if ok {
		delete(s.previews, id)
	}
	return preview, ok
}

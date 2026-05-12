package server

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"aisets/internal/actions"
	"aisets/internal/apierr"
	"aisets/internal/scanner"
)

func (s *Server) handleBatchDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs []string `json:"assetIds"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeJSON(w, http.StatusOK, actions.BatchResult{Succeeded: []string{}})
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result := actions.BatchDelete(project, items)
	s.markCatalogStale()
	go func() {
		_, _, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleBatchMovePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs  []string `json:"assetIds"`
		TargetDir string   `json:"targetDir"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("asset_ids_required", "assetIds must not be empty"))
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	targetDir := normalizeTargetDir(project.Path, body.TargetDir)
	preview := actions.BatchMovePreview(project, items, targetDir)
	s.storeBatchPreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleBatchRenamePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs []string            `json:"assetIds"`
		Rules    actions.RenameRules `json:"rules"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("asset_ids_required", "assetIds must not be empty"))
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview := actions.BatchRenamePreview(project, items, body.Rules)
	s.storeBatchPreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleBatchMergePreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs       []string          `json:"assetIds"`
		PreferredPaths map[string]string `json:"preferredPaths"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("asset_ids_required", "assetIds must not be empty"))
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview := actions.BatchMergePreview(project, items, body.PreferredPaths)
	s.storeBatchPreview(preview)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "token": preview.ID})
}

func (s *Server) handleBatchApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	preview, ok := s.takeBatchPreview(body.Token)
	if !ok {
		writeError(w, http.StatusNotFound, apierr.New("preview_token_invalid", "preview token is invalid or expired"))
		return
	}
	project, err := s.projectByID(preview.ProjectID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := actions.BatchApply(project, preview)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	for _, move := range preview.Moves {
		if err := s.store.MoveAssetFavorite(project.ID, move.From, move.To); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	for _, deleted := range preview.Deletes {
		if err := s.store.DeleteAssetFavorite(project.ID, deleted); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	s.markCatalogStale()
	go func() {
		_, _, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) storeBatchPreview(preview actions.BatchPreview) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.batchPreviews[preview.ID] = preview
}

func (s *Server) takeBatchPreview(id string) (actions.BatchPreview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	preview, ok := s.batchPreviews[id]
	if ok {
		delete(s.batchPreviews, id)
	}
	return preview, ok
}

func (s *Server) handleBatchCopy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs  []string `json:"assetIds"`
		TargetDir string   `json:"targetDir"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeJSON(w, http.StatusOK, actions.BatchResult{Succeeded: []string{}})
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	targetDir := normalizeTargetDir(project.Path, body.TargetDir)
	result := actions.BatchCopy(project, items, targetDir)
	s.markCatalogStale()
	go func() {
		_, _, _ = s.scan(context.Background())
	}()
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleBatchExport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AssetIDs []string `json:"assetIds"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.AssetIDs) == 0 {
		writeError(w, http.StatusBadRequest, apierr.New("empty_selection", "no assets selected"))
		return
	}

	items, _, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	filename := fmt.Sprintf("assets-export-%s.zip", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, item := range items {
		f, err := os.Open(item.LocalPath)
		if err != nil {
			continue
		}
		entry, err := zw.Create(item.RepoPath)
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(entry, f)
		f.Close()
	}
}

// normalizeTargetDir converts an absolute targetDir to a project-relative
// slash-separated path when it falls inside projectPath.
func normalizeTargetDir(projectPath, targetDir string) string {
	if filepath.IsAbs(targetDir) {
		if rel, err := filepath.Rel(projectPath, targetDir); err == nil {
			targetDir = filepath.ToSlash(rel)
		}
	}
	return targetDir
}

func (s *Server) batchItems(ctx context.Context, ids []string) ([]scanner.AssetItem, scanner.Project, error) {
	if _, err := s.ensureLatestScan(ctx); err != nil {
		return nil, scanner.Project{}, err
	}
	items, err := s.store.CatalogItemsByIDs(0, ids)
	if err != nil {
		return nil, scanner.Project{}, err
	}
	if len(items) == 0 {
		return nil, scanner.Project{}, apierr.New("asset_not_found", "none of the requested assets were found")
	}
	project, err := s.projectByID(items[0].ProjectID)
	if err != nil {
		return nil, scanner.Project{}, err
	}
	return items, project, nil
}

package server

import (
	"context"
	"net/http"

	"asset-studio/internal/actions"
	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
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
		writeJSON(w, http.StatusOK, actions.BatchDeleteResult{Succeeded: []string{}})
		return
	}
	items, project, err := s.batchItems(r.Context(), body.AssetIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result := actions.BatchDelete(project, items)
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
	preview := actions.BatchMovePreview(project, items, body.TargetDir)
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

func (s *Server) batchItems(ctx context.Context, ids []string) ([]scanner.AssetItem, scanner.Project, error) {
	catalog, err := s.ensureCatalog(ctx)
	if err != nil {
		return nil, scanner.Project{}, err
	}
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	items := make([]scanner.AssetItem, 0, len(ids))
	for _, item := range catalog.Items {
		if _, ok := idSet[item.ID]; ok {
			items = append(items, item)
		}
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

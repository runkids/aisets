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

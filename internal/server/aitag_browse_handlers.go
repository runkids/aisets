package server

import (
	"fmt"
	"net/http"

	"aisets/internal/config"
)

func (s *Server) handleTagList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit, err := parseOptionalInt(q.Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	offset, err := parseOptionalInt(q.Get("offset"), "offset")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	query := config.AITagListQuery{
		Search:     q.Get("q"),
		Sort:       q.Get("sort"),
		Project:    q.Get("project"),
		ProjectIDs: s.store.ActiveProjectIDs(),
		Category:   q.Get("category"),
		Locale:     sanitizeLocale(q.Get("locale")),
		Limit:      limit,
		Offset:     offset,
	}

	page, err := s.store.AITagList(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleTagRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.From == "" || body.To == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("from and to are required"))
		return
	}
	affected, err := s.store.AITagRenameForProjects(body.From, body.To, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleTagMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source []string `json:"source"`
		Target string   `json:"target"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Source) == 0 || body.Target == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("source and target are required"))
		return
	}
	affected, err := s.store.AITagMergeForProjects(body.Source, body.Target, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleTagDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Tags) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("tags are required"))
		return
	}
	affected, err := s.store.AITagDeleteForProjects(body.Tags, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleAssetSetTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectID     string   `json:"projectId"`
		RepoPath      string   `json:"repoPath"`
		ContentHash   string   `json:"contentHash"`
		HashAlgorithm string   `json:"hashAlgorithm"`
		Tags          []string `json:"tags"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.ProjectID == "" || body.RepoPath == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("projectId and repoPath are required"))
		return
	}

	key := config.AITagSetForAssetKey{
		ProjectID:     body.ProjectID,
		RepoPath:      body.RepoPath,
		ContentHash:   body.ContentHash,
		HashAlgorithm: body.HashAlgorithm,
	}
	if err := s.store.AITagSetForAsset(key, body.Tags); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tags": body.Tags})
}

func (s *Server) handleTagCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := s.store.AITagCategoriesForProjects(s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": cats})
}

func (s *Server) handleTagCategoryList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit, err := parseOptionalInt(q.Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	offset, err := parseOptionalInt(q.Get("offset"), "offset")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	page, err := s.store.AITagCategoryList(config.AICategoryListQuery{
		Search:     q.Get("q"),
		Sort:       q.Get("sort"),
		Locale:     sanitizeLocale(q.Get("locale")),
		ProjectIDs: s.store.ActiveProjectIDs(),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleTagCategoryRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.From == "" || body.To == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("from and to are required"))
		return
	}
	affected, err := s.store.AITagCategoryRenameForProjects(body.From, body.To, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleTagCategoryMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source []string `json:"source"`
		Target string   `json:"target"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Source) == 0 || body.Target == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("source and target are required"))
		return
	}
	affected, err := s.store.AITagCategoryMergeForProjects(body.Source, body.Target, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleTagCategoryClear(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Categories []string `json:"categories"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Categories) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("categories are required"))
		return
	}
	affected, err := s.store.AITagCategoryClearForProjects(body.Categories, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": affected})
}

func (s *Server) handleTagSuggest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	prefix := q.Get("q")

	limit, err := parseOptionalInt(q.Get("limit"), "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if limit == 0 {
		limit = 10
	}

	suggestions, err := s.store.AITagSuggestForProjects(prefix, limit, s.store.ActiveProjectIDs())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": suggestions})
}

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
		Search:   q.Get("q"),
		Sort:     q.Get("sort"),
		Project:  q.Get("project"),
		Category: q.Get("category"),
		Locale:   sanitizeLocale(q.Get("locale")),
		Limit:    limit,
		Offset:   offset,
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
	affected, err := s.store.AITagRename(body.From, body.To)
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
	affected, err := s.store.AITagMerge(body.Source, body.Target)
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
	affected, err := s.store.AITagDelete(body.Tags)
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
	cats, err := s.store.AITagCategories()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": cats})
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

	suggestions, err := s.store.AITagSuggest(prefix, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": suggestions})
}

package server

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"aisets/internal/config"
)

func (s *Server) handleListCanvasSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspaceId")
	sessions, err := s.store.ListCanvasSessions(workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if sessions == nil {
		sessions = []config.CanvasSessionMeta{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (s *Server) handleGetCanvasSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	session, err := s.store.GetCanvasSession(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session})
}

func (s *Server) handleGetCanvasSessionThumbnail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	data, err := s.store.GetCanvasSessionThumbnail(id)
	if err != nil || len(data) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleCreateCanvasSession(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("parse form: %w", err))
		return
	}

	name := r.FormValue("name")
	stateJSON := r.FormValue("stateJson")
	workspaceID := r.FormValue("workspaceId")
	cardCount, _ := strconv.Atoi(r.FormValue("cardCount"))

	if name == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}
	if stateJSON == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("stateJson is required"))
		return
	}

	var thumbReader io.Reader
	thumbFile, _, err := r.FormFile("thumbnail")
	if err == nil {
		thumbReader = thumbFile
		defer thumbFile.Close()
	}

	session, err := s.store.CreateCanvasSession(workspaceID, name, stateJSON, thumbReader, cardCount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"session": session})
}

func (s *Server) handleUpdateCanvasSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("parse form: %w", err))
		return
	}

	name := r.FormValue("name")
	stateJSON := r.FormValue("stateJson")
	cardCount, _ := strconv.Atoi(r.FormValue("cardCount"))

	if stateJSON == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("stateJson is required"))
		return
	}

	var thumbReader io.Reader
	thumbFile, _, err := r.FormFile("thumbnail")
	if err == nil {
		thumbReader = thumbFile
		defer thumbFile.Close()
	}

	session, err := s.store.UpdateCanvasSession(id, name, stateJSON, thumbReader, cardCount)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session})
}

func (s *Server) handleRenameCanvasSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RenameCanvasSession(id, body.Name); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteCanvasSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.DeleteCanvasSession(id); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

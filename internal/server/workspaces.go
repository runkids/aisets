package server

import (
	"net/http"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
)

func workspaceErrorStatus(err error) int {
	if coded, ok := err.(apierr.Error); ok {
		switch coded.Code {
		case "workspace_not_found":
			return http.StatusNotFound
		case "workspace_name_empty", "workspace_last_required", "workspace_icon_invalid":
			return http.StatusBadRequest
		}
	}
	return http.StatusInternalServerError
}

func (s *Server) writeSettingsInfo(w http.ResponseWriter) {
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (s *Server) handleAddWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		IconImage string `json:"iconImage"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := s.store.AddWorkspace(body.Name, body.IconImage); err != nil {
		writeError(w, workspaceErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	s.writeSettingsInfo(w)
}

func (s *Server) handleSwitchWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := s.store.UpdateSettings(config.SettingsUpdate{ActiveWorkspaceID: &body.ID}); err != nil {
		writeError(w, workspaceErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	s.writeSettingsInfo(w)
}

func (s *Server) handleRenameWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		IconImage string `json:"iconImage"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RenameWorkspace(body.ID, body.Name, body.IconImage); err != nil {
		writeError(w, workspaceErrorStatus(err), err)
		return
	}
	s.writeSettingsInfo(w)
}

func (s *Server) handleRemoveWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RemoveWorkspace(body.ID); err != nil {
		writeError(w, workspaceErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	s.writeSettingsInfo(w)
}

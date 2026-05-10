package server

import (
	"database/sql"
	"errors"
	"net/http"

	"aisets/internal/config"
)

func (s *Server) handleListPromptPresets(w http.ResponseWriter, r *http.Request) {
	presetType := r.URL.Query().Get("type")
	presets, err := s.store.ListPromptPresets(presetType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if presets == nil {
		presets = []config.PromptPreset{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": presets})
}

func (s *Server) handleCreatePromptPreset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type      string                     `json:"type"`
		Name      string                     `json:"name"`
		Content   config.PromptPresetContent `json:"content"`
		IsDefault bool                       `json:"isDefault"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	preset, err := s.store.CreatePromptPreset(config.PromptPreset{
		Type:      body.Type,
		Name:      body.Name,
		Content:   body.Content,
		IsDefault: body.IsDefault,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"preset": preset})
}

func (s *Server) handleUpdatePromptPreset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body struct {
		Name      *string                     `json:"name"`
		Content   *config.PromptPresetContent `json:"content"`
		IsDefault *bool                       `json:"isDefault"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	preset, err := s.store.UpdatePromptPreset(id, body.Name, body.Content, body.IsDefault)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preset": preset})
}

func (s *Server) handleDeletePromptPreset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	if err := s.store.DeletePromptPreset(id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSetPromptPresetDefault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	preset, err := s.store.SetPromptPresetDefault(id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preset": preset})
}

func prependSystemPrompt(systemPrompt, prompt string) string {
	if systemPrompt == "" {
		return prompt
	}
	return systemPrompt + "\n\n" + prompt
}

package server

import (
	"context"
	"net/http"
	"time"

	"aisets/internal/llm"
)

func (s *Server) handleLLMModels(w http.ResponseWriter, r *http.Request) {
	if s.llmProvider == nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []llm.Model{}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	models, err := s.llmProvider.ListModels(ctx)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []llm.Model{}, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *Server) handleLLMHealth(w http.ResponseWriter, r *http.Request) {
	if s.llmProvider == nil {
		writeJSON(w, http.StatusOK, llm.RuntimeStatus{
			Provider:  "",
			Connected: false,
			Error:     "disabled",
		})
		return
	}
	settings, _ := s.store.Settings()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	status := llm.RuntimeStatus{
		Provider:    settings.LLMProvider,
		Endpoint:    settings.LLMEndpoint,
		VisionModel: settings.LLMVisionModel,
		EmbedModel:  settings.LLMEmbedModel,
	}
	models, err := s.llmProvider.ListModels(ctx)
	if err != nil {
		status.Error = err.Error()
		writeJSON(w, http.StatusOK, status)
		return
	}
	status.Connected = true
	status.Models = models
	writeJSON(w, http.StatusOK, status)
}

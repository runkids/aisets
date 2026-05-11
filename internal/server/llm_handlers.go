package server

import (
	"context"
	"net/http"
	"time"

	"aisets/internal/config"
	"aisets/internal/llm"
)

func (s *Server) handleLLMModels(w http.ResponseWriter, r *http.Request) {
	providerName := r.URL.Query().Get("provider")
	endpoint := r.URL.Query().Get("endpoint")
	apiKey := r.URL.Query().Get("apiKey")

	var provider llm.Provider
	if providerName != "" && endpoint != "" {
		if apiKey == "" {
			if settings, err := s.store.Settings(); err == nil {
				apiKey = settings.LLMApiKey
			}
		}
		provider = newLLMProvider(providerName, endpoint, apiKey)
	} else {
		provider = s.llmProvider
	}

	if provider == nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []llm.Model{}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	models, err := provider.ListModels(ctx)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []llm.Model{}, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *Server) handleLLMHealth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string `json:"provider"`
		Endpoint string `json:"endpoint"`
		ApiKey   string `json:"apiKey"`
	}
	if r.Body != nil {
		_ = readJSON(r, &body)
	}
	if body.Provider == "" || body.Endpoint == "" || body.ApiKey == "" {
		settings, _ := s.store.Settings()
		if body.Provider == "" {
			body.Provider = settings.LLMProvider
		}
		if body.Endpoint == "" {
			body.Endpoint = settings.LLMEndpoint
		}
		if body.ApiKey == "" {
			body.ApiKey = settings.LLMApiKey
		}
	}

	resolved := config.ResolveEndpointForRuntime(body.Endpoint)
	status := llm.RuntimeStatus{
		Provider: body.Provider,
		Endpoint: resolved,
	}

	provider := newLLMProvider(body.Provider, body.Endpoint, body.ApiKey)
	if provider == nil {
		status.Error = "no provider configured"
		writeJSON(w, http.StatusOK, status)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	models, err := provider.ListModels(ctx)
	if err != nil {
		status.Error = err.Error()
		writeJSON(w, http.StatusOK, status)
		return
	}
	status.Connected = true
	status.Models = models
	writeJSON(w, http.StatusOK, status)
}

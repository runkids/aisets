package server

import (
	"context"
	"net/http"

	"aisets/internal/agent"
)

func (s *Server) handleAgentStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.agentStatus)
}

func (s *Server) handleAgentDetect(w http.ResponseWriter, _ *http.Request) {
	s.detectAgentCLIs()
	s.initAgentChat()
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

// detectAgentCLIs always runs detection regardless of AgentEnabled,
// so the settings page can show available CLIs before the user saves.
func (s *Server) detectAgentCLIs() {
	if s.store == nil {
		return
	}
	settings, err := s.store.Settings()
	if err != nil {
		return
	}
	llmInfo := agent.LLMInfo{
		Enabled:  settings.LLMEnabled,
		Provider: settings.LLMProvider,
		Model:    settings.LLMVisionModel,
	}
	s.agentStatus = agent.BuildRuntimeStatus(context.Background(), settings.AgentAdapter, llmInfo)
}

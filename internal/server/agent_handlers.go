package server

import "net/http"

func (s *Server) handleAgentStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.agentStatus)
}

func (s *Server) handleAgentDetect(w http.ResponseWriter, _ *http.Request) {
	s.initAgentStatus()
	s.initAgentChat()
	settings, err := s.currentSettingsInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

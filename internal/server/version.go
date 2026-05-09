package server

import (
	"context"
	"net/http"
	"time"

	versionpkg "aisets/internal/version"
)

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	result, err := versionpkg.Check(ctx, s.version)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DryRun bool `json:"dryRun"`
		Force  bool `json:"force"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	result, err := versionpkg.Upgrade(r.Context(), versionpkg.UpgradeOptions{
		CurrentVersion: s.version,
		DryRun:         body.DryRun,
		Force:          body.Force,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "update": result})
}

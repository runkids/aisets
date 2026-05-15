package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"aisets/internal/apierr"
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
		status, updateErr := updateAPIError(err)
		writeJSON(w, status, map[string]any{"error": updateErr})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "update": result})
}

func updateAPIError(err error) (int, apierr.Error) {
	var elevated versionpkg.ElevatedPermissionError
	if errors.As(err, &elevated) {
		return http.StatusForbidden, apierr.WithParams(
			"update_elevated_permission_required",
			err.Error(),
			map[string]any{"path": elevated.Path},
		)
	}
	return http.StatusInternalServerError, apierr.WithParams(
		"update_failed",
		err.Error(),
		map[string]any{"message": err.Error()},
	)
}

package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"aisets/internal/apierr"
	"aisets/internal/uidist"
	versionpkg "aisets/internal/version"
)

var (
	downloadUpdateUIDist = uidist.Download
	runElevatedUpdate    = defaultRunElevatedUpdate
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
		var elevated versionpkg.ElevatedPermissionError
		if !body.DryRun && errors.As(err, &elevated) {
			if elevatedErr := runElevatedUpdate(elevated.Path); elevatedErr == nil {
				result.Updated = true
				result.Privileged = true
				result.Message = "Updated. Restart Aisets to use the new version."
				s.decorateUpdateResult(&result)
				writeJSON(w, http.StatusOK, map[string]any{"ok": true, "update": result})
				return
			}
		}
		status, updateErr := updateAPIError(err)
		s.decorateUpdateAPIError(&updateErr)
		writeJSON(w, status, map[string]any{"error": updateErr})
		return
	}
	s.decorateUpdateResult(&result)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "update": result})
}

func (s *Server) decorateUpdateResult(result *versionpkg.UpgradeResult) {
	if host, port, err := net.SplitHostPort(s.addr); err == nil {
		result.UIHost = host
		result.UIPort = port
	}
	result.UIBasePath = s.basePath
	cacheUpdatedUI(result)
}

func cacheUpdatedUI(result *versionpkg.UpgradeResult) {
	if !result.Updated || result.DryRun || result.DevMode || result.LatestVersion == "" {
		return
	}
	if err := downloadUpdateUIDist(result.LatestVersion); err != nil {
		result.UICacheError = err.Error()
		return
	}
	result.UICached = true
}

func (s *Server) decorateUpdateAPIError(updateErr *apierr.Error) {
	if updateErr.Code != "update_elevated_permission_required" {
		return
	}
	if updateErr.Params == nil {
		updateErr.Params = map[string]any{}
	}
	if host, port, err := net.SplitHostPort(s.addr); err == nil {
		updateErr.Params["uiHost"] = host
		updateErr.Params["uiPort"] = port
	}
	if s.basePath != "" {
		updateErr.Params["uiBasePath"] = s.basePath
	}
}

func updateAPIError(err error) (int, apierr.Error) {
	var elevated versionpkg.ElevatedPermissionError
	if errors.As(err, &elevated) {
		return http.StatusForbidden, apierr.WithParams(
			"update_elevated_permission_required",
			err.Error(),
			map[string]any{
				"path":    elevated.Path,
				"command": fmt.Sprintf("sudo %s update --force", elevated.Path),
			},
		)
	}
	return http.StatusInternalServerError, apierr.WithParams(
		"update_failed",
		err.Error(),
		map[string]any{"message": err.Error()},
	)
}

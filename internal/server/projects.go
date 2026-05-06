package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/scanner"
)

func (s *Server) handleProjects(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

type directoryEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func (s *Server) handleDirectories(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		cwd, err := os.Getwd()
		if err != nil {
			writeError(w, http.StatusInternalServerError, apierr.New("directory_default_path_failed", "failed to resolve default directory"))
			return
		}
		path = cwd
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		writeError(w, http.StatusBadRequest, apierr.WithParams("directory_path_invalid", "directory path is invalid", map[string]any{"path": path}))
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, directoryAccessError(err, abs))
		return
	}
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, apierr.WithParams("directory_path_not_directory", "path is not a directory", map[string]any{"path": abs}))
		return
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, directoryAccessError(err, abs))
		return
	}
	dirs := make([]directoryEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		dirs = append(dirs, directoryEntry{Name: name, Path: filepath.Join(abs, name)})
	}
	sort.Slice(dirs, func(i, j int) bool { return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name) })
	parent := ""
	if next := filepath.Dir(abs); next != abs {
		parent = next
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": abs, "parent": parent, "directories": dirs})
}

func directoryAccessError(err error, path string) apierr.Error {
	params := map[string]any{"path": path}
	if errors.Is(err, os.ErrNotExist) {
		return apierr.WithParams("directory_not_found", "directory not found", params)
	}
	if errors.Is(err, os.ErrPermission) {
		return apierr.WithParams("directory_permission_denied", "directory permission denied", params)
	}
	return apierr.WithParams("directory_unreadable", "directory is unreadable", params)
}

func projectPathError(err error, path string) apierr.Error {
	params := map[string]any{"path": path}
	var pathErr *config.PathError
	if errors.As(err, &pathErr) {
		params["path"] = pathErr.Path
		return apierr.WithParams("project_path_not_directory", "project path must be a directory", params)
	}
	if errors.Is(err, os.ErrNotExist) {
		return apierr.WithParams("project_path_not_found", "project path not found", params)
	}
	if errors.Is(err, os.ErrPermission) {
		return apierr.WithParams("project_path_permission_denied", "project path permission denied", params)
	}
	return apierr.WithParams("project_path_invalid", "project path is invalid", params)
}

func projectErrorStatus(err error) int {
	if coded, ok := err.(apierr.Error); ok && coded.Code == "project_not_found" {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (s *Server) handleAddProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.AddProjects([]string{body.Path}); err != nil {
		writeError(w, http.StatusBadRequest, projectPathError(err, body.Path))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleRemoveProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RemoveProject(body.ID); err != nil {
		writeError(w, projectErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) handleRenameProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.store.RenameProject(body.ID, body.Name); err != nil {
		writeError(w, projectErrorStatus(err), err)
		return
	}
	s.clearCatalog()
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects()})
}

func (s *Server) projectByID(id string) (scanner.Project, error) {
	for _, project := range toScannerProjects(s.store.Projects()) {
		if project.ID == id {
			return project, nil
		}
	}
	return scanner.Project{}, apierr.New("project_not_found", "project not found")
}

func toScannerProjects(projects []config.Project) []scanner.Project {
	out := make([]scanner.Project, 0, len(projects))
	for _, project := range projects {
		out = append(out, scanner.Project{ID: project.ID, WorkspaceID: project.WorkspaceID, Name: project.Name, Path: project.Path, CreatedAt: project.CreatedAt})
	}
	return out
}

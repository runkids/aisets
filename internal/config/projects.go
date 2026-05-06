package config

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"asset-studio/internal/apierr"
)

func (s *Store) Projects() []Project {
	return s.ProjectsInWorkspace(s.activeWorkspaceID())
}

func (s *Store) AllProjects() []Project {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, path, created_at
		FROM projects
		WHERE deleted_at IS NULL
		ORDER BY lower(path)
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var project Project
		if err := rows.Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.Path, &project.CreatedAt); err == nil {
			out = append(out, project)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].WorkspaceID != out[j].WorkspaceID {
			return out[i].WorkspaceID < out[j].WorkspaceID
		}
		return strings.ToLower(out[i].Path) < strings.ToLower(out[j].Path)
	})
	return out
}

func (s *Store) ProjectsInWorkspace(workspaceID string) []Project {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, path, created_at
		FROM projects
		WHERE workspace_id = ? AND deleted_at IS NULL
		ORDER BY lower(path)
	`, workspaceID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var project Project
		if err := rows.Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.Path, &project.CreatedAt); err == nil {
			out = append(out, project)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Path) < strings.ToLower(out[j].Path) })
	return out
}

func (s *Store) AddProjects(paths []string) error {
	return s.AddProjectsToWorkspace(s.activeWorkspaceID(), paths)
}

func (s *Store) AddProjectsToWorkspace(workspaceID string, paths []string) error {
	if _, err := s.workspace(workspaceID); err != nil {
		return err
	}
	now := nowUTC()
	for _, raw := range paths {
		if raw == "" {
			continue
		}
		abs, err := filepath.Abs(raw)
		if err != nil {
			return err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return &PathError{Path: abs, Message: "project path must be a directory"}
		}
		if _, err := s.db.Exec(`
			INSERT INTO projects (id, workspace_id, name, path, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(workspace_id, path) DO UPDATE SET
				name = excluded.name,
				deleted_at = NULL,
				updated_at = excluded.updated_at
		`, projectID(workspaceID, abs), workspaceID, filepath.Base(abs), abs, now, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) RemoveProject(id string) error {
	result, err := s.db.Exec(`
		UPDATE projects
		SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, nowUTC(), nowUTC(), id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return apierr.New("project_not_found", "project not found")
	}
	return nil
}

func (s *Store) RenameProject(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return apierr.New("project_name_empty", "project name must not be empty")
	}
	result, err := s.db.Exec(`
		UPDATE projects
		SET name = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, name, nowUTC(), id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return apierr.New("project_not_found", "project not found")
	}
	return nil
}

type PathError struct {
	Path    string
	Message string
}

func (e *PathError) Error() string {
	return e.Message + ": " + e.Path
}

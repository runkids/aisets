package config

import (
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"aisets/internal/apierr"
	"aisets/internal/scanner"
)

func (s *Store) Projects() []Project {
	return s.ProjectsInWorkspace(s.activeWorkspaceID())
}

func (s *Store) AllProjects() []Project {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, path, icon_image, scan_intent, created_at
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
		if err := rows.Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.Path, &project.IconImage, &project.ScanIntent, &project.CreatedAt); err == nil {
			project.ScanIntent = scanner.NormalizeProjectScanIntent(project.ScanIntent)
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

func (s *Store) Project(id string) (Project, error) {
	var project Project
	err := s.db.QueryRow(`
		SELECT id, workspace_id, name, path, icon_image, scan_intent, created_at
		FROM projects
		WHERE id = ? AND deleted_at IS NULL
	`, id).Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.Path, &project.IconImage, &project.ScanIntent, &project.CreatedAt)
	if err == sql.ErrNoRows {
		return Project{}, apierr.New("project_not_found", "project not found")
	}
	if err != nil {
		return Project{}, err
	}
	project.ScanIntent = scanner.NormalizeProjectScanIntent(project.ScanIntent)
	return project, nil
}

func (s *Store) ProjectsInWorkspace(workspaceID string) []Project {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, path, icon_image, scan_intent, created_at
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
		if err := rows.Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.Path, &project.IconImage, &project.ScanIntent, &project.CreatedAt); err == nil {
			project.ScanIntent = scanner.NormalizeProjectScanIntent(project.ScanIntent)
			out = append(out, project)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Path) < strings.ToLower(out[j].Path) })
	return out
}

type ProjectAddStatus string

const (
	ProjectAddStatusAdded    ProjectAddStatus = "added"
	ProjectAddStatusExisting ProjectAddStatus = "existing"
	ProjectAddStatusRestored ProjectAddStatus = "restored"
)

type ProjectAddResult struct {
	Status  ProjectAddStatus `json:"status"`
	Project Project          `json:"project"`
}

func (s *Store) AddProjects(paths []string) error {
	_, err := s.AddProjectsWithIntentResult(paths, scanner.ProjectScanIntentCode)
	return err
}

func (s *Store) AddProjectsWithIntent(paths []string, intent scanner.ProjectScanIntent) error {
	_, err := s.AddProjectsWithIntentResult(paths, intent)
	return err
}

func (s *Store) AddProjectsWithIntentResult(paths []string, intent scanner.ProjectScanIntent) ([]ProjectAddResult, error) {
	return s.AddProjectsToWorkspaceWithIntentResult(s.activeWorkspaceID(), paths, intent)
}

func (s *Store) AddProjectsToWorkspace(workspaceID string, paths []string) error {
	_, err := s.AddProjectsToWorkspaceWithIntentResult(workspaceID, paths, scanner.ProjectScanIntentCode)
	return err
}

func (s *Store) AddProjectsToWorkspaceWithIntent(workspaceID string, paths []string, intent scanner.ProjectScanIntent) error {
	_, err := s.AddProjectsToWorkspaceWithIntentResult(workspaceID, paths, intent)
	return err
}

func (s *Store) AddProjectsToWorkspaceWithIntentResult(workspaceID string, paths []string, intent scanner.ProjectScanIntent) ([]ProjectAddResult, error) {
	if _, err := s.workspace(workspaceID); err != nil {
		return nil, err
	}
	if intent != "" && !scanner.ValidProjectScanIntent(intent) {
		return nil, apierr.WithParams("project_scan_intent_invalid", "project scan intent is invalid", map[string]any{"scanIntent": intent})
	}
	intent = scanner.NormalizeProjectScanIntent(intent)
	now := nowUTC()
	results := []ProjectAddResult{}
	for _, raw := range paths {
		if raw == "" {
			continue
		}
		abs, err := canonicalProjectPath(raw)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			return nil, &PathError{Path: abs, Message: "project path must be a directory"}
		}
		id := projectID(workspaceID, abs)
		status := ProjectAddStatusAdded
		var deletedAt sql.NullString
		err = s.db.QueryRow(`
			SELECT deleted_at
			FROM projects
			WHERE workspace_id = ? AND path = ?
		`, workspaceID, abs).Scan(&deletedAt)
		if err == nil {
			project, err := s.Project(id)
			if err != nil && (!deletedAt.Valid || deletedAt.String == "") {
				return nil, err
			}
			if !deletedAt.Valid || deletedAt.String == "" {
				results = append(results, ProjectAddResult{Status: ProjectAddStatusExisting, Project: project})
				continue
			}
			status = ProjectAddStatusRestored
		} else if err != sql.ErrNoRows {
			return nil, err
		}
		if _, err := s.db.Exec(`
			INSERT INTO projects (id, workspace_id, name, path, scan_intent, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(workspace_id, path) DO UPDATE SET
				name = excluded.name,
				scan_intent = excluded.scan_intent,
				deleted_at = NULL,
				updated_at = excluded.updated_at
		`, id, workspaceID, filepath.Base(abs), abs, intent, now, now); err != nil {
			return nil, err
		}
		project, err := s.Project(id)
		if err != nil {
			return nil, err
		}
		results = append(results, ProjectAddResult{Status: status, Project: project})
	}
	return results, nil
}

func (s *Store) RemoveProject(id string) error {
	result, err := s.db.Exec(`
		UPDATE projects
		SET icon_image = '', deleted_at = ?, updated_at = ?
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

func (s *Store) RenameProject(id, name, iconImage string, intents ...scanner.ProjectScanIntent) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return apierr.New("project_name_empty", "project name must not be empty")
	}
	intent := scanner.ProjectScanIntent("")
	updateIntent := len(intents) > 0
	if updateIntent {
		if intents[0] != "" && !scanner.ValidProjectScanIntent(intents[0]) {
			return apierr.WithParams("project_scan_intent_invalid", "project scan intent is invalid", map[string]any{"scanIntent": intents[0]})
		}
		intent = scanner.NormalizeProjectScanIntent(intents[0])
	}
	iconImage, err := normalizeProjectIconImage(iconImage)
	if err != nil {
		return err
	}
	var result sql.Result
	if updateIntent {
		result, err = s.db.Exec(`
			UPDATE projects
			SET name = ?, icon_image = ?, scan_intent = ?, updated_at = ?
			WHERE id = ? AND deleted_at IS NULL
		`, name, iconImage, intent, nowUTC(), id)
	} else {
		result, err = s.db.Exec(`
			UPDATE projects
			SET name = ?, icon_image = ?, updated_at = ?
			WHERE id = ? AND deleted_at IS NULL
		`, name, iconImage, nowUTC(), id)
	}
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

func canonicalProjectPath(raw string) (string, error) {
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(realPath), nil
}

type PathError struct {
	Path    string
	Message string
}

func (e *PathError) Error() string {
	return e.Message + ": " + e.Path
}

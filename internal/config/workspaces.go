package config

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"asset-studio/internal/apierr"
)

const defaultWorkspaceID = "default"

func (s *Store) Workspaces() []Workspace {
	rows, err := s.db.Query(`
		SELECT w.id, w.name, COUNT(p.id) AS project_count
		FROM workspaces w
		LEFT JOIN projects p ON p.workspace_id = w.id AND p.deleted_at IS NULL
		WHERE w.deleted_at IS NULL
		GROUP BY w.id, w.name, w.created_at
		ORDER BY lower(w.name), w.created_at
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var workspace Workspace
		if err := rows.Scan(&workspace.ID, &workspace.Name, &workspace.ProjectCount); err == nil {
			out = append(out, workspace)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func (s *Store) AddWorkspace(name string) (Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Workspace{}, apierr.New("workspace_name_empty", "workspace name must not be empty")
	}
	now := nowUTC()
	id := workspaceID(name, strconv.FormatInt(time.Now().UnixNano(), 10))
	if _, err := s.db.Exec(`
		INSERT INTO workspaces (id, name, created_at, updated_at)
		VALUES (?, ?, ?, ?)
	`, id, name, now, now); err != nil {
		return Workspace{}, err
	}
	if _, err := s.UpdateSettings(SettingsUpdate{ActiveWorkspaceID: &id}); err != nil {
		return Workspace{}, err
	}
	return Workspace{ID: id, Name: name, ProjectCount: 0}, nil
}

func (s *Store) RenameWorkspace(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return apierr.New("workspace_name_empty", "workspace name must not be empty")
	}
	result, err := s.db.Exec(`
		UPDATE workspaces
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
		return apierr.New("workspace_not_found", "workspace not found")
	}
	settings, err := s.Settings()
	if err != nil {
		return err
	}
	if settings.ActiveWorkspaceID == id {
		_, err = s.UpdateSettings(SettingsUpdate{WorkspaceName: &name})
	}
	return err
}

func (s *Store) RemoveWorkspace(id string) error {
	workspaces := s.Workspaces()
	if len(workspaces) <= 1 {
		return apierr.New("workspace_last_required", "at least one workspace is required")
	}
	var found bool
	for _, workspace := range workspaces {
		if workspace.ID == id {
			found = true
			break
		}
	}
	if !found {
		return apierr.New("workspace_not_found", "workspace not found")
	}
	now := nowUTC()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		UPDATE workspaces SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, now, now, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		UPDATE projects SET deleted_at = ?, updated_at = ?
		WHERE workspace_id = ? AND deleted_at IS NULL
	`, now, now, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	settings, err := s.Settings()
	if err != nil {
		return err
	}
	if settings.ActiveWorkspaceID == id {
		for _, workspace := range s.Workspaces() {
			if workspace.ID != id {
				_, err = s.UpdateSettings(SettingsUpdate{ActiveWorkspaceID: &workspace.ID})
				return err
			}
		}
	}
	return nil
}

func (s *Store) activeWorkspaceID() string {
	settings, err := s.Settings()
	if err != nil || settings.ActiveWorkspaceID == "" {
		return defaultWorkspaceID
	}
	return settings.ActiveWorkspaceID
}

func (s *Store) workspace(id string) (Workspace, error) {
	var workspace Workspace
	err := s.db.QueryRow(`
		SELECT w.id, w.name, COUNT(p.id) AS project_count
		FROM workspaces w
		LEFT JOIN projects p ON p.workspace_id = w.id AND p.deleted_at IS NULL
		WHERE w.id = ? AND w.deleted_at IS NULL
		GROUP BY w.id, w.name
	`, id).Scan(&workspace.ID, &workspace.Name, &workspace.ProjectCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Workspace{}, apierr.New("workspace_not_found", "workspace not found")
	}
	if err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

func workspaceID(name, seed string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, slug)
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "workspace"
	}
	if len(slug) > 32 {
		slug = slug[:32]
	}
	sum := sha1.Sum([]byte(name + "\x00" + seed))
	return slug + "-" + hex.EncodeToString(sum[:])[:8]
}

func projectID(workspaceID, abs string) string {
	if workspaceID == "" || workspaceID == defaultWorkspaceID {
		return abs
	}
	sum := sha1.Sum([]byte(workspaceID + "\x00" + abs))
	return workspaceID + ":" + hex.EncodeToString(sum[:])[:16]
}

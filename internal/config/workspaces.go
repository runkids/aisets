package config

import (
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"aisets/internal/apierr"
)

const defaultWorkspaceID = "default"

const maxWorkspaceIconBytes = 512 * 1024

func (s *Store) Workspaces() []Workspace {
	rows, err := s.rdb.Query(`
		SELECT w.id, w.name, w.icon_image, COUNT(p.id) AS project_count
		FROM workspaces w
		LEFT JOIN projects p ON p.workspace_id = w.id AND p.deleted_at IS NULL
		WHERE w.deleted_at IS NULL
		GROUP BY w.id, w.name, w.icon_image, w.created_at
		ORDER BY lower(w.name), w.created_at
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var workspace Workspace
		if err := rows.Scan(&workspace.ID, &workspace.Name, &workspace.IconImage, &workspace.ProjectCount); err == nil {
			out = append(out, workspace)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func (s *Store) AddWorkspace(name, iconImage string) (Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Workspace{}, apierr.New("workspace_name_empty", "workspace name must not be empty")
	}
	iconImage, err := normalizeWorkspaceIconImage(iconImage)
	if err != nil {
		return Workspace{}, err
	}
	now := nowUTC()
	id := workspaceID(name, strconv.FormatInt(time.Now().UnixNano(), 10))
	if _, err := s.db.Exec(`
		INSERT INTO workspaces (id, name, icon_image, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, id, name, iconImage, now, now); err != nil {
		return Workspace{}, err
	}
	if _, err := s.UpdateSettings(SettingsUpdate{ActiveWorkspaceID: &id}); err != nil {
		return Workspace{}, err
	}
	return Workspace{ID: id, Name: name, IconImage: iconImage, ProjectCount: 0}, nil
}

func (s *Store) RenameWorkspace(id, name, iconImage string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return apierr.New("workspace_name_empty", "workspace name must not be empty")
	}
	iconImage, err := normalizeWorkspaceIconImage(iconImage)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(`
		UPDATE workspaces
		SET name = ?, icon_image = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`, name, iconImage, nowUTC(), id)
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
	err := s.rdb.QueryRow(`
		SELECT w.id, w.name, w.icon_image, COUNT(p.id) AS project_count
		FROM workspaces w
		LEFT JOIN projects p ON p.workspace_id = w.id AND p.deleted_at IS NULL
		WHERE w.id = ? AND w.deleted_at IS NULL
		GROUP BY w.id, w.name, w.icon_image
	`, id).Scan(&workspace.ID, &workspace.Name, &workspace.IconImage, &workspace.ProjectCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Workspace{}, apierr.New("workspace_not_found", "workspace not found")
	}
	if err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

func normalizeWorkspaceIconImage(value string) (string, error) {
	return normalizeIconImage(value, "workspace_icon_invalid", "workspace")
}

func normalizeProjectIconImage(value string) (string, error) {
	return normalizeIconImage(value, "project_icon_invalid", "project")
}

func normalizeIconImage(value, code, label string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	prefix, encoded, ok := strings.Cut(value, ",")
	if !ok {
		return "", apierr.New(code, label+" icon must be a PNG, JPEG, GIF, or WebP data URL")
	}
	allowedPrefix := false
	for _, candidate := range []string{
		"data:image/png;base64",
		"data:image/jpeg;base64",
		"data:image/gif;base64",
		"data:image/webp;base64",
	} {
		if strings.EqualFold(prefix, candidate) {
			allowedPrefix = true
			break
		}
	}
	if !allowedPrefix {
		return "", apierr.New(code, label+" icon must be a PNG, JPEG, GIF, or WebP data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) == 0 || len(decoded) > maxWorkspaceIconBytes {
		return "", apierr.New(code, label+" icon must be a PNG, JPEG, GIF, or WebP data URL under 512 KB")
	}
	return value, nil
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

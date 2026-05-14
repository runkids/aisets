package config

import (
	"database/sql"
	"fmt"
	"io"

	"github.com/google/uuid"
)

type CanvasSessionMeta struct {
	ID           string `json:"id"`
	WorkspaceID  string `json:"workspaceId"`
	Name         string `json:"name"`
	CardCount    int    `json:"cardCount"`
	HasThumbnail bool   `json:"hasThumbnail"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type CanvasSessionFull struct {
	CanvasSessionMeta
	StateJSON string `json:"stateJson"`
}

func (s *Store) migrateCanvasSessionsTable() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS canvas_sessions (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL DEFAULT 'default',
			name TEXT NOT NULL,
			state_json TEXT NOT NULL,
			thumbnail BLOB,
			card_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_canvas_sessions_ws_updated
			ON canvas_sessions(workspace_id, updated_at DESC)`,
	}
	for _, stmt := range statements {
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("migrateCanvasSessionsTable: %w", err)
		}
	}
	return nil
}

func (s *Store) ListCanvasSessions(workspaceID string) ([]CanvasSessionMeta, error) {
	if workspaceID == "" {
		workspaceID = "default"
	}
	rows, err := s.rdb.Query(
		`SELECT id, workspace_id, name, card_count,
			(thumbnail IS NOT NULL AND LENGTH(thumbnail) > 0) AS has_thumb,
			created_at, updated_at
		FROM canvas_sessions
		WHERE workspace_id = ?
		ORDER BY updated_at DESC`,
		workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("ListCanvasSessions: %w", err)
	}
	defer rows.Close()

	var sessions []CanvasSessionMeta
	for rows.Next() {
		var m CanvasSessionMeta
		if err := rows.Scan(&m.ID, &m.WorkspaceID, &m.Name, &m.CardCount, &m.HasThumbnail, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ListCanvasSessions scan: %w", err)
		}
		sessions = append(sessions, m)
	}
	return sessions, rows.Err()
}

func (s *Store) GetCanvasSession(id string) (CanvasSessionFull, error) {
	row := s.rdb.QueryRow(
		`SELECT id, workspace_id, name, card_count,
			(thumbnail IS NOT NULL AND LENGTH(thumbnail) > 0) AS has_thumb,
			created_at, updated_at, state_json
		FROM canvas_sessions WHERE id = ?`,
		id,
	)
	var f CanvasSessionFull
	if err := row.Scan(&f.ID, &f.WorkspaceID, &f.Name, &f.CardCount, &f.HasThumbnail, &f.CreatedAt, &f.UpdatedAt, &f.StateJSON); err != nil {
		if err == sql.ErrNoRows {
			return f, fmt.Errorf("canvas session not found")
		}
		return f, fmt.Errorf("GetCanvasSession: %w", err)
	}
	return f, nil
}

func (s *Store) GetCanvasSessionThumbnail(id string) ([]byte, error) {
	var data []byte
	err := s.rdb.QueryRow(`SELECT thumbnail FROM canvas_sessions WHERE id = ?`, id).Scan(&data)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("canvas session not found")
		}
		return nil, fmt.Errorf("GetCanvasSessionThumbnail: %w", err)
	}
	return data, nil
}

func (s *Store) CreateCanvasSession(workspaceID, name, stateJSON string, thumbnail io.Reader, cardCount int) (CanvasSessionMeta, error) {
	if name == "" {
		return CanvasSessionMeta{}, fmt.Errorf("session name is required")
	}
	if workspaceID == "" {
		workspaceID = "default"
	}

	id := uuid.NewString()
	now := nowUTC()

	var thumbBytes []byte
	if thumbnail != nil {
		var err error
		thumbBytes, err = io.ReadAll(thumbnail)
		if err != nil {
			return CanvasSessionMeta{}, fmt.Errorf("read thumbnail: %w", err)
		}
	}

	if _, err := s.db.Exec(
		`INSERT INTO canvas_sessions (id, workspace_id, name, state_json, thumbnail, card_count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, workspaceID, name, stateJSON, thumbBytes, cardCount, now, now,
	); err != nil {
		return CanvasSessionMeta{}, fmt.Errorf("CreateCanvasSession: %w", err)
	}

	return CanvasSessionMeta{
		ID:           id,
		WorkspaceID:  workspaceID,
		Name:         name,
		CardCount:    cardCount,
		HasThumbnail: len(thumbBytes) > 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

func (s *Store) UpdateCanvasSession(id, name, stateJSON string, thumbnail io.Reader, cardCount int) (CanvasSessionMeta, error) {
	existing, err := s.GetCanvasSession(id)
	if err != nil {
		return CanvasSessionMeta{}, err
	}

	if name != "" {
		existing.Name = name
	}
	now := nowUTC()

	var thumbBytes []byte
	if thumbnail != nil {
		thumbBytes, err = io.ReadAll(thumbnail)
		if err != nil {
			return CanvasSessionMeta{}, fmt.Errorf("read thumbnail: %w", err)
		}
	}

	if _, err := s.db.Exec(
		`UPDATE canvas_sessions SET name = ?, state_json = ?, thumbnail = ?, card_count = ?, updated_at = ? WHERE id = ?`,
		existing.Name, stateJSON, thumbBytes, cardCount, now, id,
	); err != nil {
		return CanvasSessionMeta{}, fmt.Errorf("UpdateCanvasSession: %w", err)
	}

	return CanvasSessionMeta{
		ID:           existing.ID,
		WorkspaceID:  existing.WorkspaceID,
		Name:         existing.Name,
		CardCount:    cardCount,
		HasThumbnail: len(thumbBytes) > 0,
		CreatedAt:    existing.CreatedAt,
		UpdatedAt:    now,
	}, nil
}

func (s *Store) RenameCanvasSession(id, name string) error {
	if name == "" {
		return fmt.Errorf("session name is required")
	}
	res, err := s.db.Exec(`UPDATE canvas_sessions SET name = ?, updated_at = ? WHERE id = ?`, name, nowUTC(), id)
	if err != nil {
		return fmt.Errorf("RenameCanvasSession: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("canvas session not found")
	}
	return nil
}

func (s *Store) DeleteCanvasSession(id string) error {
	res, err := s.db.Exec(`DELETE FROM canvas_sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteCanvasSession: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("canvas session not found")
	}
	return nil
}

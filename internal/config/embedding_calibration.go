package config

import (
	"database/sql"
	"strings"
)

type EmbeddingCalibrationLabel struct {
	ID          int64  `json:"id"`
	Query       string `json:"query"`
	SearchType  string `json:"searchType"`
	AssetID     string `json:"assetId"`
	ProjectID   string `json:"projectId"`
	RepoPath    string `json:"repoPath"`
	ContentHash string `json:"contentHash"`
	Label       string `json:"label"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func normalizeCalibrationSearchType(v string) string {
	switch strings.TrimSpace(v) {
	case "text", "image", "hybrid":
		return strings.TrimSpace(v)
	default:
		return "hybrid"
	}
}

func normalizeCalibrationLabel(v string) string {
	if strings.TrimSpace(v) == "match" {
		return "match"
	}
	return "reject"
}

func (s *Store) UpsertEmbeddingCalibrationLabel(label EmbeddingCalibrationLabel) (EmbeddingCalibrationLabel, error) {
	label.Query = strings.TrimSpace(label.Query)
	label.SearchType = normalizeCalibrationSearchType(label.SearchType)
	label.AssetID = strings.TrimSpace(label.AssetID)
	label.ProjectID = strings.TrimSpace(label.ProjectID)
	label.RepoPath = strings.TrimSpace(label.RepoPath)
	label.ContentHash = strings.TrimSpace(label.ContentHash)
	label.Label = normalizeCalibrationLabel(label.Label)
	now := nowUTC()
	if label.CreatedAt == "" {
		label.CreatedAt = now
	}
	label.UpdatedAt = now

	err := s.db.QueryRow(`
		INSERT INTO embedding_calibration_labels (
			query, search_type, asset_id, project_id, repo_path, content_hash,
			label, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(query, search_type, asset_id) DO UPDATE SET
			project_id = excluded.project_id,
			repo_path = excluded.repo_path,
			content_hash = excluded.content_hash,
			label = excluded.label,
			updated_at = excluded.updated_at
		RETURNING id, created_at, updated_at
	`, label.Query, label.SearchType, label.AssetID, label.ProjectID, label.RepoPath,
		label.ContentHash, label.Label, label.CreatedAt, label.UpdatedAt).Scan(&label.ID, &label.CreatedAt, &label.UpdatedAt)
	if err != nil {
		return EmbeddingCalibrationLabel{}, err
	}
	return label, nil
}

func (s *Store) DeleteEmbeddingCalibrationLabel(id int64) error {
	_, err := s.db.Exec(`DELETE FROM embedding_calibration_labels WHERE id = ?`, id)
	return err
}

func (s *Store) EmbeddingCalibrationLabels() ([]EmbeddingCalibrationLabel, error) {
	return s.embeddingCalibrationLabelsWhere("", nil)
}

func (s *Store) EmbeddingCalibrationLabelsFor(query, searchType string) ([]EmbeddingCalibrationLabel, error) {
	query = strings.TrimSpace(query)
	searchType = normalizeCalibrationSearchType(searchType)
	return s.embeddingCalibrationLabelsWhere(`WHERE query = ? AND search_type = ?`, []any{query, searchType})
}

func (s *Store) embeddingCalibrationLabelsWhere(where string, args []any) ([]EmbeddingCalibrationLabel, error) {
	rows, err := s.rdb.Query(`
		SELECT id, query, search_type, asset_id, project_id, repo_path, content_hash,
		       label, created_at, updated_at
		FROM embedding_calibration_labels
		`+where+`
		ORDER BY updated_at DESC, id DESC
	`, args...)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()

	var labels []EmbeddingCalibrationLabel
	for rows.Next() {
		var label EmbeddingCalibrationLabel
		if err := rows.Scan(&label.ID, &label.Query, &label.SearchType, &label.AssetID,
			&label.ProjectID, &label.RepoPath, &label.ContentHash, &label.Label,
			&label.CreatedAt, &label.UpdatedAt); err != nil {
			return nil, err
		}
		labels = append(labels, label)
	}
	return labels, rows.Err()
}

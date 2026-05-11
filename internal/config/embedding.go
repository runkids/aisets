package config

import (
	"database/sql"

	"aisets/internal/embedding"
)

type EmbeddingResult struct {
	ID            int64
	AssetID       string
	ProjectID     string
	RepoPath      string
	ContentHash   string
	HashAlgorithm string
	EmbedType     string // "text" or "image"
	ProviderName  string
	ModelName     string
	Dimensions    int
	Status        string
	ErrorCode     string
	ErrorMessage  string
	DurationMs    int64
	CreatedAt     string
}

type EmbeddingWithVector struct {
	EmbeddingResult
	Vector []float32
}

func (s *Store) UpsertEmbedding(r EmbeddingResult, vector []float32) error {
	if r.CreatedAt == "" {
		r.CreatedAt = nowUTC()
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var id int64
	err = tx.QueryRow(`
		INSERT INTO embeddings (
			asset_id, project_id, repo_path, content_hash, hash_algorithm,
			embed_type, provider_name, model_name, dimensions,
			status, error_code, error_message, duration_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm,
		            embed_type, provider_name, model_name)
		DO UPDATE SET
			asset_id      = excluded.asset_id,
			status        = excluded.status,
			dimensions    = excluded.dimensions,
			error_code    = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms   = excluded.duration_ms,
			created_at    = excluded.created_at
		RETURNING id
	`, r.AssetID, r.ProjectID, r.RepoPath, r.ContentHash, r.HashAlgorithm,
		r.EmbedType, r.ProviderName, r.ModelName, r.Dimensions,
		r.Status, r.ErrorCode, r.ErrorMessage, r.DurationMs, r.CreatedAt,
	).Scan(&id)
	if err != nil {
		return err
	}

	if r.Status == "ready" && vector != nil {
		blob := embedding.SerializeVector(vector)
		_, err = tx.Exec(`
			INSERT INTO embedding_vectors (embedding_id, vector)
			VALUES (?, ?)
			ON CONFLICT(embedding_id) DO UPDATE SET vector = excluded.vector
		`, id, blob)
		if err != nil {
			return err
		}
	}

	err = tx.Commit()
	return err
}

func (s *Store) HasReadyEmbedding(projectID, repoPath, contentHash, hashAlgorithm, embedType, providerName, modelName string) (bool, error) {
	var exists int
	err := s.rdb.QueryRow(`
		SELECT 1 FROM embeddings
		WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
		  AND embed_type = ? AND provider_name = ? AND model_name = ? AND status = 'ready'
		LIMIT 1
	`, projectID, repoPath, contentHash, hashAlgorithm, embedType, providerName, modelName).Scan(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) AllReadyEmbeddings(embedType string) ([]EmbeddingWithVector, error) {
	var count int
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM embeddings WHERE embed_type = ? AND status = 'ready'`, embedType).Scan(&count); err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}

	rows, err := s.rdb.Query(`
		SELECT e.id, e.asset_id, e.project_id, e.repo_path, e.content_hash, v.vector
		FROM embeddings e
		JOIN embedding_vectors v ON v.embedding_id = e.id
		WHERE e.embed_type = ? AND e.status = 'ready'
	`, embedType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]EmbeddingWithVector, 0, count)
	for rows.Next() {
		var r EmbeddingWithVector
		var blob []byte
		if err := rows.Scan(&r.ID, &r.AssetID, &r.ProjectID, &r.RepoPath, &r.ContentHash, &blob); err != nil {
			return nil, err
		}
		r.EmbedType = embedType
		r.Status = "ready"
		r.Vector = embedding.DeserializeVector(blob)
		results = append(results, r)
	}
	return results, rows.Err()
}

func (s *Store) EmbeddingForAsset(assetID, embedType string) (*EmbeddingWithVector, error) {
	var r EmbeddingWithVector
	var blob []byte
	err := s.rdb.QueryRow(`
		SELECT e.id, e.asset_id, e.project_id, e.repo_path, e.content_hash, e.hash_algorithm,
		       e.embed_type, e.provider_name, e.model_name, e.dimensions, e.status,
		       e.duration_ms, e.created_at, v.vector
		FROM embeddings e
		JOIN embedding_vectors v ON v.embedding_id = e.id
		WHERE e.asset_id = ? AND e.embed_type = ? AND e.status = 'ready'
		ORDER BY e.created_at DESC LIMIT 1
	`, assetID, embedType).Scan(
		&r.ID, &r.AssetID, &r.ProjectID, &r.RepoPath, &r.ContentHash, &r.HashAlgorithm,
		&r.EmbedType, &r.ProviderName, &r.ModelName, &r.Dimensions, &r.Status,
		&r.DurationMs, &r.CreatedAt, &blob,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Vector = embedding.DeserializeVector(blob)
	return &r, nil
}

func (s *Store) RemoveEmbeddings() error {
	_, err := s.db.Exec(`DELETE FROM embeddings`)
	return err
}

func (s *Store) EmbeddingReadyCounts() (textCount, imageCount int, err error) {
	rows, err := s.rdb.Query(`
		SELECT embed_type, COUNT(*) FROM embeddings
		WHERE status = 'ready'
		GROUP BY embed_type
	`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var embedType string
		var count int
		if err := rows.Scan(&embedType, &count); err != nil {
			return 0, 0, err
		}
		switch embedType {
		case "text":
			textCount = count
		case "image":
			imageCount = count
		}
	}
	return textCount, imageCount, rows.Err()
}

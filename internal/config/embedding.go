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
	InputHash     string
	SourceHash    string
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
			asset_id, project_id, repo_path, content_hash, hash_algorithm, input_hash, source_hash,
			embed_type, provider_name, model_name, dimensions,
			status, error_code, error_message, duration_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm,
		            embed_type, provider_name, model_name)
		DO UPDATE SET
			asset_id      = excluded.asset_id,
			input_hash    = excluded.input_hash,
			source_hash   = excluded.source_hash,
			status        = excluded.status,
			dimensions    = excluded.dimensions,
			error_code    = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms   = excluded.duration_ms,
			created_at    = excluded.created_at
		RETURNING id
	`, r.AssetID, r.ProjectID, r.RepoPath, r.ContentHash, r.HashAlgorithm,
		r.InputHash, r.SourceHash,
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

func (s *Store) HasReadyEmbedding(projectID, repoPath, contentHash, hashAlgorithm, embedType, providerName, modelName, inputHash string) (bool, error) {
	var exists int
	query := `
		SELECT 1 FROM embeddings
		WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
		  AND embed_type = ? AND provider_name = ? AND model_name = ? AND status = 'ready'
	`
	args := []any{projectID, repoPath, contentHash, hashAlgorithm, embedType, providerName, modelName}
	if inputHash != "" {
		query += ` AND input_hash = ?`
		args = append(args, inputHash)
	}
	query += ` LIMIT 1`
	err := s.rdb.QueryRow(query, args...).Scan(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) AllReadyEmbeddings(embedType string) ([]EmbeddingWithVector, error) {
	return s.ReadyEmbeddings(EmbeddingQuery{EmbedType: embedType})
}

type EmbeddingQuery struct {
	EmbedType    string
	ProviderName string
	ModelName    string
	Dimensions   int
	ProjectIDs   []string
}

func (s *Store) ReadyEmbeddings(q EmbeddingQuery) ([]EmbeddingWithVector, error) {
	where := `e.embed_type = ? AND e.status = 'ready'`
	args := []any{q.EmbedType}
	if q.ProviderName != "" {
		where += ` AND e.provider_name = ?`
		args = append(args, q.ProviderName)
	}
	if q.ModelName != "" {
		where += ` AND e.model_name = ?`
		args = append(args, q.ModelName)
	}
	if q.Dimensions > 0 {
		where += ` AND e.dimensions = ?`
		args = append(args, q.Dimensions)
	}
	if q.ProjectIDs != nil {
		if len(q.ProjectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("e.project_id", q.ProjectIDs)
		where += ` AND ` + projectClause
		args = append(args, projectArgs...)
	}

	var count int
	countArgs := append([]any{}, args...)
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM embeddings e WHERE `+where, countArgs...).Scan(&count); err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}

	rows, err := s.rdb.Query(`
		SELECT e.id, e.asset_id, e.project_id, e.repo_path, e.content_hash, e.hash_algorithm,
		       e.input_hash, e.source_hash, e.embed_type, e.provider_name, e.model_name,
		       e.dimensions, e.duration_ms, e.created_at, v.vector
		FROM embeddings e
		JOIN embedding_vectors v ON v.embedding_id = e.id
		WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]EmbeddingWithVector, 0, count)
	for rows.Next() {
		var r EmbeddingWithVector
		var blob []byte
		if err := rows.Scan(
			&r.ID, &r.AssetID, &r.ProjectID, &r.RepoPath, &r.ContentHash, &r.HashAlgorithm,
			&r.InputHash, &r.SourceHash, &r.EmbedType, &r.ProviderName, &r.ModelName,
			&r.Dimensions, &r.DurationMs, &r.CreatedAt, &blob,
		); err != nil {
			return nil, err
		}
		r.Status = "ready"
		r.Vector = embedding.DeserializeVector(blob)
		results = append(results, r)
	}
	return results, rows.Err()
}

func (s *Store) EmbeddingForAsset(assetID, embedType string) (*EmbeddingWithVector, error) {
	return s.EmbeddingForAssetScoped(assetID, embedType, "", "")
}

func (s *Store) EmbeddingForAssetScoped(assetID, embedType, providerName, modelName string) (*EmbeddingWithVector, error) {
	return s.EmbeddingForAssetScopedInProjects(assetID, embedType, providerName, modelName, nil)
}

func (s *Store) EmbeddingForAssetScopedInProjects(assetID, embedType, providerName, modelName string, projectIDs []string) (*EmbeddingWithVector, error) {
	var r EmbeddingWithVector
	var blob []byte
	where := `e.asset_id = ? AND e.embed_type = ? AND e.status = 'ready'`
	args := []any{assetID, embedType}
	if providerName != "" {
		where += ` AND e.provider_name = ?`
		args = append(args, providerName)
	}
	if modelName != "" {
		where += ` AND e.model_name = ?`
		args = append(args, modelName)
	}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("e.project_id", projectIDs)
		where += ` AND ` + projectClause
		args = append(args, projectArgs...)
	}
	err := s.rdb.QueryRow(`
		SELECT e.id, e.asset_id, e.project_id, e.repo_path, e.content_hash, e.hash_algorithm,
		       e.input_hash, e.source_hash, e.embed_type, e.provider_name, e.model_name, e.dimensions, e.status,
		       e.duration_ms, e.created_at, v.vector
		FROM embeddings e
		JOIN embedding_vectors v ON v.embedding_id = e.id
		WHERE `+where+`
		ORDER BY e.created_at DESC LIMIT 1
	`, args...).Scan(
		&r.ID, &r.AssetID, &r.ProjectID, &r.RepoPath, &r.ContentHash, &r.HashAlgorithm,
		&r.InputHash, &r.SourceHash, &r.EmbedType, &r.ProviderName, &r.ModelName, &r.Dimensions, &r.Status,
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
	return s.EmbeddingReadyCountsForModel("", "")
}

func (s *Store) EmbeddingReadyCountsForModel(providerName, modelName string) (textCount, imageCount int, err error) {
	return s.EmbeddingReadyCountsForModelInProjects(providerName, modelName, nil)
}

func (s *Store) EmbeddingReadyCountsForModelInProjects(providerName, modelName string, projectIDs []string) (textCount, imageCount int, err error) {
	where := `status = 'ready'`
	args := []any{}
	if providerName != "" {
		where += ` AND provider_name = ?`
		args = append(args, providerName)
	}
	if modelName != "" {
		where += ` AND model_name = ?`
		args = append(args, modelName)
	}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return 0, 0, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where += ` AND ` + projectClause
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(`
		SELECT embed_type, COUNT(*) FROM embeddings
		WHERE `+where+`
		GROUP BY embed_type
	`, args...)
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

func (s *Store) EmbeddingReadyDimensions() (int, error) {
	return s.EmbeddingReadyDimensionsForModel("", "")
}

func (s *Store) EmbeddingReadyDimensionsForModel(providerName, modelName string) (int, error) {
	return s.EmbeddingReadyDimensionsForModelInProjects(providerName, modelName, nil)
}

func (s *Store) EmbeddingReadyDimensionsForModelInProjects(providerName, modelName string, projectIDs []string) (int, error) {
	where := `status = 'ready'`
	args := []any{}
	if providerName != "" {
		where += ` AND provider_name = ?`
		args = append(args, providerName)
	}
	if modelName != "" {
		where += ` AND model_name = ?`
		args = append(args, modelName)
	}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return 0, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where += ` AND ` + projectClause
		args = append(args, projectArgs...)
	}
	var dimensions int
	err := s.rdb.QueryRow(`
		SELECT COALESCE(MAX(dimensions), 0)
		FROM embeddings
		WHERE `+where, args...).Scan(&dimensions)
	if err != nil {
		return 0, err
	}
	return dimensions, nil
}

func (s *Store) DeleteTextEmbeddingsForSources(sources []EmbeddingSource) (int, error) {
	if len(sources) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	deleted := 0
	for _, source := range sources {
		res, err := tx.Exec(`
			DELETE FROM embeddings
			WHERE embed_type = 'text' AND content_hash = ? AND hash_algorithm = ?
		`, source.ContentHash, source.HashAlgorithm)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		deleted += int(n)
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, nil
}

func (s *Store) CountTextEmbeddingsForSources(sources []EmbeddingSource) (int, error) {
	if len(sources) == 0 {
		return 0, nil
	}
	total := 0
	for _, source := range sources {
		var count int
		if err := s.rdb.QueryRow(`
			SELECT COUNT(*) FROM embeddings
			WHERE embed_type = 'text' AND content_hash = ? AND hash_algorithm = ?
		`, source.ContentHash, source.HashAlgorithm).Scan(&count); err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

type EmbeddingSource struct {
	ContentHash   string
	HashAlgorithm string
}

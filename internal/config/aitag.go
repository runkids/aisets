package config

import (
	"database/sql"
	"encoding/json"

	"aisets/internal/aitag"
	"aisets/internal/scanner"
)

func aiTagKey(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

// UpsertAITagResult inserts or updates an AI tag result.
func (s *Store) UpsertAITagResult(result aitag.Result) error {
	if result.UpdatedAt == "" {
		result.UpdatedAt = nowUTC()
	}
	tagsJSON, err := json.Marshal(result.Tags)
	if err != nil {
		return err
	}
	langsJSON, _ := json.Marshal(result.Languages)
	if string(langsJSON) == "null" {
		langsJSON = []byte("[]")
	}
	tagsI18nJSON, _ := json.Marshal(result.TagsI18n)
	if string(tagsI18nJSON) == "null" {
		tagsI18nJSON = []byte("{}")
	}
	descI18nJSON, _ := json.Marshal(result.DescriptionI18n)
	if string(descI18nJSON) == "null" {
		descI18nJSON = []byte("{}")
	}
	catI18nJSON, _ := json.Marshal(result.CategoryI18n)
	if string(catI18nJSON) == "null" {
		catI18nJSON = []byte("{}")
	}
	containsFace := 0
	if result.ContainsFace {
		containsFace = 1
	}
	_, err = s.db.Exec(`
		INSERT INTO ai_tags (
			project_id, repo_path, content_hash, hash_algorithm,
			provider_name, model_name, status,
			category, category_i18n_json, tags_json, tags_i18n_json, description, description_i18n_json, languages_json,
			contains_face, scene_type, estimated_location, location_confidence,
			error_code, error_message, duration_ms, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm, provider_name, model_name)
		DO UPDATE SET
			status = excluded.status,
			category = excluded.category,
			category_i18n_json = excluded.category_i18n_json,
			tags_json = excluded.tags_json,
			tags_i18n_json = excluded.tags_i18n_json,
			description = excluded.description,
			description_i18n_json = excluded.description_i18n_json,
			languages_json = excluded.languages_json,
			contains_face = excluded.contains_face,
			scene_type = excluded.scene_type,
			estimated_location = excluded.estimated_location,
			location_confidence = excluded.location_confidence,
			error_code = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms = excluded.duration_ms,
			updated_at = excluded.updated_at
	`, result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
		result.ProviderName, result.ModelName, result.Status,
		result.Category, string(catI18nJSON), string(tagsJSON), string(tagsI18nJSON), result.Description, string(descI18nJSON), string(langsJSON),
		containsFace, result.SceneType, result.EstimatedLocation, result.LocationConfidence,
		result.ErrorCode, result.ErrorMessage, result.DurationMs, result.UpdatedAt)
	return err
}

// AITagResults loads AI tag results for the given items, keyed by project_id + repo_path.
func (s *Store) AITagResults(items []scanner.AssetItem, providerName, modelName string) (map[string]aitag.Result, error) {
	out := map[string]aitag.Result{}
	if len(items) == 0 {
		return out, nil
	}
	hashes := contentHashes(items)
	if len(hashes) == 0 {
		return out, nil
	}
	hashClause, hashArgs := inClauseSQL("content_hash", hashes)
	args := []any{providerName, modelName}
	args = append(args, hashArgs...)
	rows, err := s.rdb.Query(`
		SELECT project_id, repo_path, content_hash, hash_algorithm,
			status, category, tags_json, COALESCE(tags_i18n_json, '{}'),
			description, COALESCE(description_i18n_json, '{}'), COALESCE(languages_json, '[]'),
			contains_face, scene_type, estimated_location, location_confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at
		FROM ai_tags
		WHERE provider_name = ? AND model_name = ?
			AND `+hashClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var result aitag.Result
		var tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
		var containsFaceInt int
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Category, &tagsRaw, &tagsI18nRaw,
			&result.Description, &descI18nRaw, &langsRaw,
			&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
			&result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt); err != nil {
			return nil, err
		}
		result.ProviderName = providerName
		result.ModelName = modelName
		result.ContainsFace = containsFaceInt != 0
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		_ = json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n)
		_ = json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n)
		_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
		out[aiTagKey(result.ProjectID, result.RepoPath)] = result
	}
	return out, rows.Err()
}

// AITagResultsBestMatch loads AI tag results preferring the given provider/model,
// falling back to any model with a ready result.
func (s *Store) AITagResultsBestMatch(items []scanner.AssetItem, providerName, modelName string) (map[string]aitag.Result, error) {
	out := map[string]aitag.Result{}
	if len(items) == 0 {
		return out, nil
	}
	hashes := contentHashes(items)
	if len(hashes) == 0 {
		return out, nil
	}
	hashClause, hashArgs := inClauseSQL("content_hash", hashes)
	args := []any{providerName, modelName}
	args = append(args, hashArgs...)
	args = append(args, aitag.StatusReady)
	rows, err := s.rdb.Query(`
		WITH ranked AS (
			SELECT project_id, repo_path, content_hash, hash_algorithm,
				status, category, tags_json, COALESCE(tags_i18n_json, '{}') AS tags_i18n_json,
				description, COALESCE(description_i18n_json, '{}') AS desc_i18n_json,
				COALESCE(languages_json, '[]') AS languages_json,
				contains_face, scene_type, estimated_location, location_confidence,
				COALESCE(error_code, '') AS error_code, COALESCE(error_message, '') AS error_message,
				duration_ms, updated_at, provider_name, model_name,
				ROW_NUMBER() OVER (
					PARTITION BY project_id, repo_path
					ORDER BY CASE WHEN provider_name = ? AND model_name = ? THEN 0 ELSE 1 END,
							 updated_at DESC
				) AS rn
			FROM ai_tags
			WHERE `+hashClause+` AND status = ?
		)
		SELECT project_id, repo_path, content_hash, hash_algorithm,
			status, category, tags_json, tags_i18n_json,
			description, desc_i18n_json, languages_json,
			contains_face, scene_type, estimated_location, location_confidence,
			error_code, error_message, duration_ms, updated_at,
			provider_name, model_name
		FROM ranked WHERE rn = 1
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var result aitag.Result
		var tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
		var containsFaceInt int
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Category, &tagsRaw, &tagsI18nRaw,
			&result.Description, &descI18nRaw, &langsRaw,
			&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
			&result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt,
			&result.ProviderName, &result.ModelName); err != nil {
			return nil, err
		}
		result.ContainsFace = containsFaceInt != 0
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		_ = json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n)
		_ = json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n)
		_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
		out[aiTagKey(result.ProjectID, result.RepoPath)] = result
	}
	return out, rows.Err()
}

func (s *Store) RemoveAITagResults() error {
	_, err := s.db.Exec(`DELETE FROM ai_tags`)
	return err
}

// AITagResultForContentHash finds an existing ready AI tag for the same content hash,
// used for deduplication (same image content across different paths).
func (s *Store) AITagResultForContentHash(contentHash, hashAlgorithm, providerName, modelName string) (aitag.Result, bool, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return aitag.Result{}, false, nil
	}
	row := s.rdb.QueryRow(`
		SELECT project_id, repo_path, status, category, tags_json, COALESCE(tags_i18n_json, '{}'),
			description, COALESCE(description_i18n_json, '{}'), COALESCE(languages_json, '[]'),
			contains_face, scene_type, estimated_location, location_confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at
		FROM ai_tags
		WHERE content_hash = ? AND hash_algorithm = ?
			AND provider_name = ? AND model_name = ?
			AND status = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, contentHash, hashAlgorithm, providerName, modelName, aitag.StatusReady)
	result := aitag.Result{
		ContentHash:   contentHash,
		HashAlgorithm: hashAlgorithm,
		ProviderName:  providerName,
		ModelName:     modelName,
	}
	var tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
	var containsFaceInt int
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status,
		&result.Category, &tagsRaw, &tagsI18nRaw, &result.Description, &descI18nRaw, &langsRaw,
		&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
		&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return aitag.Result{}, false, nil
	}
	if err != nil {
		return aitag.Result{}, false, err
	}
	result.ContainsFace = containsFaceInt != 0
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	_ = json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n)
	_ = json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n)
	_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
	return result, true, nil
}

func (s *Store) AITagResultAny(contentHash, hashAlgorithm string) (*aitag.Result, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return nil, nil
	}
	row := s.rdb.QueryRow(`
		SELECT category, tags_json, description
		FROM ai_tags
		WHERE content_hash = ? AND hash_algorithm = ? AND status = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, contentHash, hashAlgorithm, aitag.StatusReady)
	var result aitag.Result
	var tagsRaw string
	err := row.Scan(&result.Category, &tagsRaw, &result.Description)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	return &result, nil
}

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
	_, err = s.db.Exec(`
		INSERT INTO ai_tags (
			project_id, repo_path, content_hash, hash_algorithm,
			provider_name, model_name, status,
			category, tags_json, description, languages_json,
			error_code, error_message, duration_ms, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm, provider_name, model_name)
		DO UPDATE SET
			status = excluded.status,
			category = excluded.category,
			tags_json = excluded.tags_json,
			description = excluded.description,
			languages_json = excluded.languages_json,
			error_code = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms = excluded.duration_ms,
			updated_at = excluded.updated_at
	`, result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
		result.ProviderName, result.ModelName, result.Status,
		result.Category, string(tagsJSON), result.Description, string(langsJSON),
		result.ErrorCode, result.ErrorMessage, result.DurationMs, result.UpdatedAt)
	return err
}

// AITagResults loads AI tag results for the given items, keyed by project_id + repo_path.
func (s *Store) AITagResults(items []scanner.AssetItem, providerName, modelName string) (map[string]aitag.Result, error) {
	out := map[string]aitag.Result{}
	if len(items) == 0 {
		return out, nil
	}
	for _, item := range items {
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			continue
		}
		row := s.rdb.QueryRow(`
			SELECT status, category, tags_json, description, COALESCE(languages_json, '[]'),
				COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at
			FROM ai_tags
			WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
				AND provider_name = ? AND model_name = ?
		`, item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm,
			providerName, modelName)
		result := aitag.Result{
			ProjectID:     item.ProjectID,
			RepoPath:      item.RepoPath,
			ContentHash:   item.ContentHash,
			HashAlgorithm: item.HashAlgorithm,
			ProviderName:  providerName,
			ModelName:     modelName,
		}
		var tagsRaw, langsRaw string
		err := row.Scan(&result.Status, &result.Category, &tagsRaw,
			&result.Description, &langsRaw, &result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
		out[aiTagKey(item.ProjectID, item.RepoPath)] = result
	}
	return out, nil
}

// AITagResultsBestMatch loads AI tag results preferring the given provider/model,
// falling back to any model with a ready result.
func (s *Store) AITagResultsBestMatch(items []scanner.AssetItem, providerName, modelName string) (map[string]aitag.Result, error) {
	out := map[string]aitag.Result{}
	if len(items) == 0 {
		return out, nil
	}
	for _, item := range items {
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			continue
		}
		row := s.rdb.QueryRow(`
			SELECT status, category, tags_json, description, COALESCE(languages_json, '[]'),
				COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at,
				provider_name, model_name
			FROM ai_tags
			WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
				AND status = ?
			ORDER BY
				CASE WHEN provider_name = ? AND model_name = ? THEN 0 ELSE 1 END,
				updated_at DESC
			LIMIT 1
		`, item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm,
			aitag.StatusReady, providerName, modelName)
		result := aitag.Result{
			ProjectID:     item.ProjectID,
			RepoPath:      item.RepoPath,
			ContentHash:   item.ContentHash,
			HashAlgorithm: item.HashAlgorithm,
		}
		var tagsRaw, langsRaw string
		err := row.Scan(&result.Status, &result.Category, &tagsRaw,
			&result.Description, &langsRaw, &result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt, &result.ProviderName, &result.ModelName)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
		out[aiTagKey(item.ProjectID, item.RepoPath)] = result
	}
	return out, nil
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
		SELECT project_id, repo_path, status, category, tags_json, description,
			COALESCE(languages_json, '[]'),
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
	var tagsRaw, langsRaw string
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status,
		&result.Category, &tagsRaw, &result.Description, &langsRaw,
		&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return aitag.Result{}, false, nil
	}
	if err != nil {
		return aitag.Result{}, false, err
	}
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
	return result, true, nil
}

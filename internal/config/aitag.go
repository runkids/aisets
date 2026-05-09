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
	_, err = s.db.Exec(`
		INSERT INTO ai_tags (
			project_id, repo_path, content_hash, hash_algorithm,
			provider_name, model_name, prompt_version, status,
			category, tags_json, description,
			error_code, error_message, duration_ms, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm, provider_name, model_name, prompt_version)
		DO UPDATE SET
			status = excluded.status,
			category = excluded.category,
			tags_json = excluded.tags_json,
			description = excluded.description,
			error_code = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms = excluded.duration_ms,
			updated_at = excluded.updated_at
	`, result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
		result.ProviderName, result.ModelName, aitag.PromptVersion, result.Status,
		result.Category, string(tagsJSON), result.Description,
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
		row := s.db.QueryRow(`
			SELECT status, category, tags_json, description,
				COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at
			FROM ai_tags
			WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
				AND provider_name = ? AND model_name = ? AND prompt_version = ?
		`, item.ProjectID, item.RepoPath, item.ContentHash, item.HashAlgorithm,
			providerName, modelName, aitag.PromptVersion)
		result := aitag.Result{
			ProjectID:     item.ProjectID,
			RepoPath:      item.RepoPath,
			ContentHash:   item.ContentHash,
			HashAlgorithm: item.HashAlgorithm,
			ProviderName:  providerName,
			ModelName:     modelName,
		}
		var tagsRaw string
		err := row.Scan(&result.Status, &result.Category, &tagsRaw,
			&result.Description, &result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		out[aiTagKey(item.ProjectID, item.RepoPath)] = result
	}
	return out, nil
}

// AITagResultForContentHash finds an existing ready AI tag for the same content hash,
// used for deduplication (same image content across different paths).
func (s *Store) AITagResultForContentHash(contentHash, hashAlgorithm, providerName, modelName string) (aitag.Result, bool, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return aitag.Result{}, false, nil
	}
	row := s.db.QueryRow(`
		SELECT project_id, repo_path, status, category, tags_json, description,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, updated_at
		FROM ai_tags
		WHERE content_hash = ? AND hash_algorithm = ?
			AND provider_name = ? AND model_name = ? AND prompt_version = ?
			AND status = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, contentHash, hashAlgorithm, providerName, modelName, aitag.PromptVersion, aitag.StatusReady)
	result := aitag.Result{
		ContentHash:   contentHash,
		HashAlgorithm: hashAlgorithm,
		ProviderName:  providerName,
		ModelName:     modelName,
	}
	var tagsRaw string
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status,
		&result.Category, &tagsRaw, &result.Description,
		&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return aitag.Result{}, false, nil
	}
	if err != nil {
		return aitag.Result{}, false, err
	}
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	return result, true, nil
}

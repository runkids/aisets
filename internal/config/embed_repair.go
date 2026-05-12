package config

import (
	"encoding/json"

	"aisets/internal/aitag"
)

type EmbedRepairReport struct {
	InvalidAITags              int `json:"invalidAiTags"`
	ClearedI18nEntries         int `json:"clearedI18nEntries"`
	DeletedStaleTextEmbeddings int `json:"deletedStaleTextEmbeddings"`
	SkippedRows                int `json:"skippedRows"`
}

func (s *Store) RepairEmbeddingInputs(apply bool) (EmbedRepairReport, error) {
	rows, err := s.rdb.Query(`
		SELECT project_id, repo_path, content_hash, hash_algorithm, provider_name, model_name,
		       category, tags_json, description,
		       COALESCE(category_i18n_json, '{}'),
		       COALESCE(tags_i18n_json, '{}'),
		       COALESCE(description_i18n_json, '{}')
		FROM ai_tags
		WHERE status = ?
	`, aitag.StatusReady)
	if err != nil {
		return EmbedRepairReport{}, err
	}
	defer rows.Close()

	report := EmbedRepairReport{}
	affected := map[string]EmbeddingSource{}
	var updates []aitag.Result
	var invalid []aitag.Result

	for rows.Next() {
		var result aitag.Result
		var tagsRaw, catI18nRaw, tagsI18nRaw, descI18nRaw string
		if err := rows.Scan(
			&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.ProviderName, &result.ModelName,
			&result.Category, &tagsRaw, &result.Description,
			&catI18nRaw, &tagsI18nRaw, &descI18nRaw,
		); err != nil {
			return EmbedRepairReport{}, err
		}
		result.Status = aitag.StatusReady
		result.CategoryI18n = map[string]string{}
		result.TagsI18n = map[string][]string{}
		result.DescriptionI18n = map[string]string{}
		if json.Unmarshal([]byte(tagsRaw), &result.Tags) != nil ||
			json.Unmarshal([]byte(catI18nRaw), &result.CategoryI18n) != nil ||
			json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n) != nil ||
			json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n) != nil {
			report.SkippedRows++
			continue
		}

		source := EmbeddingSource{ContentHash: result.ContentHash, HashAlgorithm: result.HashAlgorithm}
		if !aitag.IsResultUsable(result) {
			report.InvalidAITags++
			invalid = append(invalid, result)
			affected[embeddingSourceKey(source)] = source
			continue
		}

		cleaned, removed := aitag.CleanInvalidI18n(result)
		if removed == 0 {
			continue
		}
		report.ClearedI18nEntries += removed
		updates = append(updates, cleaned)
		affected[embeddingSourceKey(source)] = source
	}
	if err := rows.Err(); err != nil {
		return EmbedRepairReport{}, err
	}

	sources := make([]EmbeddingSource, 0, len(affected))
	for _, source := range affected {
		sources = append(sources, source)
	}

	if apply {
		if err := s.applyEmbedRepair(invalid, updates); err != nil {
			return EmbedRepairReport{}, err
		}
		deleted, err := s.DeleteTextEmbeddingsForSources(sources)
		if err != nil {
			return EmbedRepairReport{}, err
		}
		report.DeletedStaleTextEmbeddings = deleted
		return report, nil
	}

	count, err := s.CountTextEmbeddingsForSources(sources)
	if err != nil {
		return EmbedRepairReport{}, err
	}
	report.DeletedStaleTextEmbeddings = count
	return report, nil
}

func (s *Store) applyEmbedRepair(invalid []aitag.Result, updates []aitag.Result) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	for _, result := range invalid {
		_, err = tx.Exec(`
			UPDATE ai_tags
			SET status = ?, error_code = ?, error_message = ?, updated_at = ?
			WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
			  AND provider_name = ? AND model_name = ?
		`, aitag.StatusFailed, "aitag_invalid_result", "AI tag result is missing category, tags, or description", nowUTC(),
			result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
			result.ProviderName, result.ModelName)
		if err != nil {
			return err
		}
	}

	for _, result := range updates {
		catI18nJSON, _ := json.Marshal(result.CategoryI18n)
		tagsI18nJSON, _ := json.Marshal(result.TagsI18n)
		descI18nJSON, _ := json.Marshal(result.DescriptionI18n)
		_, err = tx.Exec(`
			UPDATE ai_tags
			SET category_i18n_json = ?, tags_i18n_json = ?, description_i18n_json = ?, updated_at = ?
			WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ?
			  AND provider_name = ? AND model_name = ?
		`, string(catI18nJSON), string(tagsI18nJSON), string(descI18nJSON), nowUTC(),
			result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
			result.ProviderName, result.ModelName)
		if err != nil {
			return err
		}
	}

	err = tx.Commit()
	return err
}

func embeddingSourceKey(source EmbeddingSource) string {
	return source.HashAlgorithm + "\x00" + source.ContentHash
}

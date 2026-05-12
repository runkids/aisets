package config

import (
	"database/sql"
	"encoding/json"
	"strings"

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
			status, category, COALESCE(category_i18n_json, '{}'), tags_json, COALESCE(tags_i18n_json, '{}'),
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
		var catI18nRaw, tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
		var containsFaceInt int
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Category, &catI18nRaw, &tagsRaw, &tagsI18nRaw,
			&result.Description, &descI18nRaw, &langsRaw,
			&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
			&result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt); err != nil {
			return nil, err
		}
		result.ProviderName = providerName
		result.ModelName = modelName
		result.ContainsFace = containsFaceInt != 0
		_ = json.Unmarshal([]byte(catI18nRaw), &result.CategoryI18n)
		_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
		_ = json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n)
		_ = json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n)
		_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
		if result.Status == aitag.StatusReady && !aitag.IsResultUsable(result) {
			continue
		}
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
				status, category, COALESCE(category_i18n_json, '{}') AS category_i18n_json, tags_json, COALESCE(tags_i18n_json, '{}') AS tags_i18n_json,
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
			status, category, category_i18n_json, tags_json, tags_i18n_json,
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
		var catI18nRaw, tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
		var containsFaceInt int
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Category, &catI18nRaw, &tagsRaw, &tagsI18nRaw,
			&result.Description, &descI18nRaw, &langsRaw,
			&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
			&result.ErrorCode, &result.ErrorMessage,
			&result.DurationMs, &result.UpdatedAt,
			&result.ProviderName, &result.ModelName); err != nil {
			return nil, err
		}
		result.ContainsFace = containsFaceInt != 0
		_ = json.Unmarshal([]byte(catI18nRaw), &result.CategoryI18n)
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
		SELECT project_id, repo_path, status, category, COALESCE(category_i18n_json, '{}'), tags_json, COALESCE(tags_i18n_json, '{}'),
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
	var catI18nRaw, tagsRaw, tagsI18nRaw, descI18nRaw, langsRaw string
	var containsFaceInt int
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status,
		&result.Category, &catI18nRaw, &tagsRaw, &tagsI18nRaw, &result.Description, &descI18nRaw, &langsRaw,
		&containsFaceInt, &result.SceneType, &result.EstimatedLocation, &result.LocationConfidence,
		&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return aitag.Result{}, false, nil
	}
	if err != nil {
		return aitag.Result{}, false, err
	}
	result.ContainsFace = containsFaceInt != 0
	_ = json.Unmarshal([]byte(catI18nRaw), &result.CategoryI18n)
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	_ = json.Unmarshal([]byte(tagsI18nRaw), &result.TagsI18n)
	_ = json.Unmarshal([]byte(descI18nRaw), &result.DescriptionI18n)
	_ = json.Unmarshal([]byte(langsRaw), &result.Languages)
	if !aitag.IsResultUsable(result) {
		return aitag.Result{}, false, nil
	}
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

// AITagResultAnyWithEnglish returns the AI tag result with English i18n fields preferred.
// If English i18n translations exist, category/tags/description are replaced with English versions.
func (s *Store) AITagResultAnyWithEnglish(contentHash, hashAlgorithm string) (*aitag.Result, error) {
	return s.AITagResultAnyWithEnglishForAsset("", "", contentHash, hashAlgorithm)
}

func (s *Store) AITagResultAnyWithEnglishForAsset(projectID, repoPath, contentHash, hashAlgorithm string) (*aitag.Result, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return nil, nil
	}
	where := `content_hash = ? AND hash_algorithm = ? AND status = ?`
	args := []any{contentHash, hashAlgorithm, aitag.StatusReady}
	if projectID != "" || repoPath != "" {
		where += ` AND project_id = ? AND repo_path = ?`
		args = append(args, projectID, repoPath)
	}
	row := s.rdb.QueryRow(`
		SELECT category, tags_json, description,
		       COALESCE(category_i18n_json, '{}'),
		       COALESCE(tags_i18n_json, '{}'),
		       COALESCE(description_i18n_json, '{}')
		FROM ai_tags
		WHERE `+where+`
		ORDER BY updated_at DESC
		LIMIT 1
	`, args...)
	var result aitag.Result
	var tagsRaw, catI18n, tagsI18n, descI18n string
	err := row.Scan(&result.Category, &tagsRaw, &result.Description,
		&catI18n, &tagsI18n, &descI18n)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result.Status = aitag.StatusReady
	_ = json.Unmarshal([]byte(tagsRaw), &result.Tags)
	if !aitag.IsResultUsable(result) {
		return nil, nil
	}

	result.CategoryI18n = map[string]string{}
	result.TagsI18n = map[string][]string{}
	result.DescriptionI18n = map[string]string{}
	_ = json.Unmarshal([]byte(catI18n), &result.CategoryI18n)
	_ = json.Unmarshal([]byte(tagsI18n), &result.TagsI18n)
	_ = json.Unmarshal([]byte(descI18n), &result.DescriptionI18n)
	result = aitag.ResultWithEnglishFallback(result)
	if !aitag.IsResultUsable(result) {
		return nil, nil
	}
	return &result, nil
}

// AITagI18nRow is a row from ai_tags missing English i18n.
type AITagI18nRow struct {
	ProjectID     string
	RepoPath      string
	ContentHash   string
	HashAlgorithm string
	Category      string
	Tags          []string
	Description   string
}

func (s *Store) AITagsMissingEnglish(contentHashes []string) ([]AITagI18nRow, error) {
	return s.AITagsMissingLocale("en", contentHashes)
}

var validI18nLocales = map[string]bool{"en": true, "zh-TW": true, "zh-CN": true, "ja": true, "ko": true}

func (s *Store) AITagsMissingLocale(locale string, contentHashes []string) ([]AITagI18nRow, error) {
	return s.AITagsMissingLocaleForProjects(locale, contentHashes, nil)
}

func (s *Store) AITagsMissingLocaleForProjects(locale string, contentHashes []string, projectIDs []string) ([]AITagI18nRow, error) {
	if !validI18nLocales[locale] {
		return nil, nil
	}
	jsonPath := `'$."` + locale + `"'`
	missingAny := `(json_extract(description_i18n_json, ` + jsonPath + `) IS NULL
			   OR json_extract(category_i18n_json, ` + jsonPath + `) IS NULL
			   OR json_extract(category_i18n_json, ` + jsonPath + `) = category
			   OR json_extract(tags_i18n_json, ` + jsonPath + `) IS NULL)`
	where := []string{"status = 'ready'", missingAny}
	var args []any
	if len(contentHashes) > 0 {
		hashClause, hashArgs := inClauseSQL("content_hash", contentHashes)
		where = append(where, hashClause)
		args = append(args, hashArgs...)
	}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	query := `SELECT project_id, repo_path, content_hash, hash_algorithm, category, tags_json, description,
			COALESCE(category_i18n_json, '{}'), COALESCE(tags_i18n_json, '{}'), COALESCE(description_i18n_json, '{}')
		FROM ai_tags
		WHERE ` + strings.Join(where, " AND ")
	rows, err := s.rdb.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []AITagI18nRow
	for rows.Next() {
		var r AITagI18nRow
		var tagsRaw, catI18n, tagsI18n, descI18n string
		if err := rows.Scan(&r.ProjectID, &r.RepoPath, &r.ContentHash, &r.HashAlgorithm, &r.Category, &tagsRaw, &r.Description, &catI18n, &tagsI18n, &descI18n); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tagsRaw), &r.Tags)
		raw := aitag.Result{
			Status:      aitag.StatusReady,
			Category:    r.Category,
			Tags:        r.Tags,
			Description: r.Description,
		}
		if !aitag.IsResultUsable(raw) {
			continue
		}
		if !aitagI18nLocaleMissing(raw, locale, catI18n, tagsI18n, descI18n) {
			continue
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func aitagI18nLocaleMissing(raw aitag.Result, locale, catI18n, tagsI18n, descI18n string) bool {
	catMap := map[string]string{}
	tagsMap := map[string][]string{}
	descMap := map[string]string{}
	_ = json.Unmarshal([]byte(catI18n), &catMap)
	_ = json.Unmarshal([]byte(tagsI18n), &tagsMap)
	_ = json.Unmarshal([]byte(descI18n), &descMap)
	category, hasCategory := catMap[locale]
	tags, hasTags := tagsMap[locale]
	description, hasDescription := descMap[locale]
	if !hasCategory || !hasTags || !hasDescription {
		return true
	}
	return !aitag.IsLocaleTranslationUsableForLocale(raw, locale, category, tags, description)
}

func joinStrings(ss []string, sep string) string {
	if len(ss) == 0 {
		return ""
	}
	out := ss[0]
	for _, s := range ss[1:] {
		out += sep + s
	}
	return out
}

func (s *Store) BackfillEnglishI18n(contentHash, hashAlgorithm, enCategory string, enTags []string, enDescription string) error {
	return s.BackfillLocaleI18n(contentHash, hashAlgorithm, "en", enCategory, enTags, enDescription)
}

func (s *Store) BackfillLocaleI18n(contentHash, hashAlgorithm, locale, category string, tags []string, description string) error {
	return s.BackfillLocaleI18nForAsset("", "", contentHash, hashAlgorithm, locale, category, tags, description)
}

func (s *Store) BackfillLocaleI18nForAsset(projectID, repoPath, contentHash, hashAlgorithm, locale, category string, tags []string, description string) error {
	_, err := s.BackfillLocaleI18nForAssetApplied(projectID, repoPath, contentHash, hashAlgorithm, locale, category, tags, description)
	return err
}

func (s *Store) BackfillLocaleI18nForAssetApplied(projectID, repoPath, contentHash, hashAlgorithm, locale, category string, tags []string, description string) (bool, error) {
	if !validI18nLocales[locale] {
		return false, nil
	}
	var raw aitag.Result
	var catI18n, tagsRaw, tagsI18n, descI18n string
	where := `content_hash = ? AND hash_algorithm = ? AND status = 'ready'`
	args := []any{contentHash, hashAlgorithm}
	if projectID != "" || repoPath != "" {
		where += ` AND project_id = ? AND repo_path = ?`
		args = append(args, projectID, repoPath)
	}
	err := s.rdb.QueryRow(`SELECT category, tags_json, description,
			COALESCE(category_i18n_json,'{}'), COALESCE(tags_i18n_json,'{}'), COALESCE(description_i18n_json,'{}')
		FROM ai_tags WHERE `+where+`
		ORDER BY updated_at DESC LIMIT 1`, args...).Scan(&raw.Category, &tagsRaw, &raw.Description, &catI18n, &tagsI18n, &descI18n)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	raw.Status = aitag.StatusReady
	_ = json.Unmarshal([]byte(tagsRaw), &raw.Tags)
	if !aitag.IsResultUsable(raw) || !aitag.IsLocaleTranslationUsableForLocale(raw, locale, category, tags, description) {
		return false, nil
	}

	catMap := map[string]string{}
	tagsMap := map[string][]string{}
	descMap := map[string]string{}
	_ = json.Unmarshal([]byte(catI18n), &catMap)
	_ = json.Unmarshal([]byte(tagsI18n), &tagsMap)
	_ = json.Unmarshal([]byte(descI18n), &descMap)
	if catMap == nil {
		catMap = map[string]string{}
	}
	if tagsMap == nil {
		tagsMap = map[string][]string{}
	}
	if descMap == nil {
		descMap = map[string]string{}
	}

	catMap[locale] = category
	if len(tags) > 0 {
		tagsMap[locale] = tags
	}
	descMap[locale] = description

	catBytes, _ := json.Marshal(catMap)
	tagsBytes, _ := json.Marshal(tagsMap)
	descBytes, _ := json.Marshal(descMap)

	updateWhere := `content_hash = ? AND hash_algorithm = ? AND status = 'ready'`
	updateArgs := []any{string(catBytes), string(tagsBytes), string(descBytes), contentHash, hashAlgorithm}
	if projectID != "" || repoPath != "" {
		updateWhere += ` AND project_id = ? AND repo_path = ?`
		updateArgs = append(updateArgs, projectID, repoPath)
	}
	result, err := s.db.Exec(`UPDATE ai_tags
		SET category_i18n_json = ?, tags_i18n_json = ?, description_i18n_json = ?
		WHERE `+updateWhere, updateArgs...)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return true, nil
	}
	return affected > 0, nil
}

// AllReadyContentHashes returns content hashes of all ready AI tag rows.
func (s *Store) AllReadyAITagHashes() ([]string, error) {
	return s.AllReadyAITagHashesForProjects(nil)
}

func (s *Store) AllReadyAITagHashesForProjects(projectIDs []string) ([]string, error) {
	where := `status = 'ready'`
	args := []any{}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where += ` AND ` + projectClause
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(`SELECT DISTINCT content_hash FROM ai_tags WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hashes []string
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			return nil, err
		}
		hashes = append(hashes, h)
	}
	return hashes, rows.Err()
}

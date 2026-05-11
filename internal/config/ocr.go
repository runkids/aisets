package config

import (
	"database/sql"
	"encoding/json"
	"strings"

	"aisets/internal/ocr"
	"aisets/internal/scanner"
)

func ocrKey(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

func (s *Store) UpsertOCRResult(result ocr.Result) error {
	if result.UpdatedAt == "" {
		result.UpdatedAt = nowUTC()
	}
	ocr.FinalizeResult(&result)
	languages, err := json.Marshal(result.Languages)
	if err != nil {
		return err
	}
	scripts, err := json.Marshal(result.Scripts)
	if err != nil {
		return err
	}
	var confidence any
	if result.Confidence != nil {
		confidence = *result.Confidence
	}
	_, err = s.db.Exec(`
		INSERT INTO ocr_results (
			project_id, repo_path, content_hash, hash_algorithm,
			engine_name, engine_version, settings_hash, status,
			text, normalized_text, text_status, languages_json, scripts_json, confidence,
			error_code, error_message, duration_ms, mode, attempts, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, repo_path, content_hash, hash_algorithm, engine_name, engine_version, settings_hash)
		DO UPDATE SET
			status = excluded.status,
			text = excluded.text,
			normalized_text = excluded.normalized_text,
			text_status = excluded.text_status,
			languages_json = excluded.languages_json,
			scripts_json = excluded.scripts_json,
			confidence = excluded.confidence,
			error_code = excluded.error_code,
			error_message = excluded.error_message,
			duration_ms = excluded.duration_ms,
			mode = excluded.mode,
			attempts = excluded.attempts,
			updated_at = excluded.updated_at
	`, result.ProjectID, result.RepoPath, result.ContentHash, result.HashAlgorithm,
		result.EngineName, result.EngineVersion, result.SettingsHash, result.Status,
		result.Text, result.NormalizedText, result.TextStatus, string(languages), string(scripts), confidence,
		result.ErrorCode, result.ErrorMessage, result.DurationMs, result.Mode, result.Attempts, result.UpdatedAt)
	return err
}

func (s *Store) OCRResults(items []scanner.AssetItem, settings ocr.Settings, engineName, engineVersion string) (map[string]ocr.Result, error) {
	out := map[string]ocr.Result{}
	if len(items) == 0 {
		return out, nil
	}
	hashes := contentHashes(items)
	if len(hashes) == 0 {
		return out, nil
	}
	settingsHash := ocr.SettingsHash(settings)
	hashClause, hashArgs := inClauseSQL("content_hash", hashes)
	args := []any{engineName, engineVersion, settingsHash}
	args = append(args, hashArgs...)
	rows, err := s.rdb.Query(`
		SELECT project_id, repo_path, content_hash, hash_algorithm,
			status, text, normalized_text, COALESCE(text_status, ''), languages_json, scripts_json, confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, COALESCE(mode, ''), attempts, updated_at
		FROM ocr_results
		WHERE engine_name = ? AND engine_version = ? AND settings_hash = ?
			AND `+hashClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var result ocr.Result
		var languagesRaw, scriptsRaw string
		var confidence sql.NullFloat64
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Text, &result.NormalizedText, &result.TextStatus, &languagesRaw, &scriptsRaw, &confidence,
			&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.Mode, &result.Attempts, &result.UpdatedAt); err != nil {
			return nil, err
		}
		result.EngineName = engineName
		result.EngineVersion = engineVersion
		result.SettingsHash = settingsHash
		if confidence.Valid {
			value := confidence.Float64
			result.Confidence = &value
		}
		_ = json.Unmarshal([]byte(languagesRaw), &result.Languages)
		_ = json.Unmarshal([]byte(scriptsRaw), &result.Scripts)
		ocr.FinalizeResult(&result)
		out[ocrKey(result.ProjectID, result.RepoPath)] = result
	}
	return out, rows.Err()
}

func (s *Store) OCRResultForItem(item scanner.AssetItem, settings ocr.Settings, engineName, engineVersion string) (ocr.Result, bool, error) {
	results, err := s.OCRResults([]scanner.AssetItem{item}, settings, engineName, engineVersion)
	if err != nil {
		return ocr.Result{}, false, err
	}
	result, ok := results[ocrKey(item.ProjectID, item.RepoPath)]
	return result, ok, nil
}

func (s *Store) OCRResultForContentHash(contentHash, hashAlgorithm string, settings ocr.Settings, engineName, engineVersion string) (ocr.Result, bool, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return ocr.Result{}, false, nil
	}
	settingsHash := ocr.SettingsHash(settings)
	row := s.rdb.QueryRow(`
		SELECT project_id, repo_path, status, text, normalized_text, COALESCE(text_status, ''), languages_json, scripts_json, confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, COALESCE(mode, ''), attempts, updated_at
		FROM ocr_results
		WHERE content_hash = ? AND hash_algorithm = ?
			AND engine_name = ? AND engine_version = ? AND settings_hash = ?
			AND status = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, contentHash, hashAlgorithm, engineName, engineVersion, settingsHash, ocr.StatusReady)
	result := ocr.Result{
		ContentHash:   contentHash,
		HashAlgorithm: hashAlgorithm,
		EngineName:    engineName,
		EngineVersion: engineVersion,
		SettingsHash:  settingsHash,
	}
	var languagesRaw, scriptsRaw string
	var confidence sql.NullFloat64
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status, &result.Text, &result.NormalizedText, &result.TextStatus, &languagesRaw, &scriptsRaw, &confidence, &result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.Mode, &result.Attempts, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return ocr.Result{}, false, nil
	}
	if err != nil {
		return ocr.Result{}, false, err
	}
	if confidence.Valid {
		value := confidence.Float64
		result.Confidence = &value
	}
	_ = json.Unmarshal([]byte(languagesRaw), &result.Languages)
	_ = json.Unmarshal([]byte(scriptsRaw), &result.Scripts)
	ocr.FinalizeResult(&result)
	return result, true, nil
}

func (s *Store) VLMOCRResults(items []scanner.AssetItem, engineVersion, settingsHash string) (map[string]ocr.Result, error) {
	out := map[string]ocr.Result{}
	if len(items) == 0 {
		return out, nil
	}
	hashes := contentHashes(items)
	if len(hashes) == 0 {
		return out, nil
	}
	hashClause, hashArgs := inClauseSQL("content_hash", hashes)
	args := []any{engineVersion, settingsHash}
	args = append(args, hashArgs...)
	rows, err := s.rdb.Query(`
		SELECT project_id, repo_path, content_hash, hash_algorithm,
			status, text, normalized_text, COALESCE(text_status, ''), languages_json, scripts_json, confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, COALESCE(mode, ''), attempts, updated_at
		FROM ocr_results
		WHERE engine_name = 'vlm' AND engine_version = ? AND settings_hash = ?
			AND `+hashClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var result ocr.Result
		var languagesRaw, scriptsRaw string
		var confidence sql.NullFloat64
		if err := rows.Scan(&result.ProjectID, &result.RepoPath, &result.ContentHash, &result.HashAlgorithm,
			&result.Status, &result.Text, &result.NormalizedText, &result.TextStatus, &languagesRaw, &scriptsRaw, &confidence,
			&result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.Mode, &result.Attempts, &result.UpdatedAt); err != nil {
			return nil, err
		}
		result.EngineName = "vlm"
		result.EngineVersion = engineVersion
		result.SettingsHash = settingsHash
		if confidence.Valid {
			value := confidence.Float64
			result.Confidence = &value
		}
		_ = json.Unmarshal([]byte(languagesRaw), &result.Languages)
		_ = json.Unmarshal([]byte(scriptsRaw), &result.Scripts)
		ocr.FinalizeResult(&result)
		out[ocrKey(result.ProjectID, result.RepoPath)] = result
	}
	return out, rows.Err()
}

func (s *Store) VLMOCRResultForContentHash(contentHash, hashAlgorithm, engineVersion, settingsHash string) (ocr.Result, bool, error) {
	if contentHash == "" || hashAlgorithm == "" {
		return ocr.Result{}, false, nil
	}
	row := s.rdb.QueryRow(`
		SELECT project_id, repo_path, status, text, normalized_text, COALESCE(text_status, ''), languages_json, scripts_json, confidence,
			COALESCE(error_code, ''), COALESCE(error_message, ''), duration_ms, COALESCE(mode, ''), attempts, updated_at
		FROM ocr_results
		WHERE content_hash = ? AND hash_algorithm = ?
			AND engine_name = 'vlm' AND engine_version = ? AND settings_hash = ?
			AND status = ?
		ORDER BY updated_at DESC
		LIMIT 1
	`, contentHash, hashAlgorithm, engineVersion, settingsHash, ocr.StatusReady)
	result := ocr.Result{
		ContentHash:   contentHash,
		HashAlgorithm: hashAlgorithm,
		EngineName:    "vlm",
		EngineVersion: engineVersion,
		SettingsHash:  settingsHash,
	}
	var languagesRaw, scriptsRaw string
	var confidence sql.NullFloat64
	err := row.Scan(&result.ProjectID, &result.RepoPath, &result.Status, &result.Text, &result.NormalizedText, &result.TextStatus, &languagesRaw, &scriptsRaw, &confidence, &result.ErrorCode, &result.ErrorMessage, &result.DurationMs, &result.Mode, &result.Attempts, &result.UpdatedAt)
	if err == sql.ErrNoRows {
		return ocr.Result{}, false, nil
	}
	if err != nil {
		return ocr.Result{}, false, err
	}
	if confidence.Valid {
		value := confidence.Float64
		result.Confidence = &value
	}
	_ = json.Unmarshal([]byte(languagesRaw), &result.Languages)
	_ = json.Unmarshal([]byte(scriptsRaw), &result.Scripts)
	ocr.FinalizeResult(&result)
	return result, true, nil
}

func (s *Store) RemoveOCRResults() error {
	_, err := s.db.Exec(`DELETE FROM ocr_results`)
	return err
}

func OCRSettingsFromApp(settings AppSettings) ocr.Settings {
	return ocr.NormalizeSettings(ocr.Settings{
		Enabled:     settings.OCREnabled,
		Languages:   settings.OCRLanguages,
		MaxPixels:   settings.OCRMaxPixels,
		BatchSize:   settings.OCRBatchSize,
		Concurrency: settings.OCRConcurrency,
	})
}

func OCRLanguagesDisplay(languages []string) string {
	return strings.Join(ocr.NormalizeLanguages(languages), ",")
}

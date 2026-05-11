package config

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AITagListQuery holds parameters for browsing unique AI tags.
type AITagListQuery struct {
	Search   string
	Sort     string // "count" (default) or "alpha"
	Project  string
	Category string
	Limit    int
	Offset   int
}

// AITagListItem represents a unique tag with aggregated metadata.
type AITagListItem struct {
	Tag        string   `json:"tag"`
	Count      int      `json:"count"`
	Categories []string `json:"categories"`
	Projects   []string `json:"projects"`
}

// AITagListPage is the paginated result of AITagList.
type AITagListPage struct {
	Tags              []AITagListItem `json:"tags"`
	Total             int             `json:"total"`
	TotalTaggedAssets int             `json:"totalTaggedAssets"`
	TopCategory       string          `json:"topCategory"`
}

// AITagList returns paginated unique tags aggregated from all ready ai_tags rows.
func (s *Store) AITagList(q AITagListQuery) (AITagListPage, error) {
	if q.Limit <= 0 {
		q.Limit = 100
	}

	var where []string
	var args []any
	where = append(where, "at.status = 'ready'")

	if q.Search != "" {
		where = append(where, "(t.value LIKE '%' || ? || '%' OR LOWER(at.tags_i18n_json) LIKE '%' || ? || '%')")
		low := strings.ToLower(q.Search)
		args = append(args, low, low)
	}
	if q.Project != "" {
		where = append(where, "at.project_id = ?")
		args = append(args, q.Project)
	}
	if q.Category != "" {
		where = append(where, "at.category = ?")
		args = append(args, q.Category)
	}

	whereClause := strings.Join(where, " AND ")

	orderBy := "asset_count DESC, t.value ASC"
	if q.Sort == "alpha" {
		orderBy = "t.value ASC, asset_count DESC"
	}

	listSQL := fmt.Sprintf(`
		SELECT t.value AS tag,
			COUNT(DISTINCT at.project_id || char(0) || at.repo_path) AS asset_count,
			GROUP_CONCAT(DISTINCT at.category) AS categories,
			GROUP_CONCAT(DISTINCT at.project_id) AS projects
		FROM ai_tags at, json_each(at.tags_json) t
		WHERE %s
		GROUP BY t.value
		ORDER BY %s
		LIMIT ? OFFSET ?
	`, whereClause, orderBy)

	listArgs := append(append([]any{}, args...), q.Limit, q.Offset)

	rows, err := s.rdb.Query(listSQL, listArgs...)
	if err != nil {
		return AITagListPage{}, fmt.Errorf("aitag list query: %w", err)
	}
	defer rows.Close()

	var tags []AITagListItem
	for rows.Next() {
		var item AITagListItem
		var categoriesRaw, projectsRaw string
		if err := rows.Scan(&item.Tag, &item.Count, &categoriesRaw, &projectsRaw); err != nil {
			return AITagListPage{}, fmt.Errorf("aitag list scan: %w", err)
		}
		if categoriesRaw != "" {
			item.Categories = strings.Split(categoriesRaw, ",")
		}
		if projectsRaw != "" {
			item.Projects = strings.Split(projectsRaw, ",")
		}
		tags = append(tags, item)
	}
	if err := rows.Err(); err != nil {
		return AITagListPage{}, fmt.Errorf("aitag list rows: %w", err)
	}

	countSQL := fmt.Sprintf(`
		SELECT COUNT(DISTINCT t.value)
		FROM ai_tags at, json_each(at.tags_json) t
		WHERE %s
	`, whereClause)

	var total int
	if err := s.rdb.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return AITagListPage{}, fmt.Errorf("aitag count: %w", err)
	}

	taggedAssets, topCategory, err := s.aiTagStats(q.Project)
	if err != nil {
		return AITagListPage{}, err
	}

	return AITagListPage{
		Tags:              tags,
		Total:             total,
		TotalTaggedAssets: taggedAssets,
		TopCategory:       topCategory,
	}, nil
}

// AITagRename renames all occurrences of `from` to `to` in tags_json across all ready ai_tags rows.
func (s *Store) AITagRename(from, to string) (int, error) {
	return s.AITagMerge([]string{from}, to)
}

// AITagMerge merges all source tags into target in tags_json across all ready ai_tags rows.
func (s *Store) AITagMerge(source []string, target string) (int, error) {
	if len(source) == 0 || target == "" {
		return 0, fmt.Errorf("aitag merge: source and target must be non-empty")
	}

	inExpr, args := inClauseSQL("j.value", source)

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("aitag merge begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	querySQL := fmt.Sprintf(`
		SELECT rowid, tags_json FROM ai_tags
		WHERE status = 'ready'
		  AND EXISTS (SELECT 1 FROM json_each(tags_json) j WHERE %s)
	`, inExpr)

	rows, err := tx.Query(querySQL, args...)
	if err != nil {
		return 0, fmt.Errorf("aitag merge query: %w", err)
	}

	type rowUpdate struct {
		rowid   int64
		newJSON string
	}
	var updates []rowUpdate

	sourceSet := make(map[string]struct{}, len(source))
	for _, s := range source {
		sourceSet[s] = struct{}{}
	}

	for rows.Next() {
		var rowid int64
		var tagsRaw string
		if err := rows.Scan(&rowid, &tagsRaw); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag merge scan: %w", err)
		}

		var tags []string
		if err := json.Unmarshal([]byte(tagsRaw), &tags); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag merge unmarshal rowid=%d: %w", rowid, err)
		}

		// Replace source tags with target, dedup
		seen := make(map[string]struct{}, len(tags))
		var result []string
		for _, tag := range tags {
			if _, isSource := sourceSet[tag]; isSource {
				if _, dup := seen[target]; !dup {
					seen[target] = struct{}{}
					result = append(result, target)
				}
			} else {
				if _, dup := seen[tag]; !dup {
					seen[tag] = struct{}{}
					result = append(result, tag)
				}
			}
		}

		newRaw, err := json.Marshal(result)
		if err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag merge marshal rowid=%d: %w", rowid, err)
		}
		updates = append(updates, rowUpdate{rowid: rowid, newJSON: string(newRaw)})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("aitag merge rows: %w", err)
	}

	for _, u := range updates {
		if _, err := tx.Exec("UPDATE ai_tags SET tags_json = ? WHERE rowid = ?", u.newJSON, u.rowid); err != nil {
			return 0, fmt.Errorf("aitag merge update rowid=%d: %w", u.rowid, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("aitag merge commit: %w", err)
	}
	return len(updates), nil
}

// AITagDelete removes specified tags from all ready ai_tags rows' tags_json.
func (s *Store) AITagDelete(tags []string) (int, error) {
	if len(tags) == 0 {
		return 0, fmt.Errorf("aitag delete: tags must be non-empty")
	}

	inExpr, args := inClauseSQL("j.value", tags)

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("aitag delete begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	querySQL := fmt.Sprintf(`
		SELECT rowid, tags_json FROM ai_tags
		WHERE status = 'ready'
		  AND EXISTS (SELECT 1 FROM json_each(tags_json) j WHERE %s)
	`, inExpr)

	rows, err := tx.Query(querySQL, args...)
	if err != nil {
		return 0, fmt.Errorf("aitag delete query: %w", err)
	}

	type rowUpdate struct {
		rowid   int64
		newJSON string
	}
	var updates []rowUpdate

	deleteSet := make(map[string]struct{}, len(tags))
	for _, t := range tags {
		deleteSet[t] = struct{}{}
	}

	for rows.Next() {
		var rowid int64
		var tagsRaw string
		if err := rows.Scan(&rowid, &tagsRaw); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag delete scan: %w", err)
		}

		var existing []string
		if err := json.Unmarshal([]byte(tagsRaw), &existing); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag delete unmarshal rowid=%d: %w", rowid, err)
		}

		var result []string
		for _, tag := range existing {
			if _, del := deleteSet[tag]; !del {
				result = append(result, tag)
			}
		}

		if result == nil {
			result = []string{}
		}
		newRaw, err := json.Marshal(result)
		if err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag delete marshal rowid=%d: %w", rowid, err)
		}
		updates = append(updates, rowUpdate{rowid: rowid, newJSON: string(newRaw)})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("aitag delete rows: %w", err)
	}

	for _, u := range updates {
		if _, err := tx.Exec("UPDATE ai_tags SET tags_json = ? WHERE rowid = ?", u.newJSON, u.rowid); err != nil {
			return 0, fmt.Errorf("aitag delete update rowid=%d: %w", u.rowid, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("aitag delete commit: %w", err)
	}
	return len(updates), nil
}

// AITagSetForAssetKey identifies an asset for tag operations.
type AITagSetForAssetKey struct {
	ProjectID     string
	RepoPath      string
	ContentHash   string
	HashAlgorithm string
}

// AITagSetForAsset replaces the tags_json for a specific asset's ai_tags row.
func (s *Store) AITagSetForAsset(key AITagSetForAssetKey, tags []string) error {
	if key.ProjectID == "" || key.RepoPath == "" {
		return fmt.Errorf("aitag set: projectID and repoPath must be non-empty")
	}
	if tags == nil {
		tags = []string{}
	}

	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return fmt.Errorf("aitag set marshal: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("aitag set begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var rowid int64
	err = tx.QueryRow(`
		SELECT rowid FROM ai_tags
		WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ? AND status = 'ready'
		ORDER BY updated_at DESC
		LIMIT 1
	`, key.ProjectID, key.RepoPath, key.ContentHash, key.HashAlgorithm).Scan(&rowid)

	if err == nil {
		_, err = tx.Exec("UPDATE ai_tags SET tags_json = ?, updated_at = datetime('now') WHERE rowid = ?", string(tagsJSON), rowid)
		if err != nil {
			return fmt.Errorf("aitag set update: %w", err)
		}
	} else {
		_, err = tx.Exec(`
			INSERT INTO ai_tags (project_id, repo_path, content_hash, hash_algorithm, status, tags_json, category, description, provider_name, model_name, updated_at)
			VALUES (?, ?, ?, ?, 'ready', ?, '', '', 'manual', 'user', datetime('now'))
		`, key.ProjectID, key.RepoPath, key.ContentHash, key.HashAlgorithm, string(tagsJSON))
		if err != nil {
			return fmt.Errorf("aitag set insert: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("aitag set commit: %w", err)
	}
	return nil
}

// AITagSuggest returns tag values matching the given prefix for autocomplete.
func (s *Store) AITagSuggest(prefix string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 10
	}

	low := strings.ToLower(prefix)
	rows, err := s.rdb.Query(`
		SELECT DISTINCT t.value
		FROM ai_tags at, json_each(at.tags_json) t
		WHERE at.status = 'ready' AND (t.value LIKE ? || '%' OR LOWER(at.tags_i18n_json) LIKE '%' || ? || '%')
		ORDER BY t.value
		LIMIT ?
	`, low, low, limit)
	if err != nil {
		return nil, fmt.Errorf("aitag suggest query: %w", err)
	}
	defer rows.Close()

	var suggestions []string
	for rows.Next() {
		var val string
		if err := rows.Scan(&val); err != nil {
			return nil, fmt.Errorf("aitag suggest scan: %w", err)
		}
		suggestions = append(suggestions, val)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("aitag suggest rows: %w", err)
	}
	if suggestions == nil {
		suggestions = []string{}
	}
	return suggestions, nil
}

// AITagCategories returns all distinct categories from ready ai_tags rows.
func (s *Store) AITagCategories() ([]string, error) {
	rows, err := s.rdb.Query(`
		SELECT DISTINCT category FROM ai_tags
		WHERE status = 'ready' AND category != ''
		ORDER BY category
	`)
	if err != nil {
		return nil, fmt.Errorf("aitag categories: %w", err)
	}
	defer rows.Close()

	var cats []string
	for rows.Next() {
		var cat string
		if err := rows.Scan(&cat); err != nil {
			return nil, fmt.Errorf("aitag categories scan: %w", err)
		}
		cats = append(cats, cat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("aitag categories rows: %w", err)
	}
	if cats == nil {
		cats = []string{}
	}
	return cats, nil
}

func (s *Store) aiTagStats(projectFilter string) (taggedAssets int, topCategory string, err error) {
	var where []string
	var args []any
	where = append(where, "at.status = 'ready'")
	if projectFilter != "" {
		where = append(where, "at.project_id = ?")
		args = append(args, projectFilter)
	}
	whereClause := strings.Join(where, " AND ")

	assetsSQL := fmt.Sprintf(`
		SELECT COUNT(DISTINCT at.project_id || char(0) || at.repo_path)
		FROM ai_tags at
		WHERE %s
	`, whereClause)
	if err := s.rdb.QueryRow(assetsSQL, args...).Scan(&taggedAssets); err != nil {
		return 0, "", fmt.Errorf("aitag stats assets: %w", err)
	}

	catSQL := fmt.Sprintf(`
		SELECT at.category
		FROM ai_tags at
		WHERE %s AND at.category != ''
		GROUP BY at.category
		ORDER BY COUNT(*) DESC
		LIMIT 1
	`, whereClause)
	_ = s.rdb.QueryRow(catSQL, args...).Scan(&topCategory)

	return taggedAssets, topCategory, nil
}

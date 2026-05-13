package config

import (
	"encoding/json"
	"fmt"
	"strings"
)

// AITagListQuery holds parameters for browsing unique AI tags.
type AITagListQuery struct {
	Search     string
	Sort       string // "count" (default) or "alpha"
	Project    string
	ProjectIDs []string
	Category   string
	Locale     string
	Limit      int
	Offset     int
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
	Tags                 []AITagListItem   `json:"tags"`
	Total                int               `json:"total"`
	TotalTaggedAssets    int               `json:"totalTaggedAssets"`
	TopCategory          string            `json:"topCategory"`
	Translations         map[string]string `json:"translations,omitempty"`
	CategoryTranslations map[string]string `json:"categoryTranslations,omitempty"`
}

// AICategoryListQuery holds parameters for browsing unique AI categories.
type AICategoryListQuery struct {
	Search     string
	Sort       string // "count" (default) or "alpha"
	Locale     string
	ProjectIDs []string
	Limit      int
	Offset     int
}

// AICategoryListItem represents one unique AI category with aggregated metadata.
type AICategoryListItem struct {
	Category     string   `json:"category"`
	AssetCount   int      `json:"assetCount"`
	TagCount     int      `json:"tagCount"`
	ProjectCount int      `json:"projectCount"`
	TopTags      []string `json:"topTags"`
}

// AICategoryListPage is the paginated result of AITagCategoryList.
type AICategoryListPage struct {
	Categories             []AICategoryListItem `json:"categories"`
	Total                  int                  `json:"total"`
	TotalCategorizedAssets int                  `json:"totalCategorizedAssets"`
	Translations           map[string]string    `json:"translations,omitempty"`
	TagTranslations        map[string]string    `json:"tagTranslations,omitempty"`
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
	if q.ProjectIDs != nil {
		if len(q.ProjectIDs) == 0 {
			return AITagListPage{Tags: []AITagListItem{}}, nil
		}
		projectClause, projectArgs := inClauseSQL("at.project_id", q.ProjectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
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

	taggedAssets, topCategory, err := s.aiTagStats(q.Project, q.ProjectIDs)
	if err != nil {
		return AITagListPage{}, err
	}

	page := AITagListPage{
		Tags:              tags,
		Total:             total,
		TotalTaggedAssets: taggedAssets,
		TopCategory:       topCategory,
	}

	if q.Locale != "" && len(tags) > 0 {
		if tr, err := s.aiTagTranslations(tags, q.Locale, q.ProjectIDs); err == nil && len(tr) > 0 {
			page.Translations = tr
		}
		if ctr, err := s.aiCategoryTranslationsForProjects(q.Locale, q.ProjectIDs); err == nil && len(ctr) > 0 {
			page.CategoryTranslations = ctr
		}
	}

	return page, nil
}

// AITagCategoryList returns paginated unique categories aggregated from ready ai_tags rows.
func (s *Store) AITagCategoryList(q AICategoryListQuery) (AICategoryListPage, error) {
	if q.Limit <= 0 {
		q.Limit = 100
	}

	var where []string
	var args []any
	where = append(where, "status = 'ready'", "category != ''")

	if q.Search != "" {
		where = append(where, "(category LIKE '%' || ? || '%' OR LOWER(category_i18n_json) LIKE '%' || ? || '%')")
		low := strings.ToLower(q.Search)
		args = append(args, low, low)
	}
	if q.ProjectIDs != nil {
		if len(q.ProjectIDs) == 0 {
			return AICategoryListPage{Categories: []AICategoryListItem{}}, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", q.ProjectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}

	whereClause := strings.Join(where, " AND ")
	orderBy := "asset_count DESC, category ASC"
	if q.Sort == "alpha" {
		orderBy = "category ASC, asset_count DESC"
	}

	listSQL := fmt.Sprintf(`
		SELECT category,
			COUNT(DISTINCT project_id || char(0) || repo_path) AS asset_count,
			COUNT(DISTINCT project_id) AS project_count
		FROM ai_tags
		WHERE %s
		GROUP BY category
		ORDER BY %s
		LIMIT ? OFFSET ?
	`, whereClause, orderBy)

	listArgs := append(append([]any{}, args...), q.Limit, q.Offset)
	rows, err := s.rdb.Query(listSQL, listArgs...)
	if err != nil {
		return AICategoryListPage{}, fmt.Errorf("ai category list query: %w", err)
	}
	defer rows.Close()

	categories := []AICategoryListItem{}
	for rows.Next() {
		var item AICategoryListItem
		if err := rows.Scan(&item.Category, &item.AssetCount, &item.ProjectCount); err != nil {
			return AICategoryListPage{}, fmt.Errorf("ai category list scan: %w", err)
		}
		categories = append(categories, item)
	}
	if err := rows.Err(); err != nil {
		return AICategoryListPage{}, fmt.Errorf("ai category list rows: %w", err)
	}

	countSQL := fmt.Sprintf(`
		SELECT COUNT(DISTINCT category)
		FROM ai_tags
		WHERE %s
	`, whereClause)
	var total int
	if err := s.rdb.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return AICategoryListPage{}, fmt.Errorf("ai category count: %w", err)
	}

	assetsWhere := []string{"status = 'ready'", "category != ''"}
	assetsArgs := []any{}
	if q.ProjectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", q.ProjectIDs)
		assetsWhere = append(assetsWhere, projectClause)
		assetsArgs = append(assetsArgs, projectArgs...)
	}
	var totalAssets int
	if err := s.rdb.QueryRow(`
		SELECT COUNT(DISTINCT project_id || char(0) || repo_path)
		FROM ai_tags
		WHERE `+strings.Join(assetsWhere, " AND "), assetsArgs...).Scan(&totalAssets); err != nil {
		return AICategoryListPage{}, fmt.Errorf("ai category assets: %w", err)
	}

	if len(categories) > 0 {
		topTags, tagCounts, err := s.aiCategoryTopTags(categories, q.ProjectIDs)
		if err != nil {
			return AICategoryListPage{}, err
		}
		for i := range categories {
			categories[i].TopTags = topTags[categories[i].Category]
			if categories[i].TopTags == nil {
				categories[i].TopTags = []string{}
			}
			categories[i].TagCount = tagCounts[categories[i].Category]
		}
	}

	page := AICategoryListPage{
		Categories:             categories,
		Total:                  total,
		TotalCategorizedAssets: totalAssets,
	}

	if q.Locale != "" && len(categories) > 0 {
		if tr, err := s.aiCategoryListTranslations(categories, q.Locale, q.ProjectIDs); err == nil && len(tr) > 0 {
			page.Translations = tr
		}
		topTags := uniqueTopTags(categories)
		if tr, err := s.aiTagTranslationsForValues(topTags, q.Locale, q.ProjectIDs); err == nil && len(tr) > 0 {
			page.TagTranslations = tr
		}
	}

	return page, nil
}

func uniqueTopTags(categories []AICategoryListItem) []string {
	seen := make(map[string]struct{})
	values := make([]string, 0, len(categories)*5)
	for _, category := range categories {
		for _, tag := range category.TopTags {
			if _, ok := seen[tag]; ok {
				continue
			}
			seen[tag] = struct{}{}
			values = append(values, tag)
		}
	}
	return values
}

func (s *Store) aiCategoryTopTags(categories []AICategoryListItem, projectIDs []string) (map[string][]string, map[string]int, error) {
	values := make([]string, len(categories))
	for i, c := range categories {
		values[i] = c.Category
	}
	catClause, args := inClauseSQL("category", values)
	where := []string{"status = 'ready'", catClause}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return map[string][]string{}, map[string]int{}, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(fmt.Sprintf(`
		SELECT category, t.value, COUNT(*) AS tag_count
		FROM ai_tags, json_each(tags_json) t
		WHERE %s
		GROUP BY category, t.value
		ORDER BY category ASC, tag_count DESC, t.value ASC
	`, strings.Join(where, " AND ")), args...)
	if err != nil {
		return nil, nil, fmt.Errorf("ai category top tags query: %w", err)
	}
	defer rows.Close()

	topTags := map[string][]string{}
	tagCounts := map[string]int{}
	seenTags := map[string]map[string]struct{}{}
	for rows.Next() {
		var category, tag string
		var tagCount int
		if err := rows.Scan(&category, &tag, &tagCount); err != nil {
			return nil, nil, fmt.Errorf("ai category top tags scan: %w", err)
		}
		if seenTags[category] == nil {
			seenTags[category] = map[string]struct{}{}
		}
		if _, ok := seenTags[category][tag]; !ok {
			seenTags[category][tag] = struct{}{}
			tagCounts[category]++
		}
		if len(topTags[category]) < 5 {
			topTags[category] = append(topTags[category], tag)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("ai category top tags rows: %w", err)
	}
	return topTags, tagCounts, nil
}

func (s *Store) aiCategoryListTranslations(categories []AICategoryListItem, locale string, projectIDs []string) (map[string]string, error) {
	locale = validLocaleOrEmpty(locale)
	if locale == "" {
		return nil, nil
	}
	values := make([]string, len(categories))
	for i, c := range categories {
		values[i] = c.Category
	}
	catClause, args := inClauseSQL("category", values)
	where := []string{"status = 'ready'", catClause, `json_type(category_i18n_json, '$."` + locale + `"') = 'text'`}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(fmt.Sprintf(`
		SELECT category, json_extract(category_i18n_json, '$."`+locale+`"')
		FROM ai_tags
		WHERE %s
		GROUP BY category
	`, strings.Join(where, " AND ")), args...)
	if err != nil {
		return nil, fmt.Errorf("ai category list translations: %w", err)
	}
	defer rows.Close()

	result := map[string]string{}
	for rows.Next() {
		var category string
		var translation *string
		if err := rows.Scan(&category, &translation); err != nil {
			return nil, fmt.Errorf("ai category list translations scan: %w", err)
		}
		if translation != nil && *translation != "" {
			result[category] = *translation
		}
	}
	return result, rows.Err()
}

func (s *Store) aiTagTranslations(tags []AITagListItem, locale string, projectIDs []string) (map[string]string, error) {
	values := make([]string, 0, len(tags))
	for _, tag := range tags {
		values = append(values, tag.Tag)
	}
	return s.aiTagTranslationsForValues(values, locale, projectIDs)
}

func (s *Store) aiTagTranslationsForValues(tags []string, locale string, projectIDs []string) (map[string]string, error) {
	locale = validLocaleOrEmpty(locale)
	if locale == "" || len(tags) == 0 {
		return nil, nil
	}
	inExpr, args := inClauseSQL("t.value", tags)
	where := []string{"at.status = 'ready'", inExpr, `json_type(at.tags_i18n_json, '$."` + locale + `"') = 'array'`}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("at.project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}

	rows, err := s.rdb.Query(fmt.Sprintf(`
		SELECT t.value,
		       json_extract(at.tags_i18n_json, '$."`+locale+`"[' || t.key || ']')
		FROM ai_tags at, json_each(at.tags_json) t
		WHERE %s
	`, strings.Join(where, " AND ")), args...)
	if err != nil {
		return nil, fmt.Errorf("aitag translations: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string, len(tags))
	for rows.Next() {
		var tag string
		var translation *string
		if err := rows.Scan(&tag, &translation); err != nil {
			return nil, fmt.Errorf("aitag translations scan: %w", err)
		}
		if translation != nil && *translation != "" && result[tag] == "" {
			result[tag] = *translation
		}
	}
	return result, rows.Err()
}

func (s *Store) aiCategoryTranslations(locale string) (map[string]string, error) {
	return s.aiCategoryTranslationsForProjects(locale, nil)
}

func (s *Store) aiCategoryTranslationsForProjects(locale string, projectIDs []string) (map[string]string, error) {
	locale = validLocaleOrEmpty(locale)
	if locale == "" {
		return nil, nil
	}
	where := []string{"status = 'ready'", "category != ''", `json_type(category_i18n_json, '$."` + locale + `"') = 'text'`}
	args := []any{}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return nil, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(`
		SELECT category, json_extract(category_i18n_json, '$."`+locale+`"')
		FROM ai_tags
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY category
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("ai category translations: %w", err)
	}
	defer rows.Close()

	result := map[string]string{}
	for rows.Next() {
		var cat string
		var translation *string
		if err := rows.Scan(&cat, &translation); err != nil {
			return nil, fmt.Errorf("ai category translations scan: %w", err)
		}
		if translation != nil && *translation != "" {
			result[cat] = *translation
		}
	}
	return result, rows.Err()
}

// AITagRename renames all occurrences of `from` to `to` in tags_json across all ready ai_tags rows.
func (s *Store) AITagRename(from, to string) (int, error) {
	return s.AITagMerge([]string{from}, to)
}

func (s *Store) AITagRenameForProjects(from, to string, projectIDs []string) (int, error) {
	return s.AITagMergeForProjects([]string{from}, to, projectIDs)
}

// AITagCategoryRename renames all ready ai_tags rows from one category to another.
func (s *Store) AITagCategoryRename(from, to string) (int, error) {
	return s.AITagCategoryRenameForProjects(from, to, nil)
}

func (s *Store) AITagCategoryRenameForProjects(from, to string, projectIDs []string) (int, error) {
	if from == "" || to == "" {
		return 0, fmt.Errorf("ai category rename: from and to must be non-empty")
	}
	where := []string{"status = 'ready'", "category = ?"}
	args := []any{to, from}
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return 0, nil
		}
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	res, err := s.db.Exec(`
		UPDATE ai_tags
		SET category = ?
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return 0, fmt.Errorf("ai category rename: %w", err)
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

// AITagCategoryMerge merges all source categories into target without changing tags or descriptions.
func (s *Store) AITagCategoryMerge(source []string, target string) (int, error) {
	return s.AITagCategoryMergeForProjects(source, target, nil)
}

func (s *Store) AITagCategoryMergeForProjects(source []string, target string, projectIDs []string) (int, error) {
	if len(source) == 0 || target == "" {
		return 0, fmt.Errorf("ai category merge: source and target must be non-empty")
	}
	if projectIDs != nil && len(projectIDs) == 0 {
		return 0, nil
	}

	targetI18n := "{}"
	var raw string
	targetWhere := []string{"status = 'ready'", "category = ?", "category_i18n_json != '{}'"}
	targetArgs := []any{target}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		targetWhere = append(targetWhere, projectClause)
		targetArgs = append(targetArgs, projectArgs...)
	}
	if err := s.rdb.QueryRow(`
		SELECT COALESCE(category_i18n_json, '{}') FROM ai_tags
		WHERE `+strings.Join(targetWhere, " AND ")+`
		ORDER BY updated_at DESC
		LIMIT 1
	`, targetArgs...).Scan(&raw); err == nil && raw != "" {
		targetI18n = raw
	}

	inExpr, args := inClauseSQL("category", source)
	where := []string{"status = 'ready'", inExpr}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	updateArgs := append([]any{target, targetI18n}, args...)
	res, err := s.db.Exec(`
		UPDATE ai_tags
		SET category = ?, category_i18n_json = ?
		WHERE `+strings.Join(where, " AND "), updateArgs...)
	if err != nil {
		return 0, fmt.Errorf("ai category merge: %w", err)
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

// AITagCategoryClear clears categories from ready ai_tags rows while preserving tag data.
func (s *Store) AITagCategoryClear(categories []string) (int, error) {
	return s.AITagCategoryClearForProjects(categories, nil)
}

func (s *Store) AITagCategoryClearForProjects(categories []string, projectIDs []string) (int, error) {
	if len(categories) == 0 {
		return 0, fmt.Errorf("ai category clear: categories must be non-empty")
	}
	if projectIDs != nil && len(projectIDs) == 0 {
		return 0, nil
	}
	inExpr, args := inClauseSQL("category", categories)
	where := []string{"status = 'ready'", inExpr}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	res, err := s.db.Exec(`
		UPDATE ai_tags
		SET category = '', category_i18n_json = '{}'
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return 0, fmt.Errorf("ai category clear: %w", err)
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

// AITagMerge merges all source tags into target in tags_json and tags_i18n_json across all ready ai_tags rows.
func (s *Store) AITagMerge(source []string, target string) (int, error) {
	return s.AITagMergeForProjects(source, target, nil)
}

func (s *Store) AITagMergeForProjects(source []string, target string, projectIDs []string) (int, error) {
	if len(source) == 0 || target == "" {
		return 0, fmt.Errorf("aitag merge: source and target must be non-empty")
	}
	if projectIDs != nil && len(projectIDs) == 0 {
		return 0, nil
	}

	inExpr, args := inClauseSQL("j.value", source)
	where := []string{"status = 'ready'", fmt.Sprintf("EXISTS (SELECT 1 FROM json_each(tags_json) j WHERE %s)", inExpr)}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("aitag merge begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	querySQL := `
		SELECT rowid, tags_json, COALESCE(tags_i18n_json, '{}') FROM ai_tags
		WHERE ` + strings.Join(where, " AND ")

	rows, err := tx.Query(querySQL, args...)
	if err != nil {
		return 0, fmt.Errorf("aitag merge query: %w", err)
	}

	type rowUpdate struct {
		rowid   int64
		newJSON string
		newI18n string
	}
	var updates []rowUpdate

	sourceSet := make(map[string]struct{}, len(source))
	for _, s := range source {
		sourceSet[s] = struct{}{}
	}

	for rows.Next() {
		var rowid int64
		var tagsRaw, i18nRaw string
		if err := rows.Scan(&rowid, &tagsRaw, &i18nRaw); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag merge scan: %w", err)
		}

		var tags []string
		if err := json.Unmarshal([]byte(tagsRaw), &tags); err != nil {
			rows.Close()
			return 0, fmt.Errorf("aitag merge unmarshal rowid=%d: %w", rowid, err)
		}

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
		updates = append(updates, rowUpdate{
			rowid:   rowid,
			newJSON: string(newRaw),
			newI18n: syncI18nTags(tagsRaw, i18nRaw, result),
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("aitag merge rows: %w", err)
	}

	for _, u := range updates {
		if _, err := tx.Exec("UPDATE ai_tags SET tags_json = ?, tags_i18n_json = ? WHERE rowid = ?", u.newJSON, u.newI18n, u.rowid); err != nil {
			return 0, fmt.Errorf("aitag merge update rowid=%d: %w", u.rowid, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("aitag merge commit: %w", err)
	}
	return len(updates), nil
}

// AITagDelete removes specified tags from all ready ai_tags rows' tags_json and tags_i18n_json.
func (s *Store) AITagDelete(tags []string) (int, error) {
	return s.AITagDeleteForProjects(tags, nil)
}

func (s *Store) AITagDeleteForProjects(tags []string, projectIDs []string) (int, error) {
	if len(tags) == 0 {
		return 0, fmt.Errorf("aitag delete: tags must be non-empty")
	}
	if projectIDs != nil && len(projectIDs) == 0 {
		return 0, nil
	}

	inExpr, args := inClauseSQL("j.value", tags)
	where := []string{"status = 'ready'", fmt.Sprintf("EXISTS (SELECT 1 FROM json_each(tags_json) j WHERE %s)", inExpr)}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("aitag delete begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	querySQL := `
		SELECT rowid, tags_json, COALESCE(tags_i18n_json, '{}') FROM ai_tags
		WHERE ` + strings.Join(where, " AND ")

	rows, err := tx.Query(querySQL, args...)
	if err != nil {
		return 0, fmt.Errorf("aitag delete query: %w", err)
	}

	type rowUpdate struct {
		rowid   int64
		newJSON string
		newI18n string
	}
	var updates []rowUpdate

	deleteSet := make(map[string]struct{}, len(tags))
	for _, t := range tags {
		deleteSet[t] = struct{}{}
	}

	for rows.Next() {
		var rowid int64
		var tagsRaw, i18nRaw string
		if err := rows.Scan(&rowid, &tagsRaw, &i18nRaw); err != nil {
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
		updates = append(updates, rowUpdate{
			rowid:   rowid,
			newJSON: string(newRaw),
			newI18n: syncI18nTags(tagsRaw, i18nRaw, result),
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("aitag delete rows: %w", err)
	}

	for _, u := range updates {
		if _, err := tx.Exec("UPDATE ai_tags SET tags_json = ?, tags_i18n_json = ? WHERE rowid = ?", u.newJSON, u.newI18n, u.rowid); err != nil {
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
	var oldTagsRaw, oldI18nRaw string
	err = tx.QueryRow(`
		SELECT rowid, tags_json, COALESCE(tags_i18n_json, '{}') FROM ai_tags
		WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ? AND status = 'ready'
		ORDER BY updated_at DESC
		LIMIT 1
	`, key.ProjectID, key.RepoPath, key.ContentHash, key.HashAlgorithm).Scan(&rowid, &oldTagsRaw, &oldI18nRaw)

	if err == nil {
		newI18nJSON := syncI18nTags(oldTagsRaw, oldI18nRaw, tags)
		_, err = tx.Exec("UPDATE ai_tags SET tags_json = ?, tags_i18n_json = ?, updated_at = datetime('now') WHERE rowid = ?", string(tagsJSON), newI18nJSON, rowid)
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

// syncI18nTags rebuilds tags_i18n_json to match a new tags list.
// It preserves i18n entries at positions whose English tag is still present.
func syncI18nTags(oldTagsRaw, oldI18nRaw string, newTags []string) string {
	var oldTags []string
	_ = json.Unmarshal([]byte(oldTagsRaw), &oldTags)

	var oldI18n map[string][]string
	_ = json.Unmarshal([]byte(oldI18nRaw), &oldI18n)
	if len(oldI18n) == 0 {
		return "{}"
	}

	oldIndex := make(map[string]int, len(oldTags))
	for i, t := range oldTags {
		oldIndex[t] = i
	}

	newI18n := make(map[string][]string, len(oldI18n))
	for lang, vals := range oldI18n {
		kept := make([]string, 0, len(newTags))
		for _, tag := range newTags {
			if idx, ok := oldIndex[tag]; ok && idx < len(vals) {
				kept = append(kept, vals[idx])
			}
		}
		if len(kept) > 0 {
			newI18n[lang] = kept
		}
	}

	out, _ := json.Marshal(newI18n)
	if string(out) == "null" {
		return "{}"
	}
	return string(out)
}

// AITagSetDescription updates the description for a specific asset's ai_tags row.
func (s *Store) AITagSetDescription(key AITagSetForAssetKey, description string) error {
	if key.ProjectID == "" || key.RepoPath == "" {
		return fmt.Errorf("aitag set description: projectID and repoPath must be non-empty")
	}

	res, err := s.db.Exec(`
		UPDATE ai_tags SET description = ?, updated_at = datetime('now')
		WHERE project_id = ? AND repo_path = ? AND content_hash = ? AND hash_algorithm = ? AND status = 'ready'
	`, description, key.ProjectID, key.RepoPath, key.ContentHash, key.HashAlgorithm)
	if err != nil {
		return fmt.Errorf("aitag set description: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		_, err = s.db.Exec(`
			INSERT INTO ai_tags (project_id, repo_path, content_hash, hash_algorithm, status, tags_json, category, description, provider_name, model_name, updated_at)
			VALUES (?, ?, ?, ?, 'ready', '[]', '', ?, 'manual', 'user', datetime('now'))
		`, key.ProjectID, key.RepoPath, key.ContentHash, key.HashAlgorithm, description)
		if err != nil {
			return fmt.Errorf("aitag set description insert: %w", err)
		}
	}
	return nil
}

// AITagSuggest returns tag values matching the given prefix for autocomplete.
func (s *Store) AITagSuggest(prefix string, limit int) ([]string, error) {
	return s.AITagSuggestForProjects(prefix, limit, nil)
}

func (s *Store) AITagSuggestForProjects(prefix string, limit int, projectIDs []string) ([]string, error) {
	if limit <= 0 {
		limit = 10
	}
	if projectIDs != nil && len(projectIDs) == 0 {
		return []string{}, nil
	}

	low := strings.ToLower(prefix)
	where := []string{"at.status = 'ready'", "(t.value LIKE ? || '%' OR LOWER(at.tags_i18n_json) LIKE '%' || ? || '%')"}
	args := []any{low, low}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("at.project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	args = append(args, limit)
	rows, err := s.rdb.Query(`
		SELECT DISTINCT t.value
		FROM ai_tags at, json_each(at.tags_json) t
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY t.value
		LIMIT ?
	`, args...)
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
	return s.AITagCategoriesForProjects(nil)
}

func (s *Store) AITagCategoriesForProjects(projectIDs []string) ([]string, error) {
	if projectIDs != nil && len(projectIDs) == 0 {
		return []string{}, nil
	}
	where := []string{"status = 'ready'", "category != ''"}
	args := []any{}
	if projectIDs != nil {
		projectClause, projectArgs := inClauseSQL("project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
	rows, err := s.rdb.Query(`
		SELECT DISTINCT category FROM ai_tags
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY category
	`, args...)
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

func (s *Store) aiTagStats(projectFilter string, projectIDs []string) (taggedAssets int, topCategory string, err error) {
	var where []string
	var args []any
	where = append(where, "at.status = 'ready'")
	if projectIDs != nil {
		if len(projectIDs) == 0 {
			return 0, "", nil
		}
		projectClause, projectArgs := inClauseSQL("at.project_id", projectIDs)
		where = append(where, projectClause)
		args = append(args, projectArgs...)
	}
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

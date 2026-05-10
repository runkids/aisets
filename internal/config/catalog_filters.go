package config

import (
	"fmt"
	"strings"

	"aisets/internal/aitag"
	"aisets/internal/apierr"
	"aisets/internal/optimize"
)

func (s *Store) customCatalogFilterSQL(id string) (string, []any, error) {
	settings, err := s.Settings()
	if err != nil {
		return "", nil, err
	}
	return customCatalogFilterSQLForFilters(id, settings.CustomAssetFilters)
}

func customCatalogFilterSQLForFilters(id string, filters []CustomAssetFilter) (string, []any, error) {
	var selected *CustomAssetFilter
	for index := range filters {
		filter := filters[index]
		if filter.ID == id && filter.Enabled {
			selected = &filter
			break
		}
	}
	if selected == nil {
		return "", nil, nil
	}
	groupClauses := []string{}
	args := []any{}
	for _, group := range selected.Groups {
		parts := []string{}
		for _, clause := range group.Clauses {
			sqlClause, sqlArgs, err := catalogCustomClauseSQL(clause)
			if err != nil {
				return "", nil, err
			}
			parts = append(parts, sqlClause)
			args = append(args, sqlArgs...)
		}
		if len(parts) > 0 {
			groupClauses = append(groupClauses, "("+strings.Join(parts, " AND ")+")")
		}
	}
	if len(groupClauses) == 0 {
		return "", nil, nil
	}
	return "(" + strings.Join(groupClauses, " OR ") + ")", args, nil
}

func (s *Store) catalogItemFacets(scanID int64, query CatalogItemQuery) (CatalogItemFacets, error) {
	settings, err := s.Settings()
	if err != nil {
		return CatalogItemFacets{}, err
	}
	projectQuery := query
	projectQuery.ProjectName = ""
	projects, projectTotal, err := s.catalogFacetCounts(scanID, projectQuery, "a.project_name")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	extQuery := query
	extQuery.Ext = ""
	extensions, extensionTotal, err := s.catalogFacetCounts(scanID, extQuery, "a.ext")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	customQuery := query
	customQuery.CustomFilterID = ""
	_, customTotal, err := s.catalogFacetCounts(scanID, customQuery, "''")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	categoryQuery := query
	categoryQuery.OptimizationCategory = ""
	categories, _, err := s.catalogOptimizationFacetCounts(scanID, categoryQuery, "o.category")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	severityQuery := query
	severityQuery.OptimizationSeverity = ""
	severities, _, err := s.catalogMaxSeverityFacetCounts(scanID, severityQuery)
	if err != nil {
		return CatalogItemFacets{}, err
	}
	operationQuery := query
	operationQuery.Operation = ""
	operations, _, err := s.catalogOptimizationFacetCounts(scanID, operationQuery, optimize.OperationSQL("o.suggestion_code", "a.ext"))
	if err != nil {
		return CatalogItemFacets{}, err
	}
	optimizationTotal, err := s.catalogItemTotalForStatus(scanID, query, "optimizable")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	optimizationPendingTotal, err := s.catalogItemTotalForStatus(scanID, query, "optimizationPending")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	optimizationDoneTotal, err := s.catalogItemTotalForStatus(scanID, query, "optimized")
	if err != nil {
		return CatalogItemFacets{}, err
	}
	aiCatQuery := query
	aiCatQuery.AICategory = ""
	aiCategories, aiCategoryTotal, err := s.catalogAITagFacetCounts(scanID, aiCatQuery)
	if err != nil {
		return CatalogItemFacets{}, err
	}
	ocrReadyCount, err := s.catalogOCRReadyCount(scanID, query)
	if err != nil {
		return CatalogItemFacets{}, err
	}
	vlmEngineVersion := ""
	if settings.LLMProvider != "" && settings.LLMVisionModel != "" {
		vlmEngineVersion = settings.LLMProvider + "/" + settings.LLMVisionModel
	}
	vlmOcrReadyCount, err := s.catalogVLMOcrReadyCount(scanID, query, vlmEngineVersion)
	if err != nil {
		return CatalogItemFacets{}, err
	}
	aiTagReadyCount, err := s.catalogAITagReadyCount(scanID, query)
	if err != nil {
		return CatalogItemFacets{}, err
	}
	customFilters := make([]CatalogCustomFilterFacet, 0, len(settings.CustomAssetFilters))
	for _, filter := range settings.CustomAssetFilters {
		if !filter.Enabled {
			continue
		}
		filterQuery := customQuery
		filterQuery.CustomFilterID = filter.ID
		where, args, err := s.catalogItemWhere(scanID, filterQuery)
		if err != nil {
			return CatalogItemFacets{}, err
		}
		var count int
		if err := s.rdb.QueryRow("SELECT COUNT(*) FROM asset_snapshots a "+where, args...).Scan(&count); err != nil {
			return CatalogItemFacets{}, err
		}
		customFilters = append(customFilters, CatalogCustomFilterFacet{
			ID:      filter.ID,
			Label:   filter.Name,
			Count:   count,
			UsesOCR: customFilterUsesOCR(filter),
			UsesAI:  customFilterUsesAI(filter),
		})
	}
	return CatalogItemFacets{
		Projects:                 projects,
		ProjectTotal:             projectTotal,
		Extensions:               extensions,
		ExtensionTotal:           extensionTotal,
		OptimizationCategories:   categories,
		OptimizationSeverities:   severities,
		Operations:               operations,
		OptimizationTotal:        optimizationTotal,
		OptimizationPendingTotal: optimizationPendingTotal,
		OptimizationDoneTotal:    optimizationDoneTotal,
		CustomFilters:            customFilters,
		CustomFilterTotal:        customTotal,
		AICategories:             aiCategories,
		AICategoryTotal:          aiCategoryTotal,
		OCRReadyCount:            ocrReadyCount,
		VLMOcrReadyCount:         vlmOcrReadyCount,
		AITagReadyCount:          aiTagReadyCount,
	}, nil
}

func (s *Store) catalogItemTotalForStatus(scanID int64, query CatalogItemQuery, status string) (int, error) {
	statusQuery := query
	statusQuery.Status = status
	where, args, err := s.catalogItemWhere(scanID, statusQuery)
	if err != nil {
		return 0, err
	}
	var total int
	if err := s.rdb.QueryRow("SELECT COUNT(*) FROM asset_snapshots a "+where, args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (s *Store) catalogFacetCounts(scanID int64, query CatalogItemQuery, expr string) ([]CatalogFacetOption, int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return nil, 0, err
	}
	var total int
	if err := s.rdb.QueryRow("SELECT COUNT(*) FROM asset_snapshots a "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.rdb.Query(`
		SELECT `+expr+` AS id, COUNT(*)
		FROM asset_snapshots a
		`+where+`
		GROUP BY id
		ORDER BY COUNT(*) DESC, id ASC
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	options := []CatalogFacetOption{}
	for rows.Next() {
		var option CatalogFacetOption
		if err := rows.Scan(&option.ID, &option.Count); err != nil {
			return nil, 0, err
		}
		if option.ID != "" {
			options = append(options, option)
		}
	}
	return options, total, rows.Err()
}

func (s *Store) catalogOptimizationFacetCounts(scanID int64, query CatalogItemQuery, expr string) ([]CatalogFacetOption, int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.rdb.Query(`
		SELECT `+expr+` AS id, COUNT(DISTINCT a.asset_id)
		FROM asset_snapshots a
		JOIN optimization_snapshots o ON o.scan_id = a.scan_id AND o.asset_id = a.asset_id
		`+where+`
		GROUP BY id
		ORDER BY COUNT(DISTINCT a.asset_id) DESC, id ASC
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	options := []CatalogFacetOption{}
	for rows.Next() {
		var option CatalogFacetOption
		if err := rows.Scan(&option.ID, &option.Count); err != nil {
			return nil, 0, err
		}
		if option.ID != "" {
			options = append(options, option)
		}
	}
	return options, 0, rows.Err()
}

func (s *Store) catalogMaxSeverityFacetCounts(scanID int64, query CatalogItemQuery) ([]CatalogFacetOption, int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.rdb.Query(`
		SELECT max_sev, COUNT(*) FROM (
			SELECT a.asset_id,
				CASE MAX(CASE o.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END)
					WHEN 3 THEN 'critical' WHEN 2 THEN 'warning' WHEN 1 THEN 'info' ELSE '' END AS max_sev
			FROM asset_snapshots a
			JOIN optimization_snapshots o ON o.scan_id = a.scan_id AND o.asset_id = a.asset_id
			`+where+`
			GROUP BY a.asset_id
		) sub
		WHERE max_sev != ''
		GROUP BY max_sev
		ORDER BY COUNT(*) DESC, max_sev ASC
	`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	options := []CatalogFacetOption{}
	for rows.Next() {
		var option CatalogFacetOption
		if err := rows.Scan(&option.ID, &option.Count); err != nil {
			return nil, 0, err
		}
		options = append(options, option)
	}
	return options, 0, rows.Err()
}

func (s *Store) catalogAITagFacetCounts(scanID int64, query CatalogItemQuery) ([]CatalogFacetOption, int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return nil, 0, err
	}
	facetArgs := append([]any{aitag.StatusReady}, args...)
	rows, err := s.rdb.Query(`
		SELECT ait.category AS id, COUNT(DISTINCT a.asset_id)
		FROM asset_snapshots a
		JOIN ai_tags ait ON ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND ait.status = ?
		`+where+`
		GROUP BY id
		ORDER BY COUNT(DISTINCT a.asset_id) DESC, id ASC
	`, facetArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	options := []CatalogFacetOption{}
	total := 0
	for rows.Next() {
		var option CatalogFacetOption
		if err := rows.Scan(&option.ID, &option.Count); err != nil {
			return nil, 0, err
		}
		if option.ID != "" {
			options = append(options, option)
			total += option.Count
		}
	}
	return options, total, rows.Err()
}

func (s *Store) catalogOCRReadyCount(scanID int64, query CatalogItemQuery) (int, error) {
	return s.catalogOCRReadyCountByEngine(scanID, query, "")
}

func (s *Store) catalogVLMOcrReadyCount(scanID int64, query CatalogItemQuery, engineVersion string) (int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return 0, err
	}
	versionClause := ""
	facetArgs := append([]any{"ready", "vlm"}, args...)
	if engineVersion != "" {
		versionClause = "\n\t\t\tAND ocr.engine_version = ?"
		facetArgs = append([]any{"ready", "vlm", engineVersion}, args...)
	}
	var count int
	err = s.rdb.QueryRow(`
		SELECT COUNT(DISTINCT a.asset_id)
		FROM asset_snapshots a
		JOIN ocr_results ocr ON ocr.project_id = a.project_id
			AND ocr.repo_path = a.repo_path
			AND ocr.content_hash = a.content_hash
			AND ocr.hash_algorithm = a.hash_algorithm
			AND ocr.status = ?
			AND ocr.engine_name = ?`+versionClause+`
		`+where, facetArgs...).Scan(&count)
	return count, err
}

func (s *Store) catalogOCRReadyCountByEngine(scanID int64, query CatalogItemQuery, engineName string) (int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return 0, err
	}
	engineClause := ""
	facetArgs := append([]any{"ready"}, args...)
	if engineName != "" {
		engineClause = "\n\t\t\tAND ocr.engine_name = ?"
		facetArgs = append([]any{"ready", engineName}, args...)
	}
	var count int
	err = s.rdb.QueryRow(`
		SELECT COUNT(DISTINCT a.asset_id)
		FROM asset_snapshots a
		JOIN ocr_results ocr ON ocr.project_id = a.project_id
			AND ocr.repo_path = a.repo_path
			AND ocr.content_hash = a.content_hash
			AND ocr.hash_algorithm = a.hash_algorithm
			AND ocr.status = ?`+engineClause+`
		`+where, facetArgs...).Scan(&count)
	return count, err
}

func (s *Store) catalogAITagReadyCount(scanID int64, query CatalogItemQuery) (int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return 0, err
	}
	facetArgs := append([]any{aitag.StatusReady}, args...)
	var count int
	err = s.rdb.QueryRow(`
		SELECT COUNT(DISTINCT a.asset_id)
		FROM asset_snapshots a
		JOIN ai_tags ait ON ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND ait.status = ?
		`+where, facetArgs...).Scan(&count)
	return count, err
}

func customFilterUsesOCR(filter CustomAssetFilter) bool {
	for _, group := range filter.Groups {
		for _, clause := range group.Clauses {
			switch clause.Field {
			case "ocrText", "ocrLanguage", "ocrScript", "ocrConfidence", "ocrStatus":
				return true
			}
		}
	}
	return false
}

func customFilterUsesAI(filter CustomAssetFilter) bool {
	for _, group := range filter.Groups {
		for _, clause := range group.Clauses {
			switch clause.Field {
			case "aiCategory", "aiTag", "aiDescription", "aiStatus":
				return true
			}
		}
	}
	return false
}

func catalogCustomClauseSQL(clause CustomAssetFilterClause) (string, []any, error) {
	value := strings.TrimSpace(clause.Value)
	switch clause.Field {
	case "path":
		return textClauseSQL("a.repo_path", clause.Operator, value)
	case "folder":
		return textClauseSQL("asset_folder(a.repo_path)", clause.Operator, value)
	case "extension":
		if clause.Operator == "equals" {
			return "LOWER(a.ext) = ?", []any{normalizeCatalogExt(value)}, nil
		}
		sqlClause, args := inClauseSQL("LOWER(a.ext)", normalizedExtList(value))
		return sqlClause, args, nil
	case "project":
		if clause.Operator == "oneOf" {
			sqlClause, args := inClauseSQL("LOWER(a.project_name)", lowerList(value))
			return sqlClause, args, nil
		}
		return textClauseSQL("a.project_name", clause.Operator, value)
	case "bytes":
		if clause.Operator == "gte" {
			return "a.bytes >= ?", []any{value}, nil
		}
		return "a.bytes <= ?", []any{value}, nil
	case "status":
		if value == "unused" {
			return "a.usage_classification = 'unused'", nil, nil
		}
		return "a.usage_classification = 'referenced'", nil, nil
	case "duplicate":
		return booleanExistsSQL("EXISTS (SELECT 1 FROM duplicate_group_assets d3 WHERE d3.scan_id = a.scan_id AND d3.asset_id = a.asset_id)", value), nil, nil
	case "nearDuplicate":
		return booleanExistsSQL("EXISTS (SELECT 1 FROM near_duplicate_snapshots n2 WHERE n2.scan_id = a.scan_id AND (n2.left_id = a.asset_id OR n2.right_id = a.asset_id))", value), nil, nil
	case "optimizable":
		return booleanExistsSQL("EXISTS (SELECT 1 FROM optimization_snapshots o2 WHERE o2.scan_id = a.scan_id AND o2.asset_id = a.asset_id)", value), nil, nil
	case "ocrText":
		return ocrExistsSQL(textClauseSQL("COALESCE(ocr.normalized_text, ocr.text, '')", clause.Operator, value))
	case "ocrLanguage":
		if clause.Operator == "oneOf" {
			return ocrJSONListExistsSQL("ocr.languages_json", lowerList(value)), nil, nil
		}
		return ocrJSONListExistsSQL("ocr.languages_json", []string{strings.ToLower(value)}), nil, nil
	case "ocrScript":
		if clause.Operator == "oneOf" {
			return ocrJSONListExistsSQL("ocr.scripts_json", lowerList(value)), nil, nil
		}
		return ocrJSONListExistsSQL("ocr.scripts_json", []string{strings.ToLower(value)}), nil, nil
	case "ocrConfidence":
		if clause.Operator == "gte" {
			return ocrExistsSQL("ocr.confidence >= ?", []any{value}, nil)
		}
		return ocrExistsSQL("ocr.confidence <= ?", []any{value}, nil)
	case "ocrStatus":
		return ocrExistsSQL("ocr.status = ?", []any{value}, nil)
	case "aiCategory":
		return aiTagExistsSQL(textClauseSQL("ait.category", clause.Operator, value))
	case "aiTag":
		if clause.Operator == "oneOf" {
			return aiTagJSONListContainsSQL("ait.tags_json", lowerList(value)), nil, nil
		}
		return aiTagJSONContainsSQL("ait.tags_json", strings.ToLower(value)), nil, nil
	case "aiDescription":
		if clause.Operator == "oneOf" {
			return aiTagTextContainsAnySQL("COALESCE(ait.description, '')", lowerList(value)), nil, nil
		}
		return aiTagExistsSQL(textClauseSQL("COALESCE(ait.description, '')", clause.Operator, value))
	case "aiStatus":
		if value == "none" {
			return aiTagNotExistsSQL(), nil, nil
		}
		return aiTagExistsSQL("ait.status = ?", []any{value}, nil)
	default:
		return "", nil, apierr.WithParams("custom_filter_field_invalid", "custom filter field is invalid", map[string]any{"field": clause.Field})
	}
}

func textClauseSQL(expr, operator, value string) (string, []any, error) {
	switch operator {
	case "contains":
		return "LOWER(" + expr + ") LIKE ? ESCAPE '\\'", []any{"%" + escapeLike(strings.ToLower(value)) + "%"}, nil
	case "prefix":
		return "LOWER(" + expr + ") LIKE ? ESCAPE '\\'", []any{escapeLike(strings.ToLower(value)) + "%"}, nil
	case "suffix":
		return "LOWER(" + expr + ") LIKE ? ESCAPE '\\'", []any{"%" + escapeLike(strings.ToLower(value))}, nil
	case "equals":
		return "LOWER(" + expr + ") = ?", []any{strings.ToLower(value)}, nil
	case "regex":
		return "regexp_like(" + expr + ", ?)", []any{value}, nil
	default:
		return "", nil, apierr.WithParams("custom_filter_operator_invalid", "custom filter operator is invalid", map[string]any{"operator": operator})
	}
}

func inClauseSQL(expr string, values []string) (string, []any) {
	if len(values) == 0 {
		return "0 = 1", nil
	}
	placeholders := make([]string, len(values))
	args := make([]any, len(values))
	for index, value := range values {
		placeholders[index] = "?"
		args[index] = value
	}
	return expr + " IN (" + strings.Join(placeholders, ",") + ")", args
}

func booleanExistsSQL(existsExpr, value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "true") {
		return existsExpr
	}
	return "NOT " + existsExpr
}

func ocrExistsSQL(clause string, args []any, err error) (string, []any, error) {
	if err != nil {
		return "", nil, err
	}
	return `EXISTS (
		SELECT 1 FROM ocr_results ocr
		WHERE ocr.project_id = a.project_id
			AND ocr.repo_path = a.repo_path
			AND ocr.content_hash = a.content_hash
			AND ocr.hash_algorithm = a.hash_algorithm
			AND ` + clause + `
	)`, args, nil
}

func ocrJSONListExistsSQL(expr string, values []string) string {
	if len(values) == 0 {
		return "0 = 1"
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("LOWER(%s) LIKE '%%\"%s\"%%'", expr, strings.ReplaceAll(value, "'", "''")))
	}
	return `EXISTS (
		SELECT 1 FROM ocr_results ocr
		WHERE ocr.project_id = a.project_id
			AND ocr.repo_path = a.repo_path
			AND ocr.content_hash = a.content_hash
			AND ocr.hash_algorithm = a.hash_algorithm
			AND (` + strings.Join(parts, " OR ") + `)
	)`
}

func aiTagExistsSQL(clause string, args []any, err error) (string, []any, error) {
	if err != nil {
		return "", nil, err
	}
	return `EXISTS (
		SELECT 1 FROM ai_tags ait
		WHERE ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND ` + clause + `
	)`, args, nil
}

func aiTagNotExistsSQL() string {
	return `NOT EXISTS (
		SELECT 1 FROM ai_tags ait
		WHERE ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
	)`
}

func aiTagJSONContainsSQL(expr, value string) string {
	return fmt.Sprintf(`EXISTS (
		SELECT 1 FROM ai_tags ait
		WHERE ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND LOWER(%s) LIKE '%%"%s"%%'
	)`, expr, strings.ReplaceAll(value, "'", "''"))
}

func aiTagTextContainsAnySQL(expr string, keywords []string) string {
	if len(keywords) == 0 {
		return "0 = 1"
	}
	parts := make([]string, 0, len(keywords))
	for _, kw := range keywords {
		escaped := strings.ReplaceAll(kw, "'", "''")
		parts = append(parts, fmt.Sprintf("regexp_like(%s, '(?i)\\b%s\\b')", expr, escaped))
	}
	return `EXISTS (
		SELECT 1 FROM ai_tags ait
		WHERE ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND (` + strings.Join(parts, " OR ") + `)
	)`
}

func aiTagJSONListContainsSQL(expr string, values []string) string {
	if len(values) == 0 {
		return "0 = 1"
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("LOWER(%s) LIKE '%%\"%s\"%%'", expr, strings.ReplaceAll(value, "'", "''")))
	}
	return `EXISTS (
		SELECT 1 FROM ai_tags ait
		WHERE ait.project_id = a.project_id
			AND ait.repo_path = a.repo_path
			AND ait.content_hash = a.content_hash
			AND ait.hash_algorithm = a.hash_algorithm
			AND (` + strings.Join(parts, " OR ") + `)
	)`
}

func normalizedExtList(value string) []string {
	parts := splitCustomFilterList(value)
	for index := range parts {
		parts[index] = normalizeCatalogExt(parts[index])
	}
	return parts
}

func lowerList(value string) []string {
	parts := splitCustomFilterList(value)
	for index := range parts {
		parts[index] = strings.ToLower(parts[index])
	}
	return parts
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func (s *Store) catalogItemWhere(scanID int64, query CatalogItemQuery) (string, []any, error) {
	clauses := []string{"a.scan_id = ?"}
	args := []any{scanID}
	if strings.TrimSpace(query.AssetID) != "" {
		clauses = append(clauses, "a.asset_id = ?")
		args = append(args, strings.TrimSpace(query.AssetID))
	}
	if strings.TrimSpace(query.ProjectID) != "" {
		clauses = append(clauses, "a.project_id = ?")
		args = append(args, strings.TrimSpace(query.ProjectID))
	}
	if strings.TrimSpace(query.ProjectName) != "" {
		clauses = append(clauses, "a.project_name = ?")
		args = append(args, strings.TrimSpace(query.ProjectName))
	}
	if ext := normalizeCatalogExt(query.Ext); ext != "" {
		clauses = append(clauses, "LOWER(a.ext) = ?")
		args = append(args, ext)
	}
	if folder := normalizeCatalogFolder(query.Folder); folder != "" {
		clauses = append(clauses, "a.repo_path LIKE ? ESCAPE '\\'")
		args = append(args, escapeLike(folder)+"/%")
	}
	if q := strings.TrimSpace(query.Query); q != "" {
		clauses = append(clauses, `(a.repo_path LIKE ? OR a.project_name LIKE ? OR EXISTS (
			SELECT 1 FROM ocr_results oq
			WHERE oq.project_id = a.project_id
				AND oq.repo_path = a.repo_path
				AND oq.content_hash = a.content_hash
				AND oq.hash_algorithm = a.hash_algorithm
				AND (oq.normalized_text LIKE ? OR oq.text LIKE ? OR ocr_search_match(COALESCE(oq.normalized_text, oq.text, ''), ?) = 1)
		) OR EXISTS (
			SELECT 1 FROM ai_tags ait2
			WHERE ait2.project_id = a.project_id
				AND ait2.repo_path = a.repo_path
				AND ait2.content_hash = a.content_hash
				AND ait2.hash_algorithm = a.hash_algorithm
				AND ait2.status = ?
				AND (ait2.tags_json LIKE ? OR ait2.description LIKE ?)
		))`)
		like := "%" + q + "%"
		args = append(args, like, like, like, like, q, aitag.StatusReady, like, like)
	}
	switch strings.TrimSpace(query.Status) {
	case "unused":
		clauses = append(clauses, "a.usage_classification = 'unused'")
	case "possiblyUnused":
		clauses = append(clauses, "a.usage_classification = 'possiblyUnused'")
	case "notApplicable":
		clauses = append(clauses, "a.usage_classification = 'notApplicable'")
	case "referenced":
		clauses = append(clauses, "a.usage_classification = 'referenced'")
	case "duplicate":
		clauses = append(clauses, `(EXISTS (
			SELECT 1 FROM duplicate_group_assets d2
			WHERE d2.scan_id = a.scan_id AND d2.asset_id = a.asset_id
		) OR EXISTS (
			SELECT 1 FROM near_duplicate_snapshots n
			WHERE n.scan_id = a.scan_id AND (n.left_id = a.asset_id OR n.right_id = a.asset_id)
		))`)
	case "optimizable":
		clauses = append(clauses, "EXISTS (SELECT 1 FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)")
	case "optimized":
		clauses = append(clauses, `(EXISTS (SELECT 1 FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)
			AND NOT EXISTS (SELECT 1 FROM optimization_snapshots o2 WHERE o2.scan_id = a.scan_id AND o2.asset_id = a.asset_id AND o2.has_existing_variant = 0))`)
	case "optimizationPending":
		clauses = append(clauses, `(EXISTS (SELECT 1 FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)
			AND EXISTS (SELECT 1 FROM optimization_snapshots o2 WHERE o2.scan_id = a.scan_id AND o2.asset_id = a.asset_id AND o2.has_existing_variant = 0))`)
	case "nearDuplicate":
		clauses = append(clauses, "EXISTS (SELECT 1 FROM near_duplicate_snapshots n WHERE n.scan_id = a.scan_id AND (n.left_id = a.asset_id OR n.right_id = a.asset_id))")
	}
	if category := strings.TrimSpace(query.OptimizationCategory); category != "" {
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM optimization_snapshots oc
			WHERE oc.scan_id = a.scan_id AND oc.asset_id = a.asset_id AND oc.category = ?
		)`)
		args = append(args, category)
	}
	if severity := strings.TrimSpace(query.OptimizationSeverity); severity != "" {
		clauses = append(clauses, `(
			SELECT MAX(CASE os.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END)
			FROM optimization_snapshots os
			WHERE os.scan_id = a.scan_id AND os.asset_id = a.asset_id
		) = ?`)
		args = append(args, severityFilterRank(severity))
	}
	if operation := strings.TrimSpace(query.Operation); operation != "" {
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM optimization_snapshots oo
			WHERE oo.scan_id = a.scan_id
				AND oo.asset_id = a.asset_id
				AND `+optimize.OperationSQL("oo.suggestion_code", "a.ext")+` = ?
		)`)
		args = append(args, operation)
	}
	if customFilterID := strings.TrimSpace(query.CustomFilterID); customFilterID != "" {
		clause, filterArgs, err := s.customCatalogFilterSQL(customFilterID)
		if err != nil {
			return "", nil, err
		}
		if clause != "" {
			clauses = append(clauses, clause)
			args = append(args, filterArgs...)
		}
	}
	if aiCategory := strings.TrimSpace(query.AICategory); aiCategory != "" {
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM ai_tags ait
			WHERE ait.project_id = a.project_id
				AND ait.repo_path = a.repo_path
				AND ait.content_hash = a.content_hash
				AND ait.hash_algorithm = a.hash_algorithm
				AND ait.status = ?
				AND ait.category = ?
		)`)
		args = append(args, aitag.StatusReady, aiCategory)
	}
	switch query.AIOcrStatus {
	case "ocrReady":
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM ocr_results ocr
			WHERE ocr.project_id = a.project_id AND ocr.repo_path = a.repo_path
				AND ocr.content_hash = a.content_hash AND ocr.hash_algorithm = a.hash_algorithm
				AND ocr.status = 'ready'
		)`)
	case "ocrPending":
		clauses = append(clauses, `NOT EXISTS (
			SELECT 1 FROM ocr_results ocr
			WHERE ocr.project_id = a.project_id AND ocr.repo_path = a.repo_path
				AND ocr.content_hash = a.content_hash AND ocr.hash_algorithm = a.hash_algorithm
				AND ocr.status = 'ready'
		)`)
	case "vlmOcrReady":
		versionClause := ""
		if query.VLMEngineVersion != "" {
			versionClause = " AND ocr.engine_version = ?"
			args = append(args, query.VLMEngineVersion)
		}
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM ocr_results ocr
			WHERE ocr.project_id = a.project_id AND ocr.repo_path = a.repo_path
				AND ocr.content_hash = a.content_hash AND ocr.hash_algorithm = a.hash_algorithm
				AND ocr.engine_name = 'vlm' AND ocr.status = 'ready'`+versionClause+`
		)`)
	case "vlmOcrPending":
		versionClause := ""
		if query.VLMEngineVersion != "" {
			versionClause = " AND ocr.engine_version = ?"
			args = append(args, query.VLMEngineVersion)
		}
		clauses = append(clauses, `NOT EXISTS (
			SELECT 1 FROM ocr_results ocr
			WHERE ocr.project_id = a.project_id AND ocr.repo_path = a.repo_path
				AND ocr.content_hash = a.content_hash AND ocr.hash_algorithm = a.hash_algorithm
				AND ocr.engine_name = 'vlm' AND ocr.status = 'ready'`+versionClause+`
		)`)
	case "aiTagReady":
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM ai_tags ait2
			WHERE ait2.project_id = a.project_id AND ait2.repo_path = a.repo_path
				AND ait2.content_hash = a.content_hash AND ait2.hash_algorithm = a.hash_algorithm
				AND ait2.status = ?
		)`)
		args = append(args, aitag.StatusReady)
	case "aiTagPending":
		clauses = append(clauses, `NOT EXISTS (
			SELECT 1 FROM ai_tags ait2
			WHERE ait2.project_id = a.project_id AND ait2.repo_path = a.repo_path
				AND ait2.content_hash = a.content_hash AND ait2.hash_algorithm = a.hash_algorithm
				AND ait2.status = ?
		)`)
		args = append(args, aitag.StatusReady)
	}
	return "WHERE " + strings.Join(clauses, " AND "), args, nil
}

func severityFilterRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warning":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

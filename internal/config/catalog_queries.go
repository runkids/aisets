package config

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"asset-studio/internal/apierr"
	"asset-studio/internal/lint"
	"asset-studio/internal/scanner"
)

const catalogItemsLimitMax = 200

type CatalogSummary struct {
	ScanID       int64                   `json:"scanId"`
	GeneratedAt  string                  `json:"generatedAt"`
	Projects     []Project               `json:"projects"`
	ProjectStats []CatalogProjectStats   `json:"projectStats"`
	Stats        scanner.CatalogStats    `json:"stats"`
	Analysis     scanner.CatalogAnalysis `json:"analysis"`
}

type CatalogProjectStats struct {
	ProjectID        string `json:"projectId"`
	TotalFiles       int    `json:"totalFiles"`
	TotalBytes       int64  `json:"totalBytes"`
	UnusedFiles      int    `json:"unusedFiles"`
	DuplicateFiles   int    `json:"duplicateFiles"`
	OptimizableFiles int    `json:"optimizableFiles"`
	LintFindings     int    `json:"lintFindings"`
}

type CatalogItemQuery struct {
	ScanID         int64
	AssetID        string
	ProjectID      string
	ProjectName    string
	Ext            string
	Folder         string
	Query          string
	Status         string
	Sort           string
	CustomFilterID string
	Limit          int
	Cursor         string
}

type CatalogItemsPage struct {
	Items      []scanner.AssetItem `json:"items"`
	Total      int                 `json:"total"`
	NextCursor string              `json:"nextCursor,omitempty"`
	Facets     CatalogItemFacets   `json:"facets"`
}

type CatalogFacetOption struct {
	ID    string `json:"id"`
	Count int    `json:"count"`
}

type CatalogCustomFilterFacet struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Count   int    `json:"count"`
	UsesOCR bool   `json:"usesOCR"`
}

type CatalogItemFacets struct {
	Projects          []CatalogFacetOption       `json:"projects"`
	ProjectTotal      int                        `json:"projectTotal"`
	Extensions        []CatalogFacetOption       `json:"extensions"`
	ExtensionTotal    int                        `json:"extensionTotal"`
	CustomFilters     []CatalogCustomFilterFacet `json:"customFilters"`
	CustomFilterTotal int                        `json:"customFilterTotal"`
}

type CatalogFolderQuery struct {
	ScanID         int64
	ProjectID      string
	ProjectName    string
	Ext            string
	Folder         string
	Query          string
	Status         string
	CustomFilterID string
}

type CatalogFolderNode struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Count       int    `json:"count"`
	HasChildren bool   `json:"hasChildren"`
}

type CatalogFoldersPage struct {
	Folders []CatalogFolderNode `json:"folders"`
	Total   int                 `json:"total"`
}

type CatalogItemDetail struct {
	Item         scanner.AssetItem                `json:"item"`
	References   []scanner.AssetReference         `json:"references"`
	Duplicates   []scanner.AssetItem              `json:"duplicates"`
	Similar      []scanner.NearDuplicate          `json:"similar"`
	SimilarItems []scanner.AssetItem              `json:"similarItems"`
	Optimization []scanner.OptimizationSuggestion `json:"optimization"`
	OCR          any                              `json:"ocr,omitempty"`
}

type CatalogDuplicatesPage struct {
	Groups     []scanner.DuplicateGroup `json:"groups"`
	Pairs      []scanner.NearDuplicate  `json:"pairs"`
	Total      int                      `json:"total"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}

type CatalogLintQuery struct {
	ScanID   int64
	Severity string
	Limit    int
	Cursor   string
}

type CatalogLintPage struct {
	Items      []lint.Finding `json:"items"`
	Total      int            `json:"total"`
	NextCursor string         `json:"nextCursor,omitempty"`
}

func (s *Store) LatestScan() (ScanSummary, error) {
	row := s.db.QueryRow(`
		SELECT id, started_at, COALESCE(completed_at, ''), status, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits,
			scan_profile, references_state, near_duplicates_state, optimization_state
		FROM scans
		WHERE status = 'completed'
		ORDER BY completed_at DESC, id DESC
		LIMIT 1
	`)
	scan, err := scanSummaryFromRows(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ScanSummary{}, apierr.New("scan_not_found", "scan not found")
	}
	return scan, err
}

func (s *Store) CatalogSummary() (CatalogSummary, error) {
	scan, err := s.LatestScan()
	if err != nil {
		return CatalogSummary{}, err
	}
	projects := s.Projects()
	projectStats, err := s.catalogProjectStats(scan.ID, projects)
	if err != nil {
		return CatalogSummary{}, err
	}
	return CatalogSummary{
		ScanID:       scan.ID,
		GeneratedAt:  scan.CompletedAt,
		Projects:     projects,
		ProjectStats: projectStats,
		Stats: scanner.CatalogStats{
			TotalFiles:      scan.TotalFiles,
			DuplicateGroups: scan.DuplicateGroups,
			DuplicateFiles:  scan.DuplicateFiles,
			UnusedFiles:     scan.UnusedFiles,
			NearDuplicates:  scan.NearDuplicates,
			CacheHits:       scan.CacheHits,
		},
		Analysis: scan.Analysis,
	}, nil
}

func (s *Store) catalogProjectStats(scanID int64, projects []Project) ([]CatalogProjectStats, error) {
	stats := map[string]CatalogProjectStats{}
	rows, err := s.db.Query(`
		SELECT a.project_id,
			COUNT(*),
			COALESCE(SUM(a.bytes), 0),
			COALESCE(SUM(CASE WHEN a.used_count = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN EXISTS (
				SELECT 1 FROM duplicate_group_assets d
				WHERE d.scan_id = a.scan_id AND d.asset_id = a.asset_id
			) THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN EXISTS (
				SELECT 1 FROM optimization_snapshots o
				WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id
			) THEN 1 ELSE 0 END), 0)
		FROM asset_snapshots a
		WHERE a.scan_id = ?
		GROUP BY a.project_id
	`, scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var stat CatalogProjectStats
		if err := rows.Scan(&stat.ProjectID, &stat.TotalFiles, &stat.TotalBytes, &stat.UnusedFiles, &stat.DuplicateFiles, &stat.OptimizableFiles); err != nil {
			return nil, err
		}
		stats[stat.ProjectID] = stat
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	lintRows, err := s.db.Query(`
		SELECT a.project_id, COUNT(*)
		FROM lint_snapshots l
		JOIN asset_snapshots a ON a.scan_id = l.scan_id AND a.asset_id = l.asset_id
		WHERE l.scan_id = ?
		GROUP BY a.project_id
	`, scanID)
	if err != nil {
		return nil, err
	}
	defer lintRows.Close()
	for lintRows.Next() {
		var projectID string
		var count int
		if err := lintRows.Scan(&projectID, &count); err != nil {
			return nil, err
		}
		stat := stats[projectID]
		stat.ProjectID = projectID
		stat.LintFindings = count
		stats[projectID] = stat
	}
	if err := lintRows.Err(); err != nil {
		return nil, err
	}
	out := make([]CatalogProjectStats, 0, len(projects))
	for _, project := range projects {
		stat := stats[project.ID]
		stat.ProjectID = project.ID
		out = append(out, stat)
	}
	return out, nil
}

func (s *Store) CatalogItems(query CatalogItemQuery) (CatalogItemsPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogItemsPage{}, err
	}
	limit := normalizeCatalogLimit(query.Limit)
	offset := parseCursorOffset(query.Cursor)
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return CatalogItemsPage{}, err
	}
	totalQuery := "SELECT COUNT(*) FROM asset_snapshots a " + where
	var total int
	if err := s.db.QueryRow(totalQuery, args...).Scan(&total); err != nil {
		return CatalogItemsPage{}, err
	}
	orderBy := catalogItemOrder(query.Sort)
	args = append(args, limit+1, offset)
	rows, err := s.db.Query(`
		SELECT a.asset_id, a.project_id, a.project_name, a.repo_path, a.local_path, a.ext,
			a.bytes, COALESCE(a.modified_unix, 0), COALESCE(a.content_hash, ''), COALESCE(a.hash_algorithm, ''), COALESCE(a.format, ''),
			a.width, a.height, a.animated, a.alpha, a.pages, COALESCE(a.dhash, ''), COALESCE(a.dhash_flipped, ''),
			a.used_count, COALESCE(d.group_id, ''), COALESCE(g.preferred_path, ''),
			(SELECT COUNT(*) FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)
		FROM asset_snapshots a
		LEFT JOIN duplicate_group_assets d ON d.scan_id = a.scan_id AND d.asset_id = a.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = a.scan_id AND g.group_id = d.group_id
		`+where+`
		`+orderBy+`
		LIMIT ? OFFSET ?
	`, args...)
	if err != nil {
		return CatalogItemsPage{}, err
	}
	defer rows.Close()
	items := []scanner.AssetItem{}
	for rows.Next() {
		item, err := scanAssetFromRow(rows)
		if err != nil {
			return CatalogItemsPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogItemsPage{}, err
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = strconv.Itoa(offset + limit)
	}
	facets, err := s.catalogItemFacets(scanID, query)
	if err != nil {
		return CatalogItemsPage{}, err
	}
	return CatalogItemsPage{Items: items, Total: total, NextCursor: next, Facets: facets}, nil
}

func (s *Store) CatalogFolders(query CatalogFolderQuery) (CatalogFoldersPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	parent := normalizeCatalogFolder(query.Folder)
	whereQuery := CatalogItemQuery{
		ScanID:         scanID,
		ProjectID:      query.ProjectID,
		ProjectName:    query.ProjectName,
		Ext:            query.Ext,
		Folder:         parent,
		Query:          query.Query,
		Status:         query.Status,
		CustomFilterID: query.CustomFilterID,
	}
	where, args, err := s.catalogItemWhere(scanID, whereQuery)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	rows, err := s.db.Query(`
		SELECT a.repo_path
		FROM asset_snapshots a
		`+where+`
		ORDER BY a.repo_path COLLATE NOCASE ASC, a.repo_path ASC
	`, args...)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	defer rows.Close()

	type folderAccumulator struct {
		name        string
		count       int
		hasChildren bool
	}
	total := 0
	folders := map[string]*folderAccumulator{}
	for rows.Next() {
		var repoPath string
		if err := rows.Scan(&repoPath); err != nil {
			return CatalogFoldersPage{}, err
		}
		total++
		childPath, childName, hasNestedChild := immediateChildFolder(parent, repoPath)
		if childPath == "" {
			continue
		}
		acc := folders[childPath]
		if acc == nil {
			acc = &folderAccumulator{name: childName}
			folders[childPath] = acc
		}
		acc.count++
		if hasNestedChild {
			acc.hasChildren = true
		}
	}
	if err := rows.Err(); err != nil {
		return CatalogFoldersPage{}, err
	}
	paths := make([]string, 0, len(folders))
	for path := range folders {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool {
		left := strings.ToLower(paths[i])
		right := strings.ToLower(paths[j])
		if left == right {
			return paths[i] < paths[j]
		}
		return left < right
	})
	out := make([]CatalogFolderNode, 0, len(paths))
	for _, path := range paths {
		acc := folders[path]
		out = append(out, CatalogFolderNode{
			ID:          path,
			Name:        acc.name,
			Path:        path,
			Count:       acc.count,
			HasChildren: acc.hasChildren,
		})
	}
	return CatalogFoldersPage{Folders: out, Total: total}, nil
}

func (s *Store) CatalogItem(scanID int64, assetID string) (scanner.AssetItem, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	row := s.db.QueryRow(`
		SELECT a.asset_id, a.project_id, a.project_name, a.repo_path, a.local_path, a.ext,
			a.bytes, COALESCE(a.modified_unix, 0), COALESCE(a.content_hash, ''), COALESCE(a.hash_algorithm, ''), COALESCE(a.format, ''),
			a.width, a.height, a.animated, a.alpha, a.pages, COALESCE(a.dhash, ''), COALESCE(a.dhash_flipped, ''),
			a.used_count, COALESCE(d.group_id, ''), COALESCE(g.preferred_path, ''),
			(SELECT COUNT(*) FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)
		FROM asset_snapshots a
		LEFT JOIN duplicate_group_assets d ON d.scan_id = a.scan_id AND d.asset_id = a.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = a.scan_id AND g.group_id = d.group_id
		WHERE a.scan_id = ? AND a.asset_id = ?
	`, scanID, assetID)
	item, err := scanAssetFromRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return scanner.AssetItem{}, apierr.WithParams("asset_not_found", "asset not found", map[string]any{"assetId": assetID})
	}
	return item, err
}

func (s *Store) CatalogItemDetail(scanID int64, assetID string) (CatalogItemDetail, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	item, err := s.CatalogItem(scanID, assetID)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	refs, err := s.assetReferences(scanID, assetID)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	item.References = refs
	item.UsedBy = uniqueReferenceFiles(refs)
	opts, err := s.assetOptimization(scanID, assetID)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	item.Optimization = opts
	dups, err := s.assetDuplicates(scanID, item)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	for _, dup := range dups {
		item.Duplicates = append(item.Duplicates, dup.RepoPath)
	}
	near, err := s.assetNearDuplicates(scanID, assetID)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	for _, pair := range near {
		otherID := pair.LeftID
		if pair.LeftID == assetID {
			otherID = pair.RightID
		}
		item.Similar = append(item.Similar, otherID)
	}
	similarItems, err := s.assetSimilarItems(scanID, assetID, near)
	if err != nil {
		return CatalogItemDetail{}, err
	}
	return CatalogItemDetail{
		Item:         item,
		References:   refs,
		Duplicates:   dups,
		Similar:      near,
		SimilarItems: similarItems,
		Optimization: opts,
	}, nil
}

func (s *Store) CatalogDuplicates(scanID int64, kind, cursor string, limit int) (CatalogDuplicatesPage, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return CatalogDuplicatesPage{}, err
	}
	limit = normalizeCatalogLimit(limit)
	offset := parseCursorOffset(cursor)
	if kind == "near" {
		var total int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM near_duplicate_snapshots WHERE scan_id = ?`, scanID).Scan(&total); err != nil {
			return CatalogDuplicatesPage{}, err
		}
		rows, err := s.db.Query(`
			SELECT near_id, left_id, right_id, left_path, right_path, distance, flipped
			FROM near_duplicate_snapshots
			WHERE scan_id = ?
			ORDER BY distance ASC, left_path ASC, right_path ASC
			LIMIT ? OFFSET ?
		`, scanID, limit+1, offset)
		if err != nil {
			return CatalogDuplicatesPage{}, err
		}
		defer rows.Close()
		pairs := []scanner.NearDuplicate{}
		for rows.Next() {
			var pair scanner.NearDuplicate
			var flipped int
			if err := rows.Scan(&pair.ID, &pair.LeftID, &pair.RightID, &pair.LeftPath, &pair.RightPath, &pair.Distance, &flipped); err != nil {
				return CatalogDuplicatesPage{}, err
			}
			pair.Flipped = flipped != 0
			pairs = append(pairs, pair)
		}
		if err := rows.Err(); err != nil {
			return CatalogDuplicatesPage{}, err
		}
		next := ""
		if len(pairs) > limit {
			pairs = pairs[:limit]
			next = strconv.Itoa(offset + limit)
		}
		return CatalogDuplicatesPage{Pairs: pairs, Groups: []scanner.DuplicateGroup{}, Total: total, NextCursor: next}, nil
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM duplicate_group_snapshots WHERE scan_id = ?`, scanID).Scan(&total); err != nil {
		return CatalogDuplicatesPage{}, err
	}
	rows, err := s.db.Query(`
		SELECT group_id, content_hash, hash_algorithm, preferred_path
		FROM duplicate_group_snapshots
		WHERE scan_id = ?
		ORDER BY preferred_path ASC
		LIMIT ? OFFSET ?
	`, scanID, limit+1, offset)
	if err != nil {
		return CatalogDuplicatesPage{}, err
	}
	groups := []scanner.DuplicateGroup{}
	for rows.Next() {
		var group scanner.DuplicateGroup
		if err := rows.Scan(&group.ID, &group.ContentHash, &group.HashAlgorithm, &group.PreferredPath); err != nil {
			_ = rows.Close()
			return CatalogDuplicatesPage{}, err
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return CatalogDuplicatesPage{}, err
	}
	if err := rows.Close(); err != nil {
		return CatalogDuplicatesPage{}, err
	}
	next := ""
	if len(groups) > limit {
		groups = groups[:limit]
		next = strconv.Itoa(offset + limit)
	}
	for i := range groups {
		paths, err := s.duplicateGroupPaths(scanID, groups[i].ID)
		if err != nil {
			return CatalogDuplicatesPage{}, err
		}
		groups[i].Paths = paths
	}
	return CatalogDuplicatesPage{Groups: groups, Pairs: []scanner.NearDuplicate{}, Total: total, NextCursor: next}, nil
}

func (s *Store) CatalogLint(query CatalogLintQuery) (CatalogLintPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogLintPage{}, err
	}
	limit := normalizeCatalogLimit(query.Limit)
	offset := parseCursorOffset(query.Cursor)
	clauses := []string{"scan_id = ?"}
	args := []any{scanID}
	if strings.TrimSpace(query.Severity) != "" {
		clauses = append(clauses, "severity = ?")
		args = append(args, strings.TrimSpace(query.Severity))
	}
	where := "WHERE " + strings.Join(clauses, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM lint_snapshots `+where, args...).Scan(&total); err != nil {
		return CatalogLintPage{}, err
	}
	args = append(args, limit+1, offset)
	rows, err := s.db.Query(`
		SELECT rule_id, severity, file, line, snippet, message, suggestion, asset_id
		FROM lint_snapshots
		`+where+`
		ORDER BY severity ASC, file ASC, line ASC, rule_id ASC
		LIMIT ? OFFSET ?
	`, args...)
	if err != nil {
		return CatalogLintPage{}, err
	}
	defer rows.Close()
	items := []lint.Finding{}
	for rows.Next() {
		var finding lint.Finding
		if err := rows.Scan(&finding.RuleID, &finding.Severity, &finding.File, &finding.Line, &finding.Snippet, &finding.Message, &finding.Suggestion, &finding.AssetID); err != nil {
			return CatalogLintPage{}, err
		}
		items = append(items, finding)
	}
	if err := rows.Err(); err != nil {
		return CatalogLintPage{}, err
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = strconv.Itoa(offset + limit)
	}
	return CatalogLintPage{Items: items, Total: total, NextCursor: next}, nil
}

func (s *Store) resolveScanID(scanID int64) (int64, error) {
	if scanID > 0 {
		return scanID, nil
	}
	scan, err := s.LatestScan()
	if err != nil {
		return 0, err
	}
	return scan.ID, nil
}

func normalizeCatalogLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > catalogItemsLimitMax {
		return catalogItemsLimitMax
	}
	return limit
}

func parseCursorOffset(cursor string) int {
	offset, err := strconv.Atoi(strings.TrimSpace(cursor))
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}

func normalizeCatalogExt(value string) string {
	ext := strings.ToLower(strings.TrimSpace(value))
	if ext != "" && !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return ext
}

func normalizeCatalogFolder(value string) string {
	return strings.Trim(strings.TrimSpace(value), "/")
}

func immediateChildFolder(parent, repoPath string) (string, string, bool) {
	parent = normalizeCatalogFolder(parent)
	repoPath = strings.Trim(repoPath, "/")
	rest := repoPath
	if parent != "" {
		prefix := parent + "/"
		if !strings.HasPrefix(repoPath, prefix) {
			return "", "", false
		}
		rest = strings.TrimPrefix(repoPath, prefix)
	}
	slash := strings.Index(rest, "/")
	if slash < 0 {
		return "", "", false
	}
	name := rest[:slash]
	if name == "" {
		return "", "", false
	}
	childPath := name
	if parent != "" {
		childPath = parent + "/" + name
	}
	return childPath, name, strings.Contains(rest[slash+1:], "/")
}

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
		if err := s.db.QueryRow("SELECT COUNT(*) FROM asset_snapshots a "+where, args...).Scan(&count); err != nil {
			return CatalogItemFacets{}, err
		}
		customFilters = append(customFilters, CatalogCustomFilterFacet{
			ID:      filter.ID,
			Label:   filter.Name,
			Count:   count,
			UsesOCR: customFilterUsesOCR(filter),
		})
	}
	return CatalogItemFacets{
		Projects:          projects,
		ProjectTotal:      projectTotal,
		Extensions:        extensions,
		ExtensionTotal:    extensionTotal,
		CustomFilters:     customFilters,
		CustomFilterTotal: customTotal,
	}, nil
}

func (s *Store) catalogFacetCounts(scanID int64, query CatalogItemQuery, expr string) ([]CatalogFacetOption, int, error) {
	where, args, err := s.catalogItemWhere(scanID, query)
	if err != nil {
		return nil, 0, err
	}
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM asset_snapshots a "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`
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
			return "a.used_count = 0", nil, nil
		}
		return "a.used_count > 0", nil, nil
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
				AND (oq.normalized_text LIKE ? OR oq.text LIKE ?)
		))`)
		like := "%" + q + "%"
		args = append(args, like, like, like, like)
	}
	switch strings.TrimSpace(query.Status) {
	case "unused":
		clauses = append(clauses, "a.used_count = 0")
	case "referenced":
		clauses = append(clauses, "a.used_count > 0")
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
	case "nearDuplicate":
		clauses = append(clauses, "EXISTS (SELECT 1 FROM near_duplicate_snapshots n WHERE n.scan_id = a.scan_id AND (n.left_id = a.asset_id OR n.right_id = a.asset_id))")
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
	return "WHERE " + strings.Join(clauses, " AND "), args, nil
}

func catalogItemOrder(sort string) string {
	switch sort {
	case "name", "path":
		return "ORDER BY a.file_name COLLATE NOCASE ASC, a.file_name ASC, a.project_name ASC, a.repo_path ASC, a.asset_id ASC"
	case "bytes-desc":
		return "ORDER BY a.bytes DESC, a.project_id ASC, a.repo_path ASC"
	case "bytes-asc":
		return "ORDER BY a.bytes ASC, a.project_id ASC, a.repo_path ASC"
	case "recent":
		return "ORDER BY a.modified_unix DESC, a.project_id ASC, a.repo_path ASC, a.asset_id ASC"
	case "project":
		return "ORDER BY a.project_name ASC, a.repo_path ASC, a.asset_id ASC"
	default:
		return "ORDER BY a.file_name COLLATE NOCASE ASC, a.file_name ASC, a.project_name ASC, a.repo_path ASC, a.asset_id ASC"
	}
}

type assetRowScanner interface {
	Scan(dest ...any) error
}

func scanAssetFromRow(row assetRowScanner) (scanner.AssetItem, error) {
	var item scanner.AssetItem
	var animated, alpha int
	var usedCount, optCount int
	var groupID, preferredPath string
	err := row.Scan(&item.ID, &item.ProjectID, &item.ProjectName, &item.RepoPath, &item.LocalPath, &item.Ext,
		&item.Bytes, &item.ModifiedUnix, &item.ContentHash, &item.HashAlgorithm, &item.Image.Format, &item.Image.Width, &item.Image.Height,
		&animated, &alpha, &item.Image.Pages, &item.DHash, &item.DHashFlipped, &usedCount, &groupID, &preferredPath, &optCount)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	item.Image.Animated = animated != 0
	item.Image.Alpha = alpha != 0
	item.URL = "/api/assets/" + item.ID
	item.ThumbnailURL = "/api/thumbs/" + item.ID
	item.UsedBy = make([]string, usedCount)
	item.References = []scanner.AssetReference{}
	item.Duplicates = []string{}
	item.Similar = []string{}
	item.Optimization = make([]scanner.OptimizationSuggestion, optCount)
	if groupID != "" {
		item.DuplicateGroupID = &groupID
	}
	if preferredPath != "" {
		item.PreferredDuplicatePath = &preferredPath
	}
	return item, nil
}

func (s *Store) assetReferences(scanID int64, assetID string) ([]scanner.AssetReference, error) {
	rows, err := s.db.Query(`
		SELECT file, line, specifier, kind
		FROM reference_snapshots
		WHERE scan_id = ? AND asset_id = ?
		ORDER BY file ASC, line ASC, specifier ASC
	`, scanID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scanner.AssetReference{}
	for rows.Next() {
		var ref scanner.AssetReference
		if err := rows.Scan(&ref.File, &ref.Line, &ref.Specifier, &ref.Kind); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

func (s *Store) assetOptimization(scanID int64, assetID string) ([]scanner.OptimizationSuggestion, error) {
	rows, err := s.db.Query(`
		SELECT category, severity, reason_code, suggestion_code, estimated_bytes, savings_bytes
		FROM optimization_snapshots
		WHERE scan_id = ? AND asset_id = ?
		ORDER BY severity ASC, category ASC
	`, scanID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scanner.OptimizationSuggestion{}
	for rows.Next() {
		var opt scanner.OptimizationSuggestion
		if err := rows.Scan(&opt.Category, &opt.Severity, &opt.ReasonCode, &opt.SuggestionCode, &opt.EstimatedBytes, &opt.SavingsBytes); err != nil {
			return nil, err
		}
		out = append(out, opt)
	}
	return out, rows.Err()
}

func (s *Store) assetDuplicates(scanID int64, item scanner.AssetItem) ([]scanner.AssetItem, error) {
	if item.DuplicateGroupID == nil {
		return []scanner.AssetItem{}, nil
	}
	rows, err := s.db.Query(`
		SELECT a.asset_id, a.project_id, a.project_name, a.repo_path, a.local_path, a.ext,
			a.bytes, COALESCE(a.modified_unix, 0), COALESCE(a.content_hash, ''), COALESCE(a.hash_algorithm, ''), COALESCE(a.format, ''),
			a.width, a.height, a.animated, a.alpha, a.pages, COALESCE(a.dhash, ''), COALESCE(a.dhash_flipped, ''),
			a.used_count, COALESCE(d.group_id, ''), COALESCE(g.preferred_path, ''),
			(SELECT COUNT(*) FROM optimization_snapshots o WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id)
		FROM duplicate_group_assets d
		JOIN asset_snapshots a ON a.scan_id = d.scan_id AND a.asset_id = d.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = d.scan_id AND g.group_id = d.group_id
		WHERE d.scan_id = ? AND d.group_id = ? AND d.asset_id != ?
		ORDER BY a.project_id ASC, a.repo_path ASC
	`, scanID, *item.DuplicateGroupID, item.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scanner.AssetItem{}
	for rows.Next() {
		dup, err := scanAssetFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, dup)
	}
	return out, rows.Err()
}

func (s *Store) assetNearDuplicates(scanID int64, assetID string) ([]scanner.NearDuplicate, error) {
	rows, err := s.db.Query(`
		SELECT near_id, left_id, right_id, left_path, right_path, distance, flipped
		FROM near_duplicate_snapshots
		WHERE scan_id = ? AND (left_id = ? OR right_id = ?)
		ORDER BY distance ASC, left_path ASC, right_path ASC
	`, scanID, assetID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []scanner.NearDuplicate{}
	for rows.Next() {
		var near scanner.NearDuplicate
		var flipped int
		if err := rows.Scan(&near.ID, &near.LeftID, &near.RightID, &near.LeftPath, &near.RightPath, &near.Distance, &flipped); err != nil {
			return nil, err
		}
		near.Flipped = flipped != 0
		out = append(out, near)
	}
	return out, rows.Err()
}

func (s *Store) assetSimilarItems(scanID int64, assetID string, near []scanner.NearDuplicate) ([]scanner.AssetItem, error) {
	items := []scanner.AssetItem{}
	seen := map[string]bool{}
	for _, pair := range near {
		otherID := pair.LeftID
		if pair.LeftID == assetID {
			otherID = pair.RightID
		}
		if seen[otherID] {
			continue
		}
		seen[otherID] = true
		item, err := s.CatalogItem(scanID, otherID)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Store) duplicateGroupPaths(scanID int64, groupID string) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT repo_path
		FROM duplicate_group_assets
		WHERE scan_id = ? AND group_id = ?
		ORDER BY repo_path ASC
	`, scanID, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	paths := []string{}
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	return paths, rows.Err()
}

func uniqueReferenceFiles(refs []scanner.AssetReference) []string {
	seen := map[string]bool{}
	for _, ref := range refs {
		seen[ref.File] = true
	}
	out := make([]string, 0, len(seen))
	for file := range seen {
		out = append(out, file)
	}
	return out
}

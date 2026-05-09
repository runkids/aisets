package config

import (
	"fmt"
	"strconv"
	"strings"

	"aisets/internal/scanner"
)

func (s *Store) CatalogDuplicates(q CatalogDuplicatesQuery) (CatalogDuplicatesPage, error) {
	scanID, err := s.resolveScanID(q.ScanID)
	if err != nil {
		return CatalogDuplicatesPage{}, err
	}
	limit := normalizeCatalogLimit(q.Limit)
	offset := parseCursorOffset(q.Cursor)

	if q.Kind == "near" {
		nearJoin, nearWhere, nearArgs := s.nearDuplicateFilters(scanID, q.ProjectName, q.Ext)

		var total int
		countSQL := fmt.Sprintf(`SELECT COUNT(DISTINCT n.near_id) FROM near_duplicate_snapshots n%s WHERE n.scan_id = ?%s`, nearJoin, nearWhere)
		countArgs := make([]any, 0, 1+len(nearArgs))
		countArgs = append(countArgs, scanID)
		countArgs = append(countArgs, nearArgs...)
		if err := s.db.QueryRow(countSQL, countArgs...).Scan(&total); err != nil {
			return CatalogDuplicatesPage{}, err
		}
		selectSQL := fmt.Sprintf(`
			SELECT DISTINCT n.near_id, n.left_id, n.right_id, n.left_path, n.right_path, n.distance, n.flipped
			FROM near_duplicate_snapshots n%s
			WHERE n.scan_id = ?%s
			ORDER BY n.distance ASC, n.left_path ASC, n.right_path ASC
			LIMIT ? OFFSET ?
		`, nearJoin, nearWhere)
		selectArgs := make([]any, 0, 1+len(nearArgs)+2)
		selectArgs = append(selectArgs, scanID)
		selectArgs = append(selectArgs, nearArgs...)
		selectArgs = append(selectArgs, limit+1, offset)
		rows, err := s.db.Query(selectSQL, selectArgs...)
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
		return CatalogDuplicatesPage{Pairs: pairs, Groups: []CatalogDuplicateGroup{}, Total: total, NextCursor: next}, nil
	}

	filterJoin, filterWhere, filterArgs := s.duplicateGroupFilters(scanID, q.ProjectName, q.Ext)

	var total, totalFiles int
	countSQL := fmt.Sprintf(`SELECT COUNT(DISTINCT g.group_id) FROM duplicate_group_snapshots g%s WHERE g.scan_id = ?%s`, filterJoin, filterWhere)
	countArgs := append([]any{scanID}, filterArgs...)
	if err := s.db.QueryRow(countSQL, countArgs...).Scan(&total); err != nil {
		return CatalogDuplicatesPage{}, err
	}
	filesSQL := fmt.Sprintf(`SELECT COUNT(*) FROM duplicate_group_assets da
		WHERE da.scan_id = ? AND da.group_id IN (
			SELECT DISTINCT g.group_id FROM duplicate_group_snapshots g%s WHERE g.scan_id = ?%s
		)`, filterJoin, filterWhere)
	filesArgs := make([]any, 0, 2+len(filterArgs))
	filesArgs = append(filesArgs, scanID, scanID)
	filesArgs = append(filesArgs, filterArgs...)
	if err := s.db.QueryRow(filesSQL, filesArgs...).Scan(&totalFiles); err != nil {
		return CatalogDuplicatesPage{}, err
	}

	selectSQL := fmt.Sprintf(`
		SELECT DISTINCT g.group_id, g.content_hash, g.hash_algorithm, g.preferred_path
		FROM duplicate_group_snapshots g%s
		WHERE g.scan_id = ?%s
		ORDER BY g.preferred_path ASC
		LIMIT ? OFFSET ?
	`, filterJoin, filterWhere)
	selectArgs := append([]any{scanID}, append(filterArgs, limit+1, offset)...)
	rows, err := s.db.Query(selectSQL, selectArgs...)
	if err != nil {
		return CatalogDuplicatesPage{}, err
	}
	groups := []CatalogDuplicateGroup{}
	for rows.Next() {
		var group CatalogDuplicateGroup
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
	groupIDs := make([]string, 0, len(groups))
	for i := range groups {
		groupIDs = append(groupIDs, groups[i].ID)
	}
	pathsByGroup, membersByGroup, err := s.duplicateGroupMembersByGroup(scanID, groupIDs)
	if err != nil {
		return CatalogDuplicatesPage{}, err
	}
	for i := range groups {
		groups[i].Paths = pathsByGroup[groups[i].ID]
		groups[i].Members = membersByGroup[groups[i].ID]
	}

	var facets CatalogDuplicatesFacets
	if offset == 0 {
		facets, err = s.duplicateGroupFacets(scanID, q.ProjectName, q.Ext)
		if err != nil {
			return CatalogDuplicatesPage{}, err
		}
	}
	return CatalogDuplicatesPage{Groups: groups, Pairs: []scanner.NearDuplicate{}, Total: total, TotalFiles: totalFiles, NextCursor: next, Facets: facets}, nil
}

func (s *Store) duplicateGroupFilters(scanID int64, projectName, ext string) (join, where string, args []any) {
	if projectName == "" && ext == "" {
		return "", "", nil
	}
	var conds []string
	join = `
		JOIN duplicate_group_assets d ON d.scan_id = g.scan_id AND d.group_id = g.group_id
		JOIN asset_snapshots a ON a.scan_id = d.scan_id AND a.asset_id = d.asset_id`
	if projectName != "" {
		conds = append(conds, " AND a.project_name = ?")
		args = append(args, projectName)
	}
	if ext != "" {
		conds = append(conds, " AND a.ext = ?")
		args = append(args, ext)
	}
	where = strings.Join(conds, "")
	return join, where, args
}

func (s *Store) nearDuplicateFilters(scanID int64, projectName, ext string) (join, where string, args []any) {
	if projectName == "" && ext == "" {
		return "", "", nil
	}
	join = `
		JOIN asset_snapshots al ON al.scan_id = n.scan_id AND al.asset_id = n.left_id
		JOIN asset_snapshots ar ON ar.scan_id = n.scan_id AND ar.asset_id = n.right_id`
	var conds []string
	if projectName != "" {
		conds = append(conds, " AND (al.project_name = ? OR ar.project_name = ?)")
		args = append(args, projectName, projectName)
	}
	if ext != "" {
		conds = append(conds, " AND (al.ext = ? OR ar.ext = ?)")
		args = append(args, ext, ext)
	}
	where = strings.Join(conds, "")
	return join, where, args
}

func (s *Store) duplicateGroupFacets(scanID int64, projectName, ext string) (CatalogDuplicatesFacets, error) {
	var facets CatalogDuplicatesFacets

	projOpts, projTotal, err := s.dupFacetCounts(scanID, "a.project_name", "", ext)
	if err != nil {
		return facets, err
	}
	facets.Projects = projOpts
	facets.ProjectTotal = projTotal

	extOpts, extTotal, err := s.dupFacetCounts(scanID, "a.ext", projectName, "")
	if err != nil {
		return facets, err
	}
	facets.Extensions = extOpts
	facets.ExtensionTotal = extTotal

	return facets, nil
}

func (s *Store) dupFacetCounts(scanID int64, groupByExpr, projectName, ext string) ([]CatalogFacetOption, int, error) {
	where := "WHERE d.scan_id = ?"
	args := []any{scanID}
	if projectName != "" {
		where += " AND a.project_name = ?"
		args = append(args, projectName)
	}
	if ext != "" {
		where += " AND a.ext = ?"
		args = append(args, ext)
	}

	var total int
	totalSQL := fmt.Sprintf(`SELECT COUNT(DISTINCT d.group_id)
		FROM duplicate_group_assets d
		JOIN asset_snapshots a ON a.scan_id = d.scan_id AND a.asset_id = d.asset_id
		%s`, where)
	if err := s.db.QueryRow(totalSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	facetSQL := fmt.Sprintf(`SELECT %s, COUNT(DISTINCT d.group_id)
		FROM duplicate_group_assets d
		JOIN asset_snapshots a ON a.scan_id = d.scan_id AND a.asset_id = d.asset_id
		%s
		GROUP BY %s
		ORDER BY COUNT(DISTINCT d.group_id) DESC, %s ASC`, groupByExpr, where, groupByExpr, groupByExpr)
	rows, err := s.db.Query(facetSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var opts []CatalogFacetOption
	for rows.Next() {
		var opt CatalogFacetOption
		if err := rows.Scan(&opt.ID, &opt.Count); err != nil {
			return nil, 0, err
		}
		opts = append(opts, opt)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return opts, total, nil
}

func (s *Store) duplicateGroupMembersByGroup(scanID int64, groupIDs []string) (map[string][]string, map[string][]scanner.AssetItem, error) {
	pathsByGroup := make(map[string][]string, len(groupIDs))
	membersByGroup := make(map[string][]scanner.AssetItem, len(groupIDs))
	if len(groupIDs) == 0 {
		return pathsByGroup, membersByGroup, nil
	}
	groupClause, groupArgs := inClauseSQL("da.group_id", groupIDs)
	args := append([]any{scanID}, groupArgs...)
	rows, err := s.db.Query(`
		SELECT `+catalogAssetSelectColumns+`
		FROM duplicate_group_assets da
		JOIN asset_snapshots a ON a.scan_id = da.scan_id AND a.asset_id = da.asset_id
		LEFT JOIN duplicate_group_assets d ON d.scan_id = a.scan_id AND d.asset_id = a.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = a.scan_id AND g.group_id = d.group_id
		WHERE da.scan_id = ? AND `+groupClause+`
		ORDER BY da.group_id ASC, a.repo_path ASC, a.asset_id ASC
	`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	allMembers := []scanner.AssetItem{}
	for rows.Next() {
		item, err := scanAssetFromRow(rows)
		if err != nil {
			return nil, nil, err
		}
		if item.DuplicateGroupID == nil {
			continue
		}
		groupID := *item.DuplicateGroupID
		pathsByGroup[groupID] = append(pathsByGroup[groupID], item.RepoPath)
		membersByGroup[groupID] = append(membersByGroup[groupID], item)
		allMembers = append(allMembers, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if err := s.hydrateAssetOptimization(scanID, allMembers); err != nil {
		return nil, nil, err
	}
	optimizedByID := make(map[string]scanner.AssetItem, len(allMembers))
	for _, item := range allMembers {
		optimizedByID[item.ID] = item
	}
	for groupID, members := range membersByGroup {
		for index := range members {
			members[index] = optimizedByID[members[index].ID]
		}
		membersByGroup[groupID] = members
	}
	return pathsByGroup, membersByGroup, nil
}

type DuplicateTrendPoint struct {
	ScanID          int64  `json:"scanId"`
	CompletedAt     string `json:"completedAt"`
	DuplicateGroups int    `json:"duplicateGroups"`
	DuplicateFiles  int    `json:"duplicateFiles"`
	NearDuplicates  int    `json:"nearDuplicates"`
	TotalFiles      int    `json:"totalFiles"`
}

func (s *Store) DuplicateTrend(limit int) ([]DuplicateTrendPoint, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.Query(`
		SELECT id, completed_at, duplicate_groups, duplicate_files, near_duplicates, total_files
		FROM scans
		WHERE status = 'completed' AND completed_at IS NOT NULL
		ORDER BY completed_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []DuplicateTrendPoint
	for rows.Next() {
		var p DuplicateTrendPoint
		if err := rows.Scan(&p.ScanID, &p.CompletedAt, &p.DuplicateGroups, &p.DuplicateFiles, &p.NearDuplicates, &p.TotalFiles); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

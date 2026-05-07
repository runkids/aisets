package config

import (
	"database/sql"
	"errors"

	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
)

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
	lintFindings, err := s.catalogLintFindingsCount(scan.ID)
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
			LintFindings:    lintFindings,
			CacheHits:       scan.CacheHits,
		},
		Analysis: scan.Analysis,
	}, nil
}

func (s *Store) catalogLintFindingsCount(scanID int64) (int, error) {
	var count int
	if err := s.db.QueryRow(`
		SELECT COUNT(*)
		FROM lint_snapshots
		WHERE scan_id = ?
	`, scanID).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
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

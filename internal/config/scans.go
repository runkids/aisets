package config

import (
	"database/sql"
	"errors"
	"sort"
	"strings"

	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
)

func (s *Store) RecordScan(catalog scanner.Catalog) (int64, error) {
	catalog.Analysis = normalizeCatalogAnalysis(catalog.Analysis)
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	now := nowUTC()
	result, err := tx.Exec(`
		INSERT INTO scans (
			started_at, completed_at, status, scan_profile, references_state,
			near_duplicates_state, optimization_state, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, catalog.GeneratedAt, now, "completed", scanProfileForCatalog(catalog), catalog.Analysis.References,
		catalog.Analysis.NearDuplicates, catalog.Analysis.Optimization, len(catalog.Projects), catalog.Stats.TotalFiles,
		catalog.Stats.DuplicateGroups, catalog.Stats.DuplicateFiles, catalog.Stats.UnusedFiles,
		catalog.Stats.NearDuplicates, catalog.Stats.CacheHits)
	if err != nil {
		return 0, err
	}
	scanID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	projectStmt, err := tx.Prepare(`
		INSERT INTO scan_project_snapshots (scan_id, project_id, scan_intent)
		VALUES (?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer projectStmt.Close()
	for _, project := range catalog.Projects {
		if _, err = projectStmt.Exec(scanID, project.ID, scanner.NormalizeProjectScanIntent(project.ScanIntent)); err != nil {
			return 0, err
		}
	}

	assetStmt, err := tx.Prepare(`
		INSERT INTO asset_snapshots (
			scan_id, asset_id, project_id, project_name, repo_path, file_name, local_path, ext,
			bytes, modified_unix, content_hash, hash_algorithm, format, width, height, animated,
			alpha, pages, dhash, dhash_flipped, used_count, scan_intent, usage_classification,
			delete_unused_allowed, lint_applicability
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer assetStmt.Close()
	refStmt, err := tx.Prepare(`
		INSERT INTO reference_snapshots (scan_id, asset_id, project_id, repo_path, file, line, specifier, kind)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer refStmt.Close()
	optStmt, err := tx.Prepare(`
		INSERT INTO optimization_snapshots (
			scan_id, asset_id, project_id, repo_path, category, severity,
			reason_code, suggestion_code, estimated_bytes, savings_bytes,
			has_existing_variant,
			variant_bytes
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer optStmt.Close()
	for _, item := range catalog.Items {
		item = normalizeSnapshotItem(item)
		usedCount := len(item.UsedBy)
		if _, err = assetStmt.Exec(scanID, item.ID, item.ProjectID, item.ProjectName, item.RepoPath, assetFileName(item.RepoPath), item.LocalPath, item.Ext,
			item.Bytes, item.ModifiedUnix, item.ContentHash, item.HashAlgorithm, item.Image.Format, item.Image.Width,
			item.Image.Height, boolInt(item.Image.Animated), boolInt(item.Image.Alpha), item.Image.Pages,
			item.DHash, item.DHashFlipped, usedCount, item.ScanIntent, item.UsageClassification,
			boolInt(item.DeleteUnusedAllowed), item.LintApplicability); err != nil {
			return 0, err
		}
		for _, ref := range item.References {
			if _, err = refStmt.Exec(scanID, item.ID, item.ProjectID, item.RepoPath, ref.File, ref.Line, ref.Specifier, ref.Kind); err != nil {
				return 0, err
			}
		}
		for _, opt := range item.Optimization {
			if _, err = optStmt.Exec(scanID, item.ID, item.ProjectID, item.RepoPath, opt.Category, opt.Severity,
				opt.ReasonCode, opt.SuggestionCode, opt.EstimatedBytes, opt.SavingsBytes,
				boolInt(opt.HasExistingVariant),
				opt.VariantBytes); err != nil {
				return 0, err
			}
		}
	}
	groupStmt, err := tx.Prepare(`
		INSERT INTO duplicate_group_snapshots (scan_id, group_id, content_hash, hash_algorithm, preferred_path)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer groupStmt.Close()
	groupAssetStmt, err := tx.Prepare(`
		INSERT INTO duplicate_group_assets (scan_id, group_id, asset_id, project_id, repo_path)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer groupAssetStmt.Close()
	for _, group := range catalog.DuplicateGroups {
		if _, err = groupStmt.Exec(scanID, group.ID, group.ContentHash, group.HashAlgorithm, group.PreferredPath); err != nil {
			return 0, err
		}
		insertedGroupAssets := false
		for _, item := range catalog.Items {
			if item.DuplicateGroupID == nil || *item.DuplicateGroupID != group.ID {
				continue
			}
			if _, err = groupAssetStmt.Exec(scanID, group.ID, item.ID, item.ProjectID, item.RepoPath); err != nil {
				return 0, err
			}
			insertedGroupAssets = true
		}
		if !insertedGroupAssets {
			for _, path := range group.Paths {
				if _, err = groupAssetStmt.Exec(scanID, group.ID, "", "", path); err != nil {
					return 0, err
				}
			}
		}
	}
	nearStmt, err := tx.Prepare(`
		INSERT INTO near_duplicate_snapshots (
			scan_id, near_id, left_id, right_id, left_path, right_path, distance, flipped
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer nearStmt.Close()
	for _, near := range catalog.NearDuplicates {
		if _, err = nearStmt.Exec(scanID, near.ID, near.LeftID, near.RightID, near.LeftPath, near.RightPath, near.Distance, boolInt(near.Flipped)); err != nil {
			return 0, err
		}
	}
	lintStmt, err := tx.Prepare(`
		INSERT INTO lint_snapshots (scan_id, rule_id, severity, file, line, snippet, message, suggestion, asset_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, err
	}
	defer lintStmt.Close()
	for _, finding := range catalog.LintFindings {
		if _, err = lintStmt.Exec(scanID, finding.RuleID, finding.Severity, finding.File, finding.Line, finding.Snippet, finding.Message, finding.Suggestion, finding.AssetID); err != nil {
			return 0, err
		}
	}
	if err = pruneOldScansTx(tx, 10); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return scanID, nil
}

func (s *Store) ClearScans() error {
	_, err := s.db.Exec(`DELETE FROM scans`)
	return err
}

func normalizeSnapshotItem(item scanner.AssetItem) scanner.AssetItem {
	item.ScanIntent = scanner.NormalizeProjectScanIntent(item.ScanIntent)
	if item.UsageClassification == "" {
		if len(item.UsedBy) > 0 {
			item.UsageClassification = scanner.UsageReferenced
		} else {
			item.UsageClassification = scanner.UsageNotApplicable
		}
	}
	if item.LintApplicability == "" {
		item.LintApplicability = scanner.LintApplicable
	}
	if item.UsageClassification == scanner.UsageUnused {
		item.DeleteUnusedAllowed = true
	} else {
		item.DeleteUnusedAllowed = false
	}
	return item
}

func assetFileName(repoPath string) string {
	index := strings.LastIndex(repoPath, "/")
	if index < 0 || index == len(repoPath)-1 {
		return repoPath
	}
	return repoPath[index+1:]
}

func (s *Store) ListScans() ([]ScanSummary, error) {
	rows, err := s.db.Query(`
		SELECT id, started_at, COALESCE(completed_at, ''), status, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits,
			scan_profile, references_state, near_duplicates_state, optimization_state
		FROM scans
		WHERE status = 'completed'
		ORDER BY completed_at DESC, id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScanSummary{}
	for rows.Next() {
		scan, err := scanSummaryFromRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, scan)
	}
	return out, rows.Err()
}

func (s *Store) Scan(id int64) (ScanSummary, error) {
	row := s.db.QueryRow(`
		SELECT id, started_at, COALESCE(completed_at, ''), status, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits,
			scan_profile, references_state, near_duplicates_state, optimization_state
		FROM scans
		WHERE id = ?
	`, id)
	scan, err := scanSummaryFromRows(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ScanSummary{}, apierr.WithParams("scan_not_found", "scan not found", map[string]any{"scanId": id})
	}
	return scan, err
}

type scanSummaryScanner interface {
	Scan(dest ...any) error
}

func scanSummaryFromRows(row scanSummaryScanner) (ScanSummary, error) {
	var scan ScanSummary
	err := row.Scan(&scan.ID, &scan.StartedAt, &scan.CompletedAt, &scan.Status, &scan.ProjectCount, &scan.TotalFiles,
		&scan.DuplicateGroups, &scan.DuplicateFiles, &scan.UnusedFiles, &scan.NearDuplicates, &scan.CacheHits,
		&scan.Profile, &scan.Analysis.References, &scan.Analysis.NearDuplicates, &scan.Analysis.Optimization)
	return scan, err
}

type scanAssetSnapshot struct {
	ProjectID           string
	ProjectName         string
	RepoPath            string
	Ext                 string
	Bytes               int64
	ContentHash         string
	UsedCount           int
	UsageClassification scanner.UsageClassification
}

func (s *Store) DiffScans(baseID, targetID int64) (ScanDiff, error) {
	if baseID == targetID {
		return ScanDiff{}, apierr.WithParams("scan_diff_same_scan", "base and target scans must be different", map[string]any{"scanId": baseID})
	}
	base, err := s.Scan(baseID)
	if err != nil {
		return ScanDiff{}, err
	}
	target, err := s.Scan(targetID)
	if err != nil {
		return ScanDiff{}, err
	}
	baseAssets, err := s.scanAssets(baseID)
	if err != nil {
		return ScanDiff{}, err
	}
	targetAssets, err := s.scanAssets(targetID)
	if err != nil {
		return ScanDiff{}, err
	}
	baseSavings, err := s.optimizationSavings(baseID)
	if err != nil {
		return ScanDiff{}, err
	}
	targetSavings, err := s.optimizationSavings(targetID)
	if err != nil {
		return ScanDiff{}, err
	}

	diff := ScanDiff{
		Base:              base,
		Target:            target,
		Added:             []ScanAssetDiff{},
		Removed:           []ScanAssetDiff{},
		Modified:          []ScanAssetDiff{},
		ReferenceChanges:  []ScanAssetDiff{},
		UnusedTransitions: []UnusedTransition{},
	}
	var baseBytes, targetBytes int64
	for key, before := range baseAssets {
		baseBytes += before.Bytes
		after, ok := targetAssets[key]
		if !ok {
			diff.Removed = append(diff.Removed, removedDiff(before))
			continue
		}
		if before.ContentHash != after.ContentHash || before.Bytes != after.Bytes {
			diff.Modified = append(diff.Modified, beforeAfterDiff(before, after))
		}
		if before.UsedCount != after.UsedCount {
			diff.ReferenceChanges = append(diff.ReferenceChanges, beforeAfterDiff(before, after))
		}
		if before.UsageClassification == scanner.UsageReferenced && after.UsageClassification == scanner.UsageUnused {
			diff.UnusedTransitions = append(diff.UnusedTransitions, unusedTransition(after, "becameUnused", before.UsedCount, after.UsedCount))
		}
		if before.UsageClassification == scanner.UsageUnused && after.UsageClassification == scanner.UsageReferenced {
			diff.UnusedTransitions = append(diff.UnusedTransitions, unusedTransition(after, "noLongerUnused", before.UsedCount, after.UsedCount))
		}
	}
	for key, after := range targetAssets {
		targetBytes += after.Bytes
		if _, ok := baseAssets[key]; !ok {
			diff.Added = append(diff.Added, addedDiff(after))
		}
	}
	sortScanDiff(diff.Added)
	sortScanDiff(diff.Removed)
	sortScanDiff(diff.Modified)
	sortScanDiff(diff.ReferenceChanges)
	sort.Slice(diff.UnusedTransitions, func(i, j int) bool {
		if diff.UnusedTransitions[i].ProjectID != diff.UnusedTransitions[j].ProjectID {
			return diff.UnusedTransitions[i].ProjectID < diff.UnusedTransitions[j].ProjectID
		}
		return diff.UnusedTransitions[i].RepoPath < diff.UnusedTransitions[j].RepoPath
	})
	diff.Summary = ScanDiffSummary{
		Added:                    len(diff.Added),
		Removed:                  len(diff.Removed),
		Modified:                 len(diff.Modified),
		ReferenceChanged:         len(diff.ReferenceChanges),
		TotalByteDelta:           targetBytes - baseBytes,
		OptimizationSavingsDelta: targetSavings - baseSavings,
		DuplicateGroupsDelta:     target.DuplicateGroups - base.DuplicateGroups,
		NearDuplicatesDelta:      target.NearDuplicates - base.NearDuplicates,
	}
	for _, transition := range diff.UnusedTransitions {
		if transition.Direction == "becameUnused" {
			diff.Summary.BecameUnused++
		}
		if transition.Direction == "noLongerUnused" {
			diff.Summary.NoLongerUnused++
		}
	}
	return diff, nil
}

func (s *Store) scanAssets(scanID int64) (map[string]scanAssetSnapshot, error) {
	rows, err := s.db.Query(`
		SELECT project_id, project_name, repo_path, ext, bytes, COALESCE(content_hash, ''), used_count,
			COALESCE(usage_classification, 'notApplicable')
		FROM asset_snapshots
		WHERE scan_id = ?
	`, scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]scanAssetSnapshot{}
	for rows.Next() {
		var asset scanAssetSnapshot
		if err := rows.Scan(&asset.ProjectID, &asset.ProjectName, &asset.RepoPath, &asset.Ext, &asset.Bytes, &asset.ContentHash, &asset.UsedCount, &asset.UsageClassification); err != nil {
			return nil, err
		}
		out[scanAssetKey(asset.ProjectID, asset.RepoPath)] = asset
	}
	return out, rows.Err()
}

func (s *Store) optimizationSavings(scanID int64) (int64, error) {
	var total int64
	err := s.db.QueryRow(`
		SELECT COALESCE(SUM(savings_bytes), 0)
		FROM optimization_snapshots
		WHERE scan_id = ?
	`, scanID).Scan(&total)
	return total, err
}

func scanAssetKey(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

func addedDiff(asset scanAssetSnapshot) ScanAssetDiff {
	return ScanAssetDiff{
		ProjectID:      asset.ProjectID,
		ProjectName:    asset.ProjectName,
		RepoPath:       asset.RepoPath,
		Ext:            asset.Ext,
		AfterBytes:     int64Ptr(asset.Bytes),
		AfterHash:      stringPtr(asset.ContentHash),
		AfterUsedCount: intPtr(asset.UsedCount),
	}
}

func removedDiff(asset scanAssetSnapshot) ScanAssetDiff {
	return ScanAssetDiff{
		ProjectID:       asset.ProjectID,
		ProjectName:     asset.ProjectName,
		RepoPath:        asset.RepoPath,
		Ext:             asset.Ext,
		BeforeBytes:     int64Ptr(asset.Bytes),
		BeforeHash:      stringPtr(asset.ContentHash),
		BeforeUsedCount: intPtr(asset.UsedCount),
	}
}

func beforeAfterDiff(before, after scanAssetSnapshot) ScanAssetDiff {
	return ScanAssetDiff{
		ProjectID:       after.ProjectID,
		ProjectName:     after.ProjectName,
		RepoPath:        after.RepoPath,
		Ext:             after.Ext,
		BeforeBytes:     int64Ptr(before.Bytes),
		AfterBytes:      int64Ptr(after.Bytes),
		BeforeHash:      stringPtr(before.ContentHash),
		AfterHash:       stringPtr(after.ContentHash),
		BeforeUsedCount: intPtr(before.UsedCount),
		AfterUsedCount:  intPtr(after.UsedCount),
	}
}

func unusedTransition(asset scanAssetSnapshot, direction string, beforeUsed, afterUsed int) UnusedTransition {
	return UnusedTransition{
		ProjectID:       asset.ProjectID,
		ProjectName:     asset.ProjectName,
		RepoPath:        asset.RepoPath,
		Ext:             asset.Ext,
		Direction:       direction,
		BeforeUsedCount: beforeUsed,
		AfterUsedCount:  afterUsed,
	}
}

func sortScanDiff(items []ScanAssetDiff) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProjectID != items[j].ProjectID {
			return items[i].ProjectID < items[j].ProjectID
		}
		return items[i].RepoPath < items[j].RepoPath
	})
}

func int64Ptr(v int64) *int64 {
	return &v
}

func intPtr(v int) *int {
	return &v
}

func stringPtr(v string) *string {
	return &v
}

func scanProfileForCatalog(catalog scanner.Catalog) scanner.ScanProfile {
	if catalog.Analysis.References == scanner.AnalysisComputed &&
		catalog.Analysis.NearDuplicates == scanner.AnalysisComputed &&
		catalog.Analysis.Optimization == scanner.AnalysisComputed {
		return scanner.ScanProfileFull
	}
	if catalog.Analysis.References == scanner.AnalysisNotComputed &&
		catalog.Analysis.NearDuplicates == scanner.AnalysisNotComputed &&
		catalog.Analysis.Optimization == scanner.AnalysisNotComputed {
		return scanner.ScanProfileFast
	}
	return scanner.ScanProfileCustom
}

func normalizeCatalogAnalysis(analysis scanner.CatalogAnalysis) scanner.CatalogAnalysis {
	if analysis.References == "" {
		analysis.References = scanner.AnalysisComputed
	}
	if analysis.NearDuplicates == "" {
		analysis.NearDuplicates = scanner.AnalysisComputed
	}
	if analysis.Optimization == "" {
		analysis.Optimization = scanner.AnalysisComputed
	}
	return analysis
}

func pruneOldScansTx(tx *sql.Tx, keep int) error {
	if keep <= 0 {
		return nil
	}
	_, err := tx.Exec(`
		DELETE FROM scans
		WHERE id IN (
			SELECT id FROM scans
			WHERE status = 'completed'
			ORDER BY completed_at DESC, id DESC
			LIMIT -1 OFFSET ?
		)
	`, keep)
	return err
}

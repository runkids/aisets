package config

import (
	"database/sql"
	"errors"
	"sort"
	"strings"

	"aisets/internal/apierr"
	"aisets/internal/lint"
	"aisets/internal/scanner"
)

const recordBatchSize = 500

func (s *Store) RecordScan(catalog scanner.Catalog) (int64, error) {
	catalog.Analysis = normalizeCatalogAnalysis(catalog.Analysis)

	scanID, err := s.recordScanPhases(catalog)
	if err != nil && scanID > 0 {
		_, _ = s.db.Exec("DELETE FROM scans WHERE id = ?", scanID)
	}
	return scanID, err
}

func (s *Store) recordScanPhases(catalog scanner.Catalog) (int64, error) {
	scanID, err := s.recordScanHeader(catalog)
	if err != nil {
		return 0, err
	}
	if err := s.recordScanAssets(scanID, catalog.Items); err != nil {
		return scanID, err
	}
	if err := s.recordScanDuplicates(scanID, catalog); err != nil {
		return scanID, err
	}
	if err := s.recordScanNearDuplicates(scanID, catalog.NearDuplicates); err != nil {
		return scanID, err
	}
	if err := s.recordScanLintFindings(scanID, catalog.LintFindings); err != nil {
		return scanID, err
	}
	if err := s.finalizeScan(scanID, catalog.Analysis); err != nil {
		return scanID, err
	}
	return scanID, nil
}

func (s *Store) recordScanHeader(catalog scanner.Catalog) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	startedAt := catalog.StartedAt
	if startedAt == "" {
		startedAt = catalog.GeneratedAt
	}
	result, err := tx.Exec(`
		INSERT INTO scans (
			started_at, completed_at, status, scan_profile, references_state,
			near_duplicates_state, optimization_state, project_count, total_files,
			duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits
		)
		VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, startedAt, "recording", scanProfileForCatalog(catalog), catalog.Analysis.References,
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

	err = tx.Commit()
	return scanID, err
}

func (s *Store) recordScanAssets(scanID int64, items []scanner.AssetItem) error {
	for i := 0; i < len(items); i += recordBatchSize {
		end := i + recordBatchSize
		if end > len(items) {
			end = len(items)
		}
		if err := s.recordScanAssetBatch(scanID, items[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) recordScanAssetBatch(scanID int64, items []scanner.AssetItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	assetStmt, err := tx.Prepare(`
		INSERT INTO asset_snapshots (
			scan_id, asset_id, project_id, project_name, repo_path, file_name, local_path, ext,
			bytes, modified_unix, content_hash, hash_algorithm, format, width, height, animated,
			alpha, pages, dhash, dhash_flipped, used_count, scan_intent, usage_classification,
			delete_unused_allowed, lint_applicability, optimize_applicability
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer assetStmt.Close()
	refStmt, err := tx.Prepare(`
		INSERT INTO reference_snapshots (scan_id, asset_id, project_id, repo_path, file, line, specifier, kind)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
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
		return err
	}
	defer optStmt.Close()

	for _, item := range items {
		item = normalizeSnapshotItem(item)
		usedCount := len(item.UsedBy)
		if _, err = assetStmt.Exec(scanID, item.ID, item.ProjectID, item.ProjectName, item.RepoPath, assetFileName(item.RepoPath), item.LocalPath, item.Ext,
			item.Bytes, item.ModifiedUnix, item.ContentHash, item.HashAlgorithm, item.Image.Format, item.Image.Width,
			item.Image.Height, boolInt(item.Image.Animated), boolInt(item.Image.Alpha), item.Image.Pages,
			item.DHash, item.DHashFlipped, usedCount, item.ScanIntent, item.UsageClassification,
			boolInt(item.DeleteUnusedAllowed), item.LintApplicability, item.OptimizeApplicability); err != nil {
			return err
		}
		for _, ref := range item.References {
			if _, err = refStmt.Exec(scanID, item.ID, item.ProjectID, item.RepoPath, ref.File, ref.Line, ref.Specifier, ref.Kind); err != nil {
				return err
			}
		}
		for _, opt := range item.Optimization {
			if _, err = optStmt.Exec(scanID, item.ID, item.ProjectID, item.RepoPath, opt.Category, opt.Severity,
				opt.ReasonCode, opt.SuggestionCode, opt.EstimatedBytes, opt.SavingsBytes,
				boolInt(opt.HasExistingVariant),
				opt.VariantBytes); err != nil {
				return err
			}
		}
	}

	var exifRecords []EXIFRecord
	for _, item := range items {
		if item.EXIF != nil && item.EXIF.HasEXIF {
			r := EXIFRecord{
				AssetID:          item.ID,
				CameraMake:       item.EXIF.CameraMake,
				CameraModel:      item.EXIF.CameraModel,
				DateTimeOriginal: item.EXIF.DateTimeOriginal,
				Orientation:      item.EXIF.Orientation,
				DPIX:             item.EXIF.DPIX,
				DPIY:             item.EXIF.DPIY,
			}
			if item.EXIF.GPSLatitude != nil && item.EXIF.GPSLongitude != nil {
				r.HasGPS = true
				r.GPSLatitude = item.EXIF.GPSLatitude
				r.GPSLongitude = item.EXIF.GPSLongitude
			}
			exifRecords = append(exifRecords, r)
		}
	}
	if err = s.recordEXIFBatch(tx, scanID, exifRecords); err != nil {
		return err
	}

	err = tx.Commit()
	return err
}

func (s *Store) recordScanDuplicates(scanID int64, catalog scanner.Catalog) error {
	if len(catalog.DuplicateGroups) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	groupStmt, err := tx.Prepare(`
		INSERT INTO duplicate_group_snapshots (scan_id, group_id, content_hash, hash_algorithm, preferred_path)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()
	groupAssetStmt, err := tx.Prepare(`
		INSERT INTO duplicate_group_assets (scan_id, group_id, asset_id, project_id, repo_path)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupAssetStmt.Close()

	itemsByGroup := make(map[string][]scanner.AssetItem)
	for _, item := range catalog.Items {
		if item.DuplicateGroupID != nil {
			itemsByGroup[*item.DuplicateGroupID] = append(itemsByGroup[*item.DuplicateGroupID], item)
		}
	}

	for _, group := range catalog.DuplicateGroups {
		if _, err = groupStmt.Exec(scanID, group.ID, group.ContentHash, group.HashAlgorithm, group.PreferredPath); err != nil {
			return err
		}
		if members := itemsByGroup[group.ID]; len(members) > 0 {
			for _, item := range members {
				if _, err = groupAssetStmt.Exec(scanID, group.ID, item.ID, item.ProjectID, item.RepoPath); err != nil {
					return err
				}
			}
		} else {
			for _, path := range group.Paths {
				if _, err = groupAssetStmt.Exec(scanID, group.ID, "", "", path); err != nil {
					return err
				}
			}
		}
	}

	err = tx.Commit()
	return err
}

func (s *Store) recordScanNearDuplicates(scanID int64, nearDuplicates []scanner.NearDuplicate) error {
	for i := 0; i < len(nearDuplicates); i += recordBatchSize {
		end := i + recordBatchSize
		if end > len(nearDuplicates) {
			end = len(nearDuplicates)
		}
		if err := s.recordScanNearDuplicatesBatch(scanID, nearDuplicates[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) recordScanNearDuplicatesBatch(scanID int64, nearDuplicates []scanner.NearDuplicate) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	nearStmt, err := tx.Prepare(`
		INSERT INTO near_duplicate_snapshots (
			scan_id, near_id, left_id, right_id, left_path, right_path, distance, flipped
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer nearStmt.Close()
	for _, near := range nearDuplicates {
		if _, err = nearStmt.Exec(scanID, near.ID, near.LeftID, near.RightID, near.LeftPath, near.RightPath, near.Distance, boolInt(near.Flipped)); err != nil {
			return err
		}
	}

	err = tx.Commit()
	return err
}

func (s *Store) recordScanLintFindings(scanID int64, findings []lint.Finding) error {
	for i := 0; i < len(findings); i += recordBatchSize {
		end := i + recordBatchSize
		if end > len(findings) {
			end = len(findings)
		}
		if err := s.recordScanLintFindingsBatch(scanID, findings[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) recordScanLintFindingsBatch(scanID int64, findings []lint.Finding) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	lintStmt, err := tx.Prepare(`
		INSERT INTO lint_snapshots (scan_id, rule_id, severity, file, line, snippet, message, suggestion, asset_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer lintStmt.Close()
	for _, finding := range findings {
		if _, err = lintStmt.Exec(scanID, finding.RuleID, finding.Severity, finding.File, finding.Line, finding.Snippet, finding.Message, finding.Suggestion, finding.AssetID); err != nil {
			return err
		}
	}

	err = tx.Commit()
	return err
}

func (s *Store) finalizeScan(scanID int64, analysis scanner.CatalogAnalysis) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if err = carryForwardAnalysis(tx, scanID, analysis); err != nil {
		return err
	}
	if err = pruneOldScansTx(tx, 10); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE scans SET status = 'completed', completed_at = ? WHERE id = ?`, nowUTC(), scanID)
	if err != nil {
		return err
	}

	if err = tx.Commit(); err != nil {
		return err
	}

	s.latestScanMu.Lock()
	s.latestScanID = 0
	s.latestScanMu.Unlock()

	return nil
}

func carryForwardAnalysis(tx *sql.Tx, scanID int64, analysis scanner.CatalogAnalysis) error {
	needOpt := analysis.Optimization == scanner.AnalysisNotComputed
	needNear := analysis.NearDuplicates == scanner.AnalysisNotComputed
	if !needOpt && !needNear {
		return nil
	}

	findSource := func(stateCol string) (int64, bool) {
		var id int64
		err := tx.QueryRow(`
			SELECT id FROM scans
			WHERE status = 'completed' AND id < ? AND `+stateCol+` = 'computed'
			ORDER BY id DESC LIMIT 1
		`, scanID).Scan(&id)
		if err != nil {
			return 0, false
		}
		return id, true
	}

	carriedOpt := false
	if needOpt {
		if srcID, ok := findSource("optimization_state"); ok {
			if _, err := tx.Exec(`
				INSERT INTO optimization_snapshots (
					scan_id, asset_id, project_id, repo_path, category, severity,
					reason_code, suggestion_code, estimated_bytes, savings_bytes,
					has_existing_variant, variant_bytes
				)
				SELECT ?, o.asset_id, o.project_id, o.repo_path, o.category, o.severity,
					o.reason_code, o.suggestion_code, o.estimated_bytes, o.savings_bytes,
					o.has_existing_variant, o.variant_bytes
				FROM optimization_snapshots o
				WHERE o.scan_id = ?
				  AND EXISTS (
					SELECT 1 FROM asset_snapshots a
					WHERE a.scan_id = ? AND a.project_id = o.project_id AND a.repo_path = o.repo_path
				  )
			`, scanID, srcID, scanID); err != nil {
				return err
			}
			carriedOpt = true
		}
	}

	carriedNear := false
	if needNear {
		if srcID, ok := findSource("near_duplicates_state"); ok {
			if _, err := tx.Exec(`
				INSERT INTO near_duplicate_snapshots (
					scan_id, near_id, left_id, right_id, left_path, right_path, distance, flipped
				)
				SELECT ?, n.near_id, n.left_id, n.right_id, n.left_path, n.right_path, n.distance, n.flipped
				FROM near_duplicate_snapshots n
				WHERE n.scan_id = ?
				  AND EXISTS (SELECT 1 FROM asset_snapshots a WHERE a.scan_id = ? AND a.asset_id = n.left_id)
				  AND EXISTS (SELECT 1 FROM asset_snapshots a WHERE a.scan_id = ? AND a.asset_id = n.right_id)
			`, scanID, srcID, scanID, scanID); err != nil {
				return err
			}
			carriedNear = true
		}
	}

	if !carriedOpt && !carriedNear {
		return nil
	}

	optState := analysis.Optimization
	if carriedOpt {
		optState = scanner.AnalysisComputed
	}
	nearState := analysis.NearDuplicates
	if carriedNear {
		nearState = scanner.AnalysisComputed
	}

	_, err := tx.Exec(`
		UPDATE scans SET
			optimization_state = ?,
			near_duplicates_state = ?,
			near_duplicates = (SELECT COUNT(*) FROM near_duplicate_snapshots WHERE scan_id = ?)
		WHERE id = ?
	`, optState, nearState, scanID, scanID)
	return err
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
	if item.OptimizeApplicability == "" {
		item.OptimizeApplicability = scanner.OptimizeApplicable
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
	rows, err := s.rdb.Query(`
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
	row := s.rdb.QueryRow(`
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

	var baseBytes, targetBytes, baseSavings, targetSavings int64
	err = s.rdb.QueryRow(`
		SELECT
			COALESCE((SELECT SUM(bytes) FROM asset_snapshots WHERE scan_id = ?), 0),
			COALESCE((SELECT SUM(bytes) FROM asset_snapshots WHERE scan_id = ?), 0),
			COALESCE((SELECT SUM(savings_bytes) FROM optimization_snapshots WHERE scan_id = ?), 0),
			COALESCE((SELECT SUM(savings_bytes) FROM optimization_snapshots WHERE scan_id = ?), 0)
	`, baseID, targetID, baseID, targetID).Scan(&baseBytes, &targetBytes, &baseSavings, &targetSavings)
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

	if err := s.diffAdded(&diff, baseID, targetID); err != nil {
		return ScanDiff{}, err
	}
	if err := s.diffRemoved(&diff, baseID, targetID); err != nil {
		return ScanDiff{}, err
	}
	if err := s.diffChanged(&diff, baseID, targetID); err != nil {
		return ScanDiff{}, err
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

const diffAssetCols = `project_id, project_name, repo_path, ext, bytes, COALESCE(content_hash, ''), used_count, COALESCE(usage_classification, 'notApplicable')`

func scanDiffAsset(sc interface{ Scan(...any) error }) (scanAssetSnapshot, error) {
	var a scanAssetSnapshot
	err := sc.Scan(&a.ProjectID, &a.ProjectName, &a.RepoPath, &a.Ext, &a.Bytes, &a.ContentHash, &a.UsedCount, &a.UsageClassification)
	return a, err
}

func (s *Store) diffAdded(diff *ScanDiff, baseID, targetID int64) error {
	rows, err := s.rdb.Query(`
		SELECT `+diffAssetCols+`
		FROM asset_snapshots t
		WHERE t.scan_id = ?
		  AND NOT EXISTS (
			SELECT 1 FROM asset_snapshots b
			WHERE b.scan_id = ? AND b.project_id = t.project_id AND b.repo_path = t.repo_path
		  )
	`, targetID, baseID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanDiffAsset(rows)
		if err != nil {
			return err
		}
		diff.Added = append(diff.Added, addedDiff(a))
	}
	return rows.Err()
}

func (s *Store) diffRemoved(diff *ScanDiff, baseID, targetID int64) error {
	rows, err := s.rdb.Query(`
		SELECT `+diffAssetCols+`
		FROM asset_snapshots b
		WHERE b.scan_id = ?
		  AND NOT EXISTS (
			SELECT 1 FROM asset_snapshots t
			WHERE t.scan_id = ? AND t.project_id = b.project_id AND t.repo_path = b.repo_path
		  )
	`, baseID, targetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanDiffAsset(rows)
		if err != nil {
			return err
		}
		diff.Removed = append(diff.Removed, removedDiff(a))
	}
	return rows.Err()
}

func (s *Store) diffChanged(diff *ScanDiff, baseID, targetID int64) error {
	rows, err := s.rdb.Query(`
		SELECT
			t.project_id, t.project_name, t.repo_path, t.ext,
			b.bytes, COALESCE(b.content_hash, ''), b.used_count, COALESCE(b.usage_classification, 'notApplicable'),
			t.bytes, COALESCE(t.content_hash, ''), t.used_count, COALESCE(t.usage_classification, 'notApplicable')
		FROM asset_snapshots t
		JOIN asset_snapshots b ON b.scan_id = ? AND b.project_id = t.project_id AND b.repo_path = t.repo_path
		WHERE t.scan_id = ?
		  AND (t.content_hash != b.content_hash OR t.bytes != b.bytes
			OR t.used_count != b.used_count OR t.usage_classification != b.usage_classification)
	`, baseID, targetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var before, after scanAssetSnapshot
		if err := rows.Scan(
			&after.ProjectID, &after.ProjectName, &after.RepoPath, &after.Ext,
			&before.Bytes, &before.ContentHash, &before.UsedCount, &before.UsageClassification,
			&after.Bytes, &after.ContentHash, &after.UsedCount, &after.UsageClassification,
		); err != nil {
			return err
		}
		before.ProjectID = after.ProjectID
		before.ProjectName = after.ProjectName
		before.RepoPath = after.RepoPath
		before.Ext = after.Ext

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
	return rows.Err()
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

package config

import (
	"aisets/internal/optimize"
	"aisets/internal/scanner"
)

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
	for i := range opts {
		opts[i].Operation = optimize.SuggestionOperation(opts[i].SuggestionCode, item.Ext)
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

func (s *Store) assetReferences(scanID int64, assetID string) ([]scanner.AssetReference, error) {
	rows, err := s.rdb.Query(`
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
	rows, err := s.rdb.Query(`
		SELECT category, severity, reason_code, suggestion_code, estimated_bytes, savings_bytes, has_existing_variant, variant_bytes
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
		if err := rows.Scan(&opt.Category, &opt.Severity, &opt.ReasonCode, &opt.SuggestionCode, &opt.EstimatedBytes, &opt.SavingsBytes, &opt.HasExistingVariant, &opt.VariantBytes); err != nil {
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
	rows, err := s.rdb.Query(`
		SELECT `+catalogAssetSelectColumns+`
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
	rows, err := s.rdb.Query(`
		SELECT near_id, left_id, right_id, left_path, right_path, distance, flipped
		FROM near_duplicate_snapshots WHERE scan_id = ? AND left_id = ?
		UNION ALL
		SELECT near_id, left_id, right_id, left_path, right_path, distance, flipped
		FROM near_duplicate_snapshots WHERE scan_id = ? AND right_id = ?
		ORDER BY distance ASC, left_path ASC, right_path ASC
	`, scanID, assetID, scanID, assetID)
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
	ids := make([]string, 0, len(near))
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
		ids = append(ids, otherID)
	}
	return s.catalogItemsByIDs(scanID, ids)
}

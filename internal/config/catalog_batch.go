package config

import "asset-studio/internal/scanner"

func (s *Store) CatalogItemsByIDs(scanID int64, ids []string) ([]scanner.AssetItem, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return nil, err
	}
	items, err := s.catalogItemsByIDs(scanID, ids)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateAssetReferences(scanID, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CatalogItemsWithOptimizationByIDs(scanID int64, ids []string) ([]scanner.AssetItem, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return nil, err
	}
	items, err := s.catalogItemsByIDs(scanID, ids)
	if err != nil {
		return nil, err
	}
	if err := s.hydrateAssetOptimization(scanID, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) AllOptimizableItems(scanID int64) ([]scanner.AssetItem, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT `+catalogAssetSelectColumns+`
		FROM asset_snapshots a
		LEFT JOIN duplicate_group_assets d ON d.scan_id = a.scan_id AND d.asset_id = a.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = a.scan_id AND g.group_id = d.group_id
		WHERE a.scan_id = ? AND EXISTS (
			SELECT 1 FROM optimization_snapshots o
			WHERE o.scan_id = a.scan_id AND o.asset_id = a.asset_id
		)
		`+catalogItemOrder("path")+`
	`, scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []scanner.AssetItem{}
	for rows.Next() {
		item, err := scanAssetFromRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.hydrateAssetOptimization(scanID, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) catalogItemsByIDs(scanID int64, ids []string) ([]scanner.AssetItem, error) {
	uniqueIDs := uniqueNonEmptyStrings(ids)
	if len(uniqueIDs) == 0 {
		return []scanner.AssetItem{}, nil
	}
	idClause, idArgs := inClauseSQL("a.asset_id", uniqueIDs)
	args := append([]any{scanID}, idArgs...)
	rows, err := s.db.Query(`
		SELECT `+catalogAssetSelectColumns+`
		FROM asset_snapshots a
		LEFT JOIN duplicate_group_assets d ON d.scan_id = a.scan_id AND d.asset_id = a.asset_id
		LEFT JOIN duplicate_group_snapshots g ON g.scan_id = a.scan_id AND g.group_id = d.group_id
		WHERE a.scan_id = ? AND `+idClause+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := make(map[string]scanner.AssetItem, len(uniqueIDs))
	for rows.Next() {
		item, err := scanAssetFromRow(rows)
		if err != nil {
			return nil, err
		}
		byID[item.ID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]scanner.AssetItem, 0, len(ids))
	for _, id := range ids {
		if item, ok := byID[id]; ok {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Store) hydrateAssetReferences(scanID int64, items []scanner.AssetItem) error {
	ids := itemIDs(items)
	if len(ids) == 0 {
		return nil
	}
	idClause, idArgs := inClauseSQL("asset_id", ids)
	args := append([]any{scanID}, idArgs...)
	rows, err := s.db.Query(`
		SELECT asset_id, file, line, specifier, kind
		FROM reference_snapshots
		WHERE scan_id = ? AND `+idClause+`
		ORDER BY asset_id ASC, file ASC, line ASC, specifier ASC
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	refsByID := make(map[string][]scanner.AssetReference, len(ids))
	for rows.Next() {
		var assetID string
		var ref scanner.AssetReference
		if err := rows.Scan(&assetID, &ref.File, &ref.Line, &ref.Specifier, &ref.Kind); err != nil {
			return err
		}
		refsByID[assetID] = append(refsByID[assetID], ref)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		refs := refsByID[items[index].ID]
		if refs == nil {
			refs = []scanner.AssetReference{}
		}
		items[index].References = refs
		items[index].UsedBy = uniqueReferenceFiles(refs)
	}
	return nil
}

func (s *Store) hydrateAssetOptimization(scanID int64, items []scanner.AssetItem) error {
	ids := itemIDs(items)
	if len(ids) == 0 {
		return nil
	}
	idClause, idArgs := inClauseSQL("asset_id", ids)
	args := append([]any{scanID}, idArgs...)
	rows, err := s.db.Query(`
		SELECT asset_id, category, severity, reason_code, suggestion_code, estimated_bytes, savings_bytes
		FROM optimization_snapshots
		WHERE scan_id = ? AND `+idClause+`
		ORDER BY asset_id ASC, severity ASC, category ASC
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	optsByID := make(map[string][]scanner.OptimizationSuggestion, len(ids))
	for rows.Next() {
		var assetID string
		var opt scanner.OptimizationSuggestion
		if err := rows.Scan(&assetID, &opt.Category, &opt.Severity, &opt.ReasonCode, &opt.SuggestionCode, &opt.EstimatedBytes, &opt.SavingsBytes); err != nil {
			return err
		}
		optsByID[assetID] = append(optsByID[assetID], opt)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		opts := optsByID[items[index].ID]
		if opts == nil {
			opts = []scanner.OptimizationSuggestion{}
		}
		items[index].Optimization = opts
	}
	return nil
}

func itemIDs(items []scanner.AssetItem) []string {
	ids := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.ID == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		ids = append(ids, item.ID)
	}
	return ids
}

func uniqueNonEmptyStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

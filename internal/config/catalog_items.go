package config

import (
	"database/sql"
	"errors"
	"strconv"

	"aisets/internal/apierr"
	"aisets/internal/scanner"
)

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
	if err := s.rdb.QueryRow(totalQuery, args...).Scan(&total); err != nil {
		return CatalogItemsPage{}, err
	}
	orderBy := catalogItemOrder(query.Sort)
	args = append(args, limit+1, offset)
	rows, err := s.rdb.Query(`
		SELECT `+catalogAssetSelectColumns+`
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
	if err := s.hydrateAssetOptimization(scanID, items); err != nil {
		return CatalogItemsPage{}, err
	}
	facets, err := s.catalogItemFacets(scanID, query)
	if err != nil {
		return CatalogItemsPage{}, err
	}
	return CatalogItemsPage{Items: items, Total: total, NextCursor: next, Facets: facets}, nil
}

func (s *Store) CatalogItem(scanID int64, assetID string) (scanner.AssetItem, error) {
	scanID, err := s.resolveScanID(scanID)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	row := s.rdb.QueryRow(`
		SELECT `+catalogAssetSelectColumns+`
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

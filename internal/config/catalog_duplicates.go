package config

import (
	"strconv"

	"asset-studio/internal/scanner"
)

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

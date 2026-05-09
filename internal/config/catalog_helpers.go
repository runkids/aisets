package config

import (
	"sort"
	"strconv"
	"strings"

	"aisets/internal/scanner"
)

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

func uniqueReferenceFiles(refs []scanner.AssetReference) []string {
	seen := map[string]bool{}
	for _, ref := range refs {
		seen[ref.File] = true
	}
	out := make([]string, 0, len(seen))
	for file := range seen {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}

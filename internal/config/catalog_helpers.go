package config

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"aisets/internal/scanner"
)

var validLocales = map[string]bool{
	"en": true, "zh-TW": true, "zh-CN": true, "ja": true, "ko": true,
}

func validLocaleOrEmpty(locale string) string {
	if validLocales[locale] {
		return locale
	}
	return ""
}

func (s *Store) resolveScanID(scanID int64) (int64, error) {
	if scanID > 0 {
		return scanID, nil
	}
	s.latestScanMu.RLock()
	if s.latestScanID > 0 && time.Since(s.latestScanTime) < 5*time.Second {
		id := s.latestScanID
		s.latestScanMu.RUnlock()
		return id, nil
	}
	s.latestScanMu.RUnlock()

	scan, err := s.LatestScan()
	if err != nil {
		return 0, err
	}

	s.latestScanMu.Lock()
	s.latestScanID = scan.ID
	s.latestScanTime = time.Now()
	s.latestScanMu.Unlock()

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

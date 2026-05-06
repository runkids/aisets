package config

import (
	"strings"
	"time"
)

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func normalizePatterns(patterns []string) []string {
	out := make([]string, 0, len(patterns))
	seen := map[string]struct{}{}
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		out = append(out, pattern)
	}
	return out
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

package config

import (
	"strconv"
	"strings"

	"asset-studio/internal/lint"
)

func (s *Store) CatalogLint(query CatalogLintQuery) (CatalogLintPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogLintPage{}, err
	}
	limit := normalizeCatalogLimit(query.Limit)
	offset := parseCursorOffset(query.Cursor)
	clauses := []string{"scan_id = ?"}
	args := []any{scanID}
	if strings.TrimSpace(query.Severity) != "" {
		clauses = append(clauses, "severity = ?")
		args = append(args, strings.TrimSpace(query.Severity))
	}
	where := "WHERE " + strings.Join(clauses, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM lint_snapshots `+where, args...).Scan(&total); err != nil {
		return CatalogLintPage{}, err
	}
	args = append(args, limit+1, offset)
	rows, err := s.db.Query(`
		SELECT rule_id, severity, file, line, snippet, message, suggestion, asset_id
		FROM lint_snapshots
		`+where+`
		ORDER BY severity ASC, file ASC, line ASC, rule_id ASC
		LIMIT ? OFFSET ?
	`, args...)
	if err != nil {
		return CatalogLintPage{}, err
	}
	defer rows.Close()
	items := []lint.Finding{}
	for rows.Next() {
		var finding lint.Finding
		if err := rows.Scan(&finding.RuleID, &finding.Severity, &finding.File, &finding.Line, &finding.Snippet, &finding.Message, &finding.Suggestion, &finding.AssetID); err != nil {
			return CatalogLintPage{}, err
		}
		items = append(items, finding)
	}
	if err := rows.Err(); err != nil {
		return CatalogLintPage{}, err
	}
	next := ""
	if len(items) > limit {
		items = items[:limit]
		next = strconv.Itoa(offset + limit)
	}
	return CatalogLintPage{Items: items, Total: total, NextCursor: next}, nil
}

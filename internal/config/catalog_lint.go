package config

import (
	"strconv"
	"strings"

	"aisets/internal/lint"
)

func (s *Store) CatalogLint(query CatalogLintQuery) (CatalogLintPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogLintPage{}, err
	}

	baseClauses, baseArgs := lintBaseClauses(scanID, query)
	filterClauses, filterArgs := lintFilterClauses(query)

	allClauses := append(baseClauses, filterClauses...)
	allArgs := append(baseArgs, filterArgs...)
	where := "WHERE " + strings.Join(allClauses, " AND ")

	var total int
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM lint_snapshots l `+where, allArgs...).Scan(&total); err != nil {
		return CatalogLintPage{}, err
	}

	facets, err := s.lintFacets(scanID, query)
	if err != nil {
		return CatalogLintPage{}, err
	}

	limit := normalizeCatalogLimit(query.Limit)
	offset := parseCursorOffset(query.Cursor)
	pagingArgs := append(append([]any{}, allArgs...), limit+1, offset)
	rows, err := s.rdb.Query(`
		SELECT l.rule_id, l.severity, l.file, l.line, l.snippet, l.message, l.suggestion, l.asset_id
		FROM lint_snapshots l
		`+where+`
		ORDER BY l.severity ASC, l.file ASC, l.line ASC, l.rule_id ASC
		LIMIT ? OFFSET ?
	`, pagingArgs...)
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
	return CatalogLintPage{Items: items, Total: total, NextCursor: next, Facets: facets}, nil
}

func lintBaseClauses(scanID int64, query CatalogLintQuery) ([]string, []any) {
	clauses := []string{"l.scan_id = ?"}
	args := []any{scanID}
	if pid := strings.TrimSpace(query.ProjectID); pid != "" {
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM asset_snapshots a
			WHERE a.scan_id = l.scan_id AND a.asset_id = l.asset_id AND a.project_id = ?
		)`)
		args = append(args, pid)
	}
	if q := strings.TrimSpace(query.Query); q != "" {
		like := "%" + q + "%"
		clauses = append(clauses, "(l.file LIKE ? OR l.rule_id LIKE ? OR l.message LIKE ?)")
		args = append(args, like, like, like)
	}
	return clauses, args
}

func lintProjectNameClause(query CatalogLintQuery) ([]string, []any) {
	if pn := strings.TrimSpace(query.ProjectName); pn != "" {
		return []string{`EXISTS (
			SELECT 1 FROM asset_snapshots a
			WHERE a.scan_id = l.scan_id AND a.asset_id = l.asset_id AND a.project_name = ?
		)`}, []any{pn}
	}
	return nil, nil
}

func lintFilterClauses(query CatalogLintQuery) ([]string, []any) {
	var clauses []string
	var args []any
	if pc, pa := lintProjectNameClause(query); len(pc) > 0 {
		clauses = append(clauses, pc...)
		args = append(args, pa...)
	}
	if sev := strings.TrimSpace(query.Severity); sev != "" {
		clauses = append(clauses, "l.severity = ?")
		args = append(args, sev)
	}
	if rid := strings.TrimSpace(query.RuleID); rid != "" {
		clauses = append(clauses, "l.rule_id = ?")
		args = append(args, rid)
	}
	return clauses, args
}

func (s *Store) lintFacets(scanID int64, query CatalogLintQuery) (CatalogLintFacets, error) {
	baseClauses, baseArgs := lintBaseClauses(scanID, query)

	// ── Project facets: apply severity+rule but NOT projectName ──
	projClauses := append([]string{}, baseClauses...)
	projArgs := append([]any{}, baseArgs...)
	if sev := strings.TrimSpace(query.Severity); sev != "" {
		projClauses = append(projClauses, "l.severity = ?")
		projArgs = append(projArgs, sev)
	}
	if rid := strings.TrimSpace(query.RuleID); rid != "" {
		projClauses = append(projClauses, "l.rule_id = ?")
		projArgs = append(projArgs, rid)
	}
	projWhere := "WHERE " + strings.Join(projClauses, " AND ")

	projects, err := s.lintFacetQuery(
		`SELECT a.project_name, COUNT(*) FROM lint_snapshots l
		 JOIN asset_snapshots a ON a.scan_id = l.scan_id AND a.asset_id = l.asset_id
		 `+projWhere+`
		 GROUP BY a.project_name ORDER BY COUNT(*) DESC, a.project_name ASC`,
		projArgs,
	)
	if err != nil {
		return CatalogLintFacets{}, err
	}

	var projTotal int
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM lint_snapshots l `+projWhere, projArgs...).Scan(&projTotal); err != nil {
		return CatalogLintFacets{}, err
	}

	// ── Severity facets: apply projectName+rule but NOT severity ──
	sevClauses := append([]string{}, baseClauses...)
	sevArgs := append([]any{}, baseArgs...)
	if pc, pa := lintProjectNameClause(query); len(pc) > 0 {
		sevClauses = append(sevClauses, pc...)
		sevArgs = append(sevArgs, pa...)
	}
	if rid := strings.TrimSpace(query.RuleID); rid != "" {
		sevClauses = append(sevClauses, "l.rule_id = ?")
		sevArgs = append(sevArgs, rid)
	}
	sevWhere := "WHERE " + strings.Join(sevClauses, " AND ")

	severities, err := s.lintFacetQuery(
		`SELECT l.severity, COUNT(*) FROM lint_snapshots l `+sevWhere+` GROUP BY l.severity ORDER BY l.severity ASC`,
		sevArgs,
	)
	if err != nil {
		return CatalogLintFacets{}, err
	}

	// ── Rule facets: apply projectName+severity but NOT rule ──
	ruleClauses := append([]string{}, baseClauses...)
	ruleArgs := append([]any{}, baseArgs...)
	if pc, pa := lintProjectNameClause(query); len(pc) > 0 {
		ruleClauses = append(ruleClauses, pc...)
		ruleArgs = append(ruleArgs, pa...)
	}
	if sev := strings.TrimSpace(query.Severity); sev != "" {
		ruleClauses = append(ruleClauses, "l.severity = ?")
		ruleArgs = append(ruleArgs, sev)
	}
	ruleWhere := "WHERE " + strings.Join(ruleClauses, " AND ")

	rules, err := s.lintFacetQuery(
		`SELECT l.rule_id, COUNT(*) FROM lint_snapshots l `+ruleWhere+` GROUP BY l.rule_id ORDER BY COUNT(*) DESC, l.rule_id ASC`,
		ruleArgs,
	)
	if err != nil {
		return CatalogLintFacets{}, err
	}

	return CatalogLintFacets{
		Projects:     projects,
		ProjectTotal: projTotal,
		Severities:   severities,
		Rules:        rules,
	}, nil
}

func (s *Store) lintFacetQuery(sql string, args []any) ([]CatalogFacetOption, error) {
	rows, err := s.rdb.Query(sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var facets []CatalogFacetOption
	for rows.Next() {
		var f CatalogFacetOption
		if err := rows.Scan(&f.ID, &f.Count); err != nil {
			return nil, err
		}
		facets = append(facets, f)
	}
	if facets == nil {
		facets = []CatalogFacetOption{}
	}
	return facets, rows.Err()
}

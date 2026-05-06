package config

import (
	"regexp"
	"strconv"
	"strings"

	"asset-studio/internal/apierr"
)

var customFilterIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

func normalizeCustomAssetFilters(filters []CustomAssetFilter) ([]CustomAssetFilter, error) {
	if filters == nil {
		return []CustomAssetFilter{}, nil
	}
	seen := map[string]struct{}{}
	out := make([]CustomAssetFilter, 0, len(filters))
	for index, filter := range filters {
		filter.ID = strings.TrimSpace(filter.ID)
		filter.Name = strings.TrimSpace(filter.Name)
		if filter.ID == "" || !customFilterIDPattern.MatchString(filter.ID) {
			return nil, apierr.WithParams("custom_filter_id_invalid", "custom filter id is invalid", map[string]any{"index": index, "id": filter.ID})
		}
		if _, ok := seen[filter.ID]; ok {
			return nil, apierr.WithParams("custom_filter_id_duplicate", "custom filter id must be unique", map[string]any{"id": filter.ID})
		}
		seen[filter.ID] = struct{}{}
		if filter.Name == "" {
			return nil, apierr.WithParams("custom_filter_name_required", "custom filter name is required", map[string]any{"id": filter.ID})
		}
		if len(filter.Groups) == 0 {
			return nil, apierr.WithParams("custom_filter_group_required", "custom filter requires at least one group", map[string]any{"id": filter.ID})
		}
		for groupIndex := range filter.Groups {
			if len(filter.Groups[groupIndex].Clauses) == 0 {
				return nil, apierr.WithParams("custom_filter_clause_required", "custom filter group requires at least one clause", map[string]any{"id": filter.ID, "group": groupIndex})
			}
			for clauseIndex := range filter.Groups[groupIndex].Clauses {
				clause, err := normalizeCustomAssetFilterClause(filter.Groups[groupIndex].Clauses[clauseIndex])
				if err != nil {
					if coded, ok := err.(apierr.Error); ok {
						if coded.Params == nil {
							coded.Params = map[string]any{}
						}
						coded.Params["id"] = filter.ID
						coded.Params["group"] = groupIndex
						coded.Params["clause"] = clauseIndex
						return nil, coded
					}
					return nil, err
				}
				filter.Groups[groupIndex].Clauses[clauseIndex] = clause
			}
		}
		out = append(out, filter)
	}
	return out, nil
}

func normalizeCustomAssetFilterClause(clause CustomAssetFilterClause) (CustomAssetFilterClause, error) {
	clause.Field = strings.TrimSpace(clause.Field)
	clause.Operator = strings.TrimSpace(clause.Operator)
	clause.Value = strings.TrimSpace(clause.Value)
	if clause.Field == "" || clause.Operator == "" {
		return CustomAssetFilterClause{}, apierr.New("custom_filter_clause_invalid", "custom filter clause is invalid")
	}
	switch clause.Field {
	case "path":
		if !isOneOf(clause.Operator, "contains", "prefix", "suffix", "equals", "regex") {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if err := validateCustomFilterTextValue(clause); err != nil {
			return CustomAssetFilterClause{}, err
		}
	case "folder":
		if !isOneOf(clause.Operator, "contains", "prefix", "suffix", "equals", "regex") {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if err := validateCustomFilterTextValue(clause); err != nil {
			return CustomAssetFilterClause{}, err
		}
	case "extension":
		if !isOneOf(clause.Operator, "equals", "oneOf") {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if clause.Value == "" || len(splitCustomFilterList(clause.Value)) == 0 {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_value_required", "custom filter clause value is required")
		}
	case "project":
		if !isOneOf(clause.Operator, "equals", "contains", "oneOf") {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if clause.Value == "" || (clause.Operator == "oneOf" && len(splitCustomFilterList(clause.Value)) == 0) {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_value_required", "custom filter clause value is required")
		}
	case "bytes":
		if clause.Operator != "gte" && clause.Operator != "lte" {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		value, err := strconv.ParseInt(clause.Value, 10, 64)
		if err != nil || value < 0 {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_bytes_invalid", "custom filter bytes value is invalid")
		}
	case "status":
		if clause.Operator != "is" {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if clause.Value != "unused" && clause.Value != "referenced" {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_status_invalid", "custom filter status is invalid")
		}
	case "duplicate", "nearDuplicate", "optimizable":
		if clause.Operator != "is" {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_operator_invalid", "custom filter operator is invalid")
		}
		if clause.Value != "true" && clause.Value != "false" {
			return CustomAssetFilterClause{}, apierr.New("custom_filter_boolean_invalid", "custom filter boolean value is invalid")
		}
	default:
		return CustomAssetFilterClause{}, apierr.New("custom_filter_field_invalid", "custom filter field is invalid")
	}
	return clause, nil
}

func validateCustomFilterTextValue(clause CustomAssetFilterClause) error {
	if clause.Value == "" {
		return apierr.New("custom_filter_value_required", "custom filter clause value is required")
	}
	if clause.Operator == "regex" {
		if _, err := regexp.Compile(clause.Value); err != nil {
			return apierr.New("custom_filter_regex_invalid", "custom filter regex is invalid")
		}
	}
	return nil
}

func splitCustomFilterList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func isOneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}

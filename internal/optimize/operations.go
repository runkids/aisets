package optimize

import (
	"strings"
)

type operationRule struct {
	SuggestionCode string
	Exts           []string
	Operation      string
}

var operationRules = []operationRule{
	{SuggestionCode: "preview_svg_minify", Operation: "svg-minify"},
	{SuggestionCode: "use_responsive_or_smaller_source", Operation: "resize-variant"},
	{SuggestionCode: "try_alpha_preserving_format", Exts: []string{".png"}, Operation: "convert-webp"},
	{SuggestionCode: "try_modern_photographic_format", Exts: []string{".png", ".jpg", ".jpeg"}, Operation: "convert-avif"},
	{SuggestionCode: "review_compression_or_modern_format", Exts: []string{".png", ".jpg", ".jpeg"}, Operation: "convert-avif"},
	{SuggestionCode: "review_compression_or_modern_format", Exts: []string{".webp"}, Operation: "webp-recompress"},
	{SuggestionCode: "review_compression_or_modern_format", Exts: []string{".gif"}, Operation: "gif-optimize"},
}

func SuggestionOperation(suggestionCode, ext string) string {
	ext = strings.ToLower(strings.TrimSpace(ext))
	for _, rule := range operationRules {
		if rule.SuggestionCode != suggestionCode {
			continue
		}
		if len(rule.Exts) == 0 || containsString(rule.Exts, ext) {
			return rule.Operation
		}
	}
	return "manual-review"
}

func OperationSQL(suggestionColumn, extColumn string) string {
	var b strings.Builder
	b.WriteString("CASE\n")
	for _, rule := range operationRules {
		b.WriteString("\t\tWHEN ")
		b.WriteString(suggestionColumn)
		b.WriteString(" = ")
		b.WriteString(sqlString(rule.SuggestionCode))
		if len(rule.Exts) > 0 {
			b.WriteString(" AND LOWER(")
			b.WriteString(extColumn)
			b.WriteString(") IN (")
			for index, ext := range rule.Exts {
				if index > 0 {
					b.WriteString(", ")
				}
				b.WriteString(sqlString(ext))
			}
			b.WriteString(")")
		}
		b.WriteString(" THEN ")
		b.WriteString(sqlString(rule.Operation))
		b.WriteString("\n")
	}
	b.WriteString("\t\tELSE 'manual-review'\n\tEND")
	return b.String()
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func sqlString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

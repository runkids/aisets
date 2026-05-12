package server

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"

	"aisets/internal/aitag"
	"aisets/internal/scanner"
)

var defaultEmbedInputFields = []string{"category", "tags", "description"}

func normalizeEmbedInputFields(fields []string) []string {
	if len(fields) == 0 {
		return append([]string{}, defaultEmbedInputFields...)
	}
	allowed := map[string]bool{
		"category":    true,
		"tags":        true,
		"description": true,
		"fileName":    true,
		"ocrText":     true,
	}
	out := make([]string, 0, len(fields))
	seen := map[string]bool{}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if !allowed[field] || seen[field] {
			continue
		}
		out = append(out, field)
		seen[field] = true
	}
	if len(out) == 0 {
		return append([]string{}, defaultEmbedInputFields...)
	}
	return out
}

func embedInputFieldsContain(fields []string, needle string) bool {
	for _, field := range normalizeEmbedInputFields(fields) {
		if field == needle {
			return true
		}
	}
	return false
}

func buildEmbeddingInput(item scanner.AssetItem, tagResult aitag.Result, ocrText string, fields []string) string {
	tagResult = aitag.ResultWithEnglishFallback(tagResult)
	if !aitag.IsResultUsable(tagResult) {
		return ""
	}

	parts := make([]string, 0, len(fields)+len(tagResult.Tags))
	for _, field := range normalizeEmbedInputFields(fields) {
		switch field {
		case "category":
			if value := normalizeEmbeddingText(tagResult.Category); value != "" {
				parts = append(parts, value)
			}
		case "tags":
			if len(tagResult.Tags) > 0 {
				if value := normalizeEmbeddingText(strings.Join(tagResult.Tags, ", ")); value != "" {
					parts = append(parts, value)
				}
			}
		case "description":
			if value := normalizeEmbeddingText(tagResult.Description); value != "" {
				parts = append(parts, value)
			}
		case "fileName":
			if value := normalizedEmbeddingFileName(item.RepoPath); value != "" {
				parts = append(parts, value)
			}
		case "ocrText":
			if value := normalizeEmbeddingText(ocrText); value != "" {
				parts = append(parts, value)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func normalizedEmbeddingFileName(repoPath string) string {
	name := filepath.Base(repoPath)
	if ext := filepath.Ext(name); ext != "" {
		name = strings.TrimSuffix(name, ext)
	}
	name = strings.NewReplacer("_", " ", "-", " ", ".", " ").Replace(name)
	return normalizeEmbeddingText(name)
}

func normalizeEmbeddingText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func hashEmbeddingInput(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

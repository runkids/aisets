package aitag

import (
	"regexp"
	"strings"
)

var numberLikeText = regexp.MustCompile(`^\d+\.?$`)

func usableText(value string) bool {
	v := strings.TrimSpace(value)
	if v == "" || numberLikeText.MatchString(v) {
		return false
	}
	switch strings.ToLower(v) {
	case "...", "tag", "tags", "keyword", "keywords", "category", "description",
		"關鍵字", "關鍵字1", "關鍵字2", "類別", "陳述":
		return false
	default:
		return true
	}
}

// IsResultUsable returns true only for ready AI tag rows that contain enough
// real semantic text to be reused or embedded.
func IsResultUsable(result Result) bool {
	if result.Status != "" && result.Status != StatusReady {
		return false
	}
	if !usableText(result.Category) || !usableText(result.Description) {
		return false
	}
	if len(result.Tags) == 0 {
		return false
	}
	for _, tag := range result.Tags {
		if !usableText(tag) {
			return false
		}
	}
	return true
}

func validLocaleTags(rawTags []string, tags []string) bool {
	if len(tags) == 0 || len(tags) != len(rawTags) {
		return false
	}
	for _, tag := range tags {
		if !usableText(tag) {
			return false
		}
	}
	return true
}

// IsLocaleTranslationUsable validates a locale block against the raw tag row.
func IsLocaleTranslationUsable(raw Result, category string, tags []string, description string) bool {
	return usableText(category) && usableText(description) && validLocaleTags(raw.Tags, tags)
}

// ResultWithEnglishFallback overlays valid English i18n fields while falling
// back to raw AI tag text when the English field is malformed or misaligned.
func ResultWithEnglishFallback(result Result) Result {
	if v := strings.TrimSpace(result.CategoryI18n["en"]); usableText(v) {
		result.Category = v
	}
	if tags := result.TagsI18n["en"]; validLocaleTags(result.Tags, tags) {
		result.Tags = tags
	}
	if v := strings.TrimSpace(result.DescriptionI18n["en"]); usableText(v) {
		result.Description = v
	}
	return result
}

// CleanInvalidI18n removes locales whose category, tags, or description are
// clearly malformed for the raw AI tag row. It returns the cleaned result and
// the number of locale entries removed.
func CleanInvalidI18n(result Result) (Result, int) {
	locales := map[string]struct{}{}
	for locale := range result.CategoryI18n {
		locales[locale] = struct{}{}
	}
	for locale := range result.TagsI18n {
		locales[locale] = struct{}{}
	}
	for locale := range result.DescriptionI18n {
		locales[locale] = struct{}{}
	}

	removed := 0
	for locale := range locales {
		category := strings.TrimSpace(result.CategoryI18n[locale])
		description := strings.TrimSpace(result.DescriptionI18n[locale])
		tags := result.TagsI18n[locale]
		if !usableText(category) || !usableText(description) || !validLocaleTags(result.Tags, tags) {
			delete(result.CategoryI18n, locale)
			delete(result.TagsI18n, locale)
			delete(result.DescriptionI18n, locale)
			removed++
		}
	}
	return result, removed
}

package aitag

import (
	"strings"
	"testing"
)

func TestTagPromptLocalized_ZhTW(t *testing.T) {
	prompt := TagPromptLocalized("zh-TW")

	must := []string{
		"Traditional Chinese",
		`"categoryI18n"`,
		`"tagsI18n"`,
		`"descriptionI18n"`,
		`"en"`,
		`"zh-CN"`,
		`"ja"`,
		`"ko"`,
		"REQUIRED",
	}
	for _, s := range must {
		if !strings.Contains(prompt, s) {
			t.Errorf("prompt missing %q", s)
		}
	}

	mustNot := []string{
		"kebab-case",
		"{{translations}}",
		`"zh-TW"`,
	}
	for _, s := range mustNot {
		if strings.Contains(prompt, s) {
			t.Errorf("prompt should not contain %q", s)
		}
	}
}

func TestTagPromptLocalized_Ja(t *testing.T) {
	prompt := TagPromptLocalized("ja")

	if !strings.Contains(prompt, "Japanese") {
		t.Error("prompt missing Japanese locale name")
	}
	if !strings.Contains(prompt, `"en"`) {
		t.Error("prompt missing en in i18n locales")
	}
	if strings.Contains(prompt, `"ja"`) {
		t.Error("prompt should not list ja in i18n locales")
	}
}

func TestExcludeLocale(t *testing.T) {
	got := excludeLocale([]string{"en", "zh-TW", "ja"}, "zh-TW")
	if len(got) != 2 || got[0] != "en" || got[1] != "ja" {
		t.Errorf("excludeLocale = %v, want [en ja]", got)
	}
}

func TestTagTranslationsBlockForLocale_ExcludesPrimary(t *testing.T) {
	block := TagTranslationsBlockForLocale("ko")
	if strings.Contains(block, `"ko"`) {
		t.Error("block should not contain primary locale ko")
	}
	if !strings.Contains(block, `"en"`) {
		t.Error("block missing en")
	}
}

func TestTagTranslationsBlockForLocale_ZhTW(t *testing.T) {
	block := TagTranslationsBlockForLocale("zh-TW")

	must := []string{
		"NOT English kebab-case",
		"Traditional Chinese",
		"REQUIRED",
		`"tagsI18n"`,
		`"categoryI18n"`,
		`"descriptionI18n"`,
	}
	for _, s := range must {
		if !strings.Contains(block, s) {
			t.Errorf("block missing %q", s)
		}
	}
}

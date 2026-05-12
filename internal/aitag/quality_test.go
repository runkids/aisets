package aitag

import "testing"

func TestIsResultUsable(t *testing.T) {
	tests := []struct {
		name string
		in   Result
		want bool
	}{
		{
			name: "valid",
			in: Result{
				Status:      StatusReady,
				Category:    "icon",
				Tags:        []string{"button"},
				Description: "A primary action button",
			},
			want: true,
		},
		{
			name: "empty tags",
			in: Result{
				Status:      StatusReady,
				Category:    "icon",
				Tags:        []string{},
				Description: "A primary action button",
			},
			want: false,
		},
		{
			name: "number-like category",
			in: Result{
				Status:      StatusReady,
				Category:    "7.",
				Tags:        []string{"button"},
				Description: "A primary action button",
			},
			want: false,
		},
		{
			name: "template text",
			in: Result{
				Status:      StatusReady,
				Category:    "類別",
				Tags:        []string{"關鍵字1"},
				Description: "陳述",
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsResultUsable(tt.in); got != tt.want {
				t.Fatalf("IsResultUsable() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResultWithEnglishFallback(t *testing.T) {
	result := Result{
		Status:      StatusReady,
		Category:    "ui元素",
		Tags:        []string{"按鈕", "圓角"},
		Description: "橘色圓角按鈕",
		CategoryI18n: map[string]string{
			"en": "7.",
		},
		TagsI18n: map[string][]string{
			"en": {"Button", "Rounded"},
		},
		DescriptionI18n: map[string]string{
			"en": "Orange rounded button",
		},
	}

	got := ResultWithEnglishFallback(result)
	if got.Category != "ui元素" {
		t.Fatalf("invalid English category should fall back to raw, got %q", got.Category)
	}
	if got.Tags[0] != "Button" || got.Description != "Orange rounded button" {
		t.Fatalf("valid English fields should be used, got tags=%v desc=%q", got.Tags, got.Description)
	}

	result.TagsI18n["en"] = []string{"Button"}
	got = ResultWithEnglishFallback(result)
	if got.Tags[0] != "按鈕" {
		t.Fatalf("misaligned English tags should fall back to raw, got %v", got.Tags)
	}
}

func TestIsLocaleTranslationUsableForLocaleRawCategory(t *testing.T) {
	tests := []struct {
		name     string
		locale   string
		raw      string
		category string
		want     bool
	}{
		{name: "english raw can stay english", locale: "en", raw: "crafts", category: "crafts", want: true},
		{name: "chinese raw can stay chinese", locale: "zh-TW", raw: "動物", category: "動物", want: true},
		{name: "english raw cannot stay untranslated for chinese", locale: "zh-TW", raw: "crafts", category: "crafts", want: false},
		{name: "chinese raw cannot stay untranslated for english", locale: "en", raw: "動物", category: "動物", want: false},
		{name: "translated category is accepted", locale: "zh-TW", raw: "crafts", category: "手工藝", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := Result{
				Status:      StatusReady,
				Category:    tt.raw,
				Tags:        []string{"tag"},
				Description: "A usable description",
			}
			got := IsLocaleTranslationUsableForLocale(raw, tt.locale, tt.category, []string{"標籤"}, "可用的描述")
			if got != tt.want {
				t.Fatalf("IsLocaleTranslationUsableForLocale() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCleanInvalidI18n(t *testing.T) {
	result := Result{
		Status:      StatusReady,
		Category:    "icon",
		Tags:        []string{"button", "rounded"},
		Description: "A rounded button",
		CategoryI18n: map[string]string{
			"en":    "Icon",
			"zh-TW": "3.",
		},
		TagsI18n: map[string][]string{
			"en":    {"Button", "Rounded"},
			"zh-TW": {"按鈕"},
		},
		DescriptionI18n: map[string]string{
			"en":    "A rounded button",
			"zh-TW": "陳述",
		},
	}

	got, removed := CleanInvalidI18n(result)
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	if _, ok := got.CategoryI18n["zh-TW"]; ok {
		t.Fatal("invalid zh-TW locale should be removed")
	}
	if got.CategoryI18n["en"] != "Icon" {
		t.Fatalf("valid en locale should remain, got %+v", got.CategoryI18n)
	}
}

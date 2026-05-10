package server

import (
	"encoding/json"
	"testing"
)

func TestUnmarshalStringOrFirst(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"string", `"icon"`, "icon"},
		{"array single", `["photo"]`, "photo"},
		{"array multi", `["illustration","character"]`, "illustration"},
		{"empty array", `[]`, ""},
		{"null", `null`, ""},
		{"empty", ``, ""},
		{"number fallback", `42`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := unmarshalStringOrFirst(json.RawMessage(tt.raw))
			if got != tt.want {
				t.Errorf("unmarshalStringOrFirst(%s) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestParseAITagI18nFields(t *testing.T) {
	input := `{
		"category": "photo",
		"tags": ["boxing", "fighter"],
		"tagsI18n": {"zh-TW": ["拳擊", "格鬥家"], "ja": ["ボクシング", "ファイター"]},
		"description": "A boxer in a ring",
		"descriptionI18n": {"zh-TW": "拳擊手在擂台上", "ja": "リングのボクサー"},
		"languages": ["eng"],
		"containsFace": true,
		"sceneType": "indoor",
		"estimatedLocation": null,
		"locationConfidence": "none"
	}`
	content := stripMarkdownFences(input)
	var parsed struct {
		TagsI18n        map[string][]string `json:"tagsI18n"`
		DescriptionI18n map[string]string   `json:"descriptionI18n"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(parsed.TagsI18n) != 2 {
		t.Fatalf("tagsI18n length = %d, want 2", len(parsed.TagsI18n))
	}
	if parsed.TagsI18n["zh-TW"][0] != "拳擊" {
		t.Errorf("tagsI18n[zh-TW][0] = %q", parsed.TagsI18n["zh-TW"][0])
	}
	if parsed.DescriptionI18n["zh-TW"] != "拳擊手在擂台上" {
		t.Errorf("descriptionI18n[zh-TW] = %q", parsed.DescriptionI18n["zh-TW"])
	}
}

func TestParseAITagI18nMissing(t *testing.T) {
	input := `{"category":"icon","tags":["button"],"description":"A button","languages":[],"containsFace":false,"sceneType":"digital","estimatedLocation":null,"locationConfidence":"none"}`
	var parsed struct {
		TagsI18n        map[string][]string `json:"tagsI18n"`
		DescriptionI18n map[string]string   `json:"descriptionI18n"`
	}
	if err := json.Unmarshal([]byte(input), &parsed); err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed.TagsI18n != nil {
		t.Errorf("tagsI18n should be nil, got %v", parsed.TagsI18n)
	}
	if parsed.DescriptionI18n != nil {
		t.Errorf("descriptionI18n should be nil, got %v", parsed.DescriptionI18n)
	}
}

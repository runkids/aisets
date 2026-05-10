package config

import (
	"os"
	"path/filepath"
	"testing"
)

func openTestStoreForPresets(t *testing.T) *Store {
	t.Helper()
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestFormatPrompt(t *testing.T) {
	tests := []struct {
		name    string
		content PromptPresetContent
		want    string
	}{
		{
			name: "tags variable",
			content: PromptPresetContent{
				Template: "Use tags: {{tags}}",
				Variables: map[string]PromptVariable{
					"tags": {Type: PromptVarTags, Values: []string{"icon", "photo", "logo"}},
				},
			},
			want: "Use tags: icon, photo, logo",
		},
		{
			name: "text variable",
			content: PromptPresetContent{
				Template: "Style: {{style}}",
				Variables: map[string]PromptVariable{
					"style": {Type: PromptVarText, Values: []string{"minimalist"}},
				},
			},
			want: "Style: minimalist",
		},
		{
			name: "missing variable keeps placeholder",
			content: PromptPresetContent{
				Template:  "Use {{unknown}}",
				Variables: map[string]PromptVariable{},
			},
			want: "Use {{unknown}}",
		},
		{
			name: "multiple variables",
			content: PromptPresetContent{
				Template: "Tags: {{tags}}, Category: {{category}}",
				Variables: map[string]PromptVariable{
					"tags":     {Type: PromptVarTags, Values: []string{"a", "b"}},
					"category": {Type: PromptVarSelect, Values: []string{"icon"}},
				},
			},
			want: "Tags: a, b, Category: icon",
		},
		{
			name: "empty template",
			content: PromptPresetContent{
				Template:  "",
				Variables: map[string]PromptVariable{},
			},
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatPrompt(tt.content)
			if got != tt.want {
				t.Errorf("FormatPrompt() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCreateAndListPromptPresets(t *testing.T) {
	store := openTestStoreForPresets(t)

	p, err := store.CreatePromptPreset(PromptPreset{
		Type:    "tag",
		Name:    "My Tag Prompt",
		Content: PromptPresetContent{Template: "test {{tags}}", Variables: map[string]PromptVariable{"tags": {Type: PromptVarTags, Values: []string{"a"}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.ID == "" || p.CreatedAt == "" {
		t.Fatal("expected ID and CreatedAt to be set")
	}

	all, err := store.ListPromptPresets("")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, preset := range all {
		if preset.ID == p.ID {
			found = true
			if preset.Name != "My Tag Prompt" {
				t.Errorf("name = %q, want %q", preset.Name, "My Tag Prompt")
			}
		}
	}
	if !found {
		t.Fatal("created preset not found in list")
	}

	tagOnly, err := store.ListPromptPresets("tag")
	if err != nil {
		t.Fatal(err)
	}
	for _, preset := range tagOnly {
		if preset.Type != "tag" {
			t.Errorf("expected type=tag, got %q", preset.Type)
		}
	}
}

func TestCreatePresetValidation(t *testing.T) {
	store := openTestStoreForPresets(t)

	_, err := store.CreatePromptPreset(PromptPreset{Type: "tag", Name: ""})
	if err == nil {
		t.Fatal("expected error for empty name")
	}

	_, err = store.CreatePromptPreset(PromptPreset{Type: "invalid", Name: "test"})
	if err == nil {
		t.Fatal("expected error for invalid type")
	}
}

func TestDefaultSwap(t *testing.T) {
	store := openTestStoreForPresets(t)

	p1, err := store.CreatePromptPreset(PromptPreset{
		Type:      "tag",
		Name:      "First",
		Content:   PromptPresetContent{Template: "first"},
		IsDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	p2, err := store.CreatePromptPreset(PromptPreset{
		Type:      "tag",
		Name:      "Second",
		Content:   PromptPresetContent{Template: "second"},
		IsDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	got1, err := store.GetPromptPreset(p1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got1.IsDefault {
		t.Error("first preset should no longer be default")
	}

	got2, err := store.GetPromptPreset(p2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got2.IsDefault {
		t.Error("second preset should be default")
	}
}

func TestSetPromptPresetDefault(t *testing.T) {
	store := openTestStoreForPresets(t)

	p1, err := store.CreatePromptPreset(PromptPreset{
		Type:    "ocr",
		Name:    "OCR A",
		Content: PromptPresetContent{Template: "ocr-a"},
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := store.SetPromptPresetDefault(p1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsDefault {
		t.Error("expected IsDefault=true after SetDefault")
	}

	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.LLMOcrPrompt != "ocr-a" {
		t.Errorf("settings.LLMOcrPrompt = %q, want %q", settings.LLMOcrPrompt, "ocr-a")
	}
}

func TestDeleteDefaultPresetFails(t *testing.T) {
	store := openTestStoreForPresets(t)

	p, err := store.CreatePromptPreset(PromptPreset{
		Type:      "tag",
		Name:      "Default",
		Content:   PromptPresetContent{Template: "default"},
		IsDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	err = store.DeletePromptPreset(p.ID)
	if err == nil {
		t.Fatal("expected error when deleting default preset")
	}
}

func TestDeleteNonDefaultPreset(t *testing.T) {
	store := openTestStoreForPresets(t)

	p, err := store.CreatePromptPreset(PromptPreset{
		Type:    "tag",
		Name:    "Deletable",
		Content: PromptPresetContent{Template: "delete me"},
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := store.DeletePromptPreset(p.ID); err != nil {
		t.Fatal(err)
	}

	_, err = store.GetPromptPreset(p.ID)
	if err == nil {
		t.Fatal("expected error after deletion")
	}
}

func TestUpdatePromptPreset(t *testing.T) {
	store := openTestStoreForPresets(t)

	p, err := store.CreatePromptPreset(PromptPreset{
		Type:    "tag",
		Name:    "Original",
		Content: PromptPresetContent{Template: "original"},
	})
	if err != nil {
		t.Fatal(err)
	}

	newName := "Updated"
	newContent := &PromptPresetContent{Template: "updated {{tags}}", Variables: map[string]PromptVariable{"tags": {Type: PromptVarTags, Values: []string{"x"}}}}
	updated, err := store.UpdatePromptPreset(p.ID, &newName, newContent, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Updated" {
		t.Errorf("name = %q, want %q", updated.Name, "Updated")
	}
	if updated.Content.Template != "updated {{tags}}" {
		t.Errorf("template = %q", updated.Content.Template)
	}
}

func TestMigrationSeedsDefaults(t *testing.T) {
	store := openTestStoreForPresets(t)

	tagPresets, err := store.ListPromptPresets("tag")
	if err != nil {
		t.Fatal(err)
	}
	if len(tagPresets) == 0 {
		t.Fatal("expected at least one tag preset from migration")
	}
	hasDefault := false
	for _, p := range tagPresets {
		if p.IsDefault {
			hasDefault = true
		}
	}
	if !hasDefault {
		t.Error("expected a default tag preset from migration")
	}

	ocrPresets, err := store.ListPromptPresets("ocr")
	if err != nil {
		t.Fatal(err)
	}
	if len(ocrPresets) == 0 {
		t.Fatal("expected at least one ocr preset from migration")
	}
}

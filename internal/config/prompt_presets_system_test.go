package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSyncDefaultToSettings_System(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	content := PromptPresetContent{
		Template:  "Always respond in {{language}}.",
		Variables: map[string]PromptVariable{"language": {Type: PromptVarSelect, Values: []string{"zh-TW"}}},
	}

	preset, err := store.CreatePromptPreset(PromptPreset{
		Type:      "system",
		Name:      "Chinese",
		Content:   content,
		IsDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.SetPromptPresetDefault(preset.ID)
	if err != nil {
		t.Fatal(err)
	}

	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}

	want := "Always respond in zh-TW."
	if settings.LLMSystemPrompt != want {
		t.Errorf("LLMSystemPrompt = %q, want %q", settings.LLMSystemPrompt, want)
	}
}

func TestSyncDefaultToSettings_SystemClearsOnEmpty(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	preset, err := store.CreatePromptPreset(PromptPreset{
		Type:      "system",
		Name:      "Empty",
		Content:   PromptPresetContent{Template: "Hello", Variables: map[string]PromptVariable{}},
		IsDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.SetPromptPresetDefault(preset.ID)

	emptyContent := PromptPresetContent{Template: "", Variables: map[string]PromptVariable{}}
	_, err = store.UpdatePromptPreset(preset.ID, nil, &emptyContent, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.SetPromptPresetDefault(preset.ID)

	settings, _ := store.Settings()
	if settings.LLMSystemPrompt != "" {
		t.Errorf("LLMSystemPrompt = %q, want empty", settings.LLMSystemPrompt)
	}
}

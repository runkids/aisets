package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aisets/internal/aitag"
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

func TestBuildEmbeddingInputHonorsFields(t *testing.T) {
	item := scanner.AssetItem{RepoPath: "icons/primary-button_icon.png"}
	tag := aitag.Result{
		Status:      aitag.StatusReady,
		Category:    "icon",
		Tags:        []string{"primary-button", "rounded"},
		Description: "A rounded primary button icon",
	}

	got := buildEmbeddingInput(item, tag, "Checkout", []string{"category", "fileName", "ocrText"})
	want := "icon\nprimary button icon\nCheckout"
	if got != want {
		t.Fatalf("embedding input mismatch:\ngot  %q\nwant %q", got, want)
	}
}

func TestBuildEmbeddingInputFallsBackFromInvalidEnglishI18n(t *testing.T) {
	item := scanner.AssetItem{RepoPath: "icons/cart.png"}
	tag := aitag.Result{
		Status:          aitag.StatusReady,
		Category:        "icon",
		Tags:            []string{"cart", "checkout"},
		Description:     "A cart checkout icon",
		CategoryI18n:    map[string]string{"en": "7."},
		TagsI18n:        map[string][]string{"en": {"Cart"}},
		DescriptionI18n: map[string]string{"en": "..."},
	}

	got := buildEmbeddingInput(item, tag, "", []string{"category", "tags", "description"})
	want := "icon\ncart, checkout\nA cart checkout icon"
	if got != want {
		t.Fatalf("embedding input mismatch:\ngot  %q\nwant %q", got, want)
	}
}

func TestParseI18nBackfillResponse(t *testing.T) {
	items, err := parseI18nBackfillResponse(`{"translations":[{"id":2,"category":"Icon","tags":["Button","Primary"],"description":"Primary button"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != 2 || items[0].Tags[1] != "Primary" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestTargetTranslationLocalesUsesConfiguredLocales(t *testing.T) {
	got := targetTranslationLocales(config.AppSettings{LLMTranslationLocales: []string{"zh-TW", "ja"}}, "ko")
	want := []string{"en", "zh-TW", "ja"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("locales mismatch: got %v want %v", got, want)
	}
}

type fakeTranslateProvider struct {
	fakeEmbedProvider
	content string
	err     error
}

func (p fakeTranslateProvider) Chat(context.Context, llm.ChatRequest) (llm.ChatResponse, error) {
	if p.err != nil {
		return llm.ChatResponse{}, p.err
	}
	return llm.ChatResponse{Content: p.content}, nil
}

func seedReadyAITag(t *testing.T, store *config.Store) {
	t.Helper()
	projectRoot := resolvedTempDir(t)
	if err := store.AddProjects([]string{projectRoot}); err != nil {
		t.Fatal(err)
	}
	projectID := store.Projects()[0].ID
	if err := store.UpsertAITagResult(aitag.Result{
		ProjectID:     projectID,
		RepoPath:      "icons/button.png",
		ContentHash:   "hash-button",
		HashAlgorithm: "sha1",
		ProviderName:  "ollama",
		ModelName:     "vision",
		Status:        aitag.StatusReady,
		Category:      "icon",
		Tags:          []string{"button", "primary"},
		Description:   "A primary button icon",
	}); err != nil {
		t.Fatal(err)
	}
}

func translateTestServer(t *testing.T, provider llm.Provider, locales []string) *Server {
	t.Helper()
	store := openEmbedServerTestStore(t)
	enabled := true
	llmProvider := "ollama"
	visionModel := "vision"
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:            &enabled,
		LLMProvider:           &llmProvider,
		LLMVisionModel:        &visionModel,
		LLMTranslationLocales: locales,
	}); err != nil {
		t.Fatal(err)
	}
	seedReadyAITag(t, store)
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.llmProvider = provider
	return s
}

func decodeNDJSONEvents(t *testing.T, body string) []map[string]any {
	t.Helper()
	var events []map[string]any
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode event %q: %v", line, err)
		}
		events = append(events, event)
	}
	return events
}

func TestAITagTranslateDoneIncludesSummary(t *testing.T) {
	s := translateTestServer(t, fakeTranslateProvider{
		content: `{"translations":[{"id":1,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"}]}`,
	}, []string{"en", "zh-TW"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate?lang=zh-TW", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 2 || int(done["total"].(float64)) != 2 || int(done["skipped"].(float64)) != 0 {
		t.Fatalf("unexpected done summary: %#v\nbody=%s", done, rec.Body.String())
	}
	locales := done["locales"].([]any)
	if len(locales) != 2 || locales[0] != "en" || locales[1] != "zh-TW" {
		t.Fatalf("unexpected locales: %#v", locales)
	}
}

func TestAITagTranslateSurfacesSkippedWarnings(t *testing.T) {
	s := translateTestServer(t, fakeTranslateProvider{err: errors.New("llm down")}, []string{"en"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 0 || int(done["total"].(float64)) != 1 || int(done["skipped"].(float64)) != 1 {
		t.Fatalf("unexpected skipped summary: %#v\nbody=%s", done, rec.Body.String())
	}
	warnings := done["warnings"].([]any)
	if len(warnings) == 0 || !strings.Contains(warnings[0].(string), "failed to translate en batch") {
		t.Fatalf("missing warning: %#v", warnings)
	}
}

package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
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

func TestI18nBatchSizeStaysSmallForLocalModels(t *testing.T) {
	if i18nBatchSize > 10 {
		t.Fatalf("i18nBatchSize should stay small for local translation models, got %d", i18nBatchSize)
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

type sequenceTranslateProvider struct {
	fakeEmbedProvider
	contents []string
	calls    int
}

func (p *sequenceTranslateProvider) Chat(context.Context, llm.ChatRequest) (llm.ChatResponse, error) {
	if len(p.contents) == 0 {
		return llm.ChatResponse{}, nil
	}
	index := p.calls
	p.calls++
	if index >= len(p.contents) {
		index = len(p.contents) - 1
	}
	return llm.ChatResponse{Content: p.contents[index]}, nil
}

func seedReadyAITag(t *testing.T, store *config.Store) {
	t.Helper()
	seedReadyAITagRows(t, store, 1)
}

func seedReadyAITagRows(t *testing.T, store *config.Store, count int) {
	t.Helper()
	projectRoot := resolvedTempDir(t)
	if err := store.AddProjects([]string{projectRoot}); err != nil {
		t.Fatal(err)
	}
	projectID := store.Projects()[0].ID
	for i := 1; i <= count; i++ {
		if err := store.UpsertAITagResult(aitag.Result{
			ProjectID:     projectID,
			RepoPath:      "icons/button-" + strconv.Itoa(i) + ".png",
			ContentHash:   "hash-button-" + strconv.Itoa(i),
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

func translateTestServerWithRows(t *testing.T, provider llm.Provider, locales []string, rows int) *Server {
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
	seedReadyAITagRows(t, store, rows)
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
	s := translateTestServer(t, &sequenceTranslateProvider{
		contents: []string{
			`{"translations":[{"id":1,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"}]}`,
			`{"translations":[{"id":1,"category":"圖示","tags":["按鈕","主要"],"description":"主要按鈕圖示"}]}`,
		},
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

func TestAITagTranslateRetriesMissingBatchItems(t *testing.T) {
	provider := &sequenceTranslateProvider{
		contents: []string{
			`{"translations":[` +
				`{"id":1,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":2,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":3,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":4,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":5,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":6,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":7,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"},` +
				`{"id":8,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"}` +
				`]}`,
			`{"translations":[{"id":1,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"}]}`,
			`{"translations":[{"id":1,"category":"Icon","tags":["Button","Primary"],"description":"A primary button icon"}]}`,
		},
	}
	s := translateTestServerWithRows(t, provider, []string{"en"}, i18nBatchSize)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != i18nBatchSize || int(done["total"].(float64)) != i18nBatchSize || int(done["skipped"].(float64)) != 0 {
		t.Fatalf("unexpected retry summary: %#v\nbody=%s", done, rec.Body.String())
	}
	if provider.calls != 3 {
		t.Fatalf("expected one batch call and two single-item retries, got %d", provider.calls)
	}
}

func TestAITagTranslateEnglishCategoryCanMatchRaw(t *testing.T) {
	s := translateTestServer(t, fakeTranslateProvider{
		content: `{"translations":[{"id":1,"category":"icon","tags":["Button","Primary"],"description":"A primary button icon"}]}`,
	}, []string{"en"})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	firstEvents := decodeNDJSONEvents(t, rec.Body.String())
	firstDone := firstEvents[len(firstEvents)-1]
	if firstDone["type"] != "done" || int(firstDone["translated"].(float64)) != 1 || int(firstDone["skipped"].(float64)) != 0 {
		t.Fatalf("unexpected first summary: %#v\nbody=%s", firstDone, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 0 || int(done["total"].(float64)) != 0 || int(done["skipped"].(float64)) != 0 {
		t.Fatalf("english row should not stay missing after raw-matching category: %#v\nbody=%s", done, rec.Body.String())
	}
}

func TestAITagTranslateLocalizedCategoryCanMatchRaw(t *testing.T) {
	store := openEmbedServerTestStore(t)
	enabled := true
	llmProvider := "ollama"
	visionModel := "vision"
	locales := []string{"zh-TW"}
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:            &enabled,
		LLMProvider:           &llmProvider,
		LLMVisionModel:        &visionModel,
		LLMTranslationLocales: locales,
	}); err != nil {
		t.Fatal(err)
	}
	projectRoot := resolvedTempDir(t)
	if err := store.AddProjects([]string{projectRoot}); err != nil {
		t.Fatal(err)
	}
	projectID := store.Projects()[0].ID
	if err := store.UpsertAITagResult(aitag.Result{
		ProjectID:     projectID,
		RepoPath:      "icons/animal.png",
		ContentHash:   "hash-animal",
		HashAlgorithm: "sha1",
		ProviderName:  "ollama",
		ModelName:     "vision",
		Status:        aitag.StatusReady,
		Category:      "動物",
		Tags:          []string{"貓", "插圖"},
		Description:   "一張貓的插圖",
	}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.llmProvider = &sequenceTranslateProvider{
		contents: []string{
			`{"translations":[{"id":1,"category":"Animal","tags":["Cat","Illustration"],"description":"An illustration of a cat"}]}`,
			`{"translations":[{"id":1,"category":"動物","tags":["貓","插圖"],"description":"一張貓的插圖"}]}`,
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate?lang=zh-TW", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	firstEvents := decodeNDJSONEvents(t, rec.Body.String())
	firstDone := firstEvents[len(firstEvents)-1]
	if firstDone["type"] != "done" || int(firstDone["translated"].(float64)) != 2 || int(firstDone["skipped"].(float64)) != 0 {
		t.Fatalf("unexpected first summary: %#v\nbody=%s", firstDone, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate?lang=zh-TW", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 0 || int(done["total"].(float64)) != 0 || int(done["skipped"].(float64)) != 0 {
		t.Fatalf("localized row should not stay missing after raw-matching category: %#v\nbody=%s", done, rec.Body.String())
	}
}

func TestAITagTranslateLocalizedCategoryRejectsRawEnglish(t *testing.T) {
	store := openEmbedServerTestStore(t)
	enabled := true
	llmProvider := "ollama"
	visionModel := "vision"
	locales := []string{"zh-TW"}
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:            &enabled,
		LLMProvider:           &llmProvider,
		LLMVisionModel:        &visionModel,
		LLMTranslationLocales: locales,
	}); err != nil {
		t.Fatal(err)
	}
	projectRoot := resolvedTempDir(t)
	if err := store.AddProjects([]string{projectRoot}); err != nil {
		t.Fatal(err)
	}
	projectID := store.Projects()[0].ID
	if err := store.UpsertAITagResult(aitag.Result{
		ProjectID:     projectID,
		RepoPath:      "icons/crafts.png",
		ContentHash:   "hash-crafts",
		HashAlgorithm: "sha1",
		ProviderName:  "ollama",
		ModelName:     "vision",
		Status:        aitag.StatusReady,
		Category:      "crafts",
		Tags:          []string{"craft", "handmade"},
		Description:   "A handmade craft icon",
	}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.llmProvider = fakeTranslateProvider{
		content: `{"translations":[{"id":1,"category":"crafts","tags":["Craft","Handmade"],"description":"A handmade craft icon"}]}`,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate?lang=zh-TW", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events := decodeNDJSONEvents(t, rec.Body.String())
	done := events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 1 || int(done["total"].(float64)) != 2 || int(done["skipped"].(float64)) != 1 {
		t.Fatalf("raw English zh-TW category should be rejected: %#v\nbody=%s", done, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/ai/tag/translate?lang=zh-TW", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	events = decodeNDJSONEvents(t, rec.Body.String())
	done = events[len(events)-1]
	if done["type"] != "done" || int(done["translated"].(float64)) != 0 || int(done["total"].(float64)) != 1 || int(done["skipped"].(float64)) != 1 {
		t.Fatalf("raw English zh-TW category should remain missing: %#v\nbody=%s", done, rec.Body.String())
	}
}

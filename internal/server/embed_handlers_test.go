package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aisets/internal/config"
	"aisets/internal/llm"
)

type fakeEmbedProvider struct{}

func (fakeEmbedProvider) Name() string { return "ollama" }

func (fakeEmbedProvider) Available(context.Context) error { return nil }

func (fakeEmbedProvider) ListModels(context.Context) ([]llm.Model, error) { return nil, nil }

func (fakeEmbedProvider) Chat(context.Context, llm.ChatRequest) (llm.ChatResponse, error) {
	return llm.ChatResponse{}, nil
}

func (fakeEmbedProvider) Embed(context.Context, llm.EmbedRequest) (llm.EmbedResponse, error) {
	return llm.EmbedResponse{Embedding: []float32{1, 0}, Dimensions: 2}, nil
}

func openEmbedServerTestStore(t *testing.T) *config.Store {
	t.Helper()
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestEmbedSearchScopesProviderModelAndDimensions(t *testing.T) {
	store := openEmbedServerTestStore(t)
	enabled := true
	provider := "ollama"
	model := "current"
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:    &enabled,
		LLMProvider:   &provider,
		LLMEmbedModel: &model,
	}); err != nil {
		t.Fatal(err)
	}
	for _, result := range []config.EmbeddingResult{
		{AssetID: "current-text", ProjectID: "p1", RepoPath: "current.png", ContentHash: "h1", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "current", Dimensions: 2, Status: "ready"},
		{AssetID: "old-model", ProjectID: "p1", RepoPath: "old.png", ContentHash: "h2", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "old", Dimensions: 2, Status: "ready"},
		{AssetID: "old-dim", ProjectID: "p1", RepoPath: "dim.png", ContentHash: "h3", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "current", Dimensions: 3, Status: "ready"},
		{AssetID: "current-image", ProjectID: "p1", RepoPath: "image.png", ContentHash: "h4", HashAlgorithm: "xxh3", EmbedType: "image", ProviderName: "ollama", ModelName: "current", Dimensions: 2, Status: "ready"},
		{AssetID: "old-image", ProjectID: "p1", RepoPath: "old-image.png", ContentHash: "h5", HashAlgorithm: "xxh3", EmbedType: "image", ProviderName: "ollama", ModelName: "old", Dimensions: 2, Status: "ready"},
	} {
		vec := []float32{1, 0}
		if result.Dimensions == 3 {
			vec = []float32{1, 0, 0}
		}
		if err := store.UpsertEmbedding(result, vec); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.llmProvider = fakeEmbedProvider{}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ai/embed/search?q=button&type=hybrid&limit=10", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		TotalEmbeddings int `json:"totalEmbeddings"`
		Results         []struct {
			AssetID string `json:"assetId"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TotalEmbeddings != 2 {
		t.Fatalf("expected only current model/dimension embeddings, got total=%d body=%s", body.TotalEmbeddings, rec.Body.String())
	}
	for _, result := range body.Results {
		if result.AssetID != "current-text" && result.AssetID != "current-image" {
			t.Fatalf("unexpected mixed-scope result: %+v", body.Results)
		}
	}
}

func TestEmbedStatsScopesCurrentModel(t *testing.T) {
	store := openEmbedServerTestStore(t)
	enabled := true
	provider := "ollama"
	model := "current"
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:    &enabled,
		LLMProvider:   &provider,
		LLMEmbedModel: &model,
	}); err != nil {
		t.Fatal(err)
	}
	for _, result := range []config.EmbeddingResult{
		{AssetID: "current-text", ProjectID: "p1", RepoPath: "current.png", ContentHash: "h1", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "current", Dimensions: 2, Status: "ready"},
		{AssetID: "old-text", ProjectID: "p1", RepoPath: "old.png", ContentHash: "h2", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "old", Dimensions: 2, Status: "ready"},
		{AssetID: "current-image", ProjectID: "p1", RepoPath: "image.png", ContentHash: "h3", HashAlgorithm: "xxh3", EmbedType: "image", ProviderName: "ollama", ModelName: "current", Dimensions: 2, Status: "ready"},
	} {
		if err := store.UpsertEmbedding(result, []float32{1, 0}); err != nil {
			t.Fatal(err)
		}
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.llmProvider = fakeEmbedProvider{}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ai/embed/stats", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		TextCount  int `json:"textCount"`
		ImageCount int `json:"imageCount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TextCount != 1 || body.ImageCount != 1 {
		t.Fatalf("unexpected scoped stats: %+v", body)
	}
}

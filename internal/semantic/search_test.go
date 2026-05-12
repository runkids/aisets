package semantic

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

type fakeProvider struct {
	embedding []float32
}

func (p fakeProvider) Name() string { return "fake" }

func (p fakeProvider) Available(context.Context) error { return nil }

func (p fakeProvider) ListModels(context.Context) ([]llm.Model, error) { return nil, nil }

func (p fakeProvider) Chat(context.Context, llm.ChatRequest) (llm.ChatResponse, error) {
	return llm.ChatResponse{}, errors.New("unexpected chat call")
}

func (p fakeProvider) Embed(context.Context, llm.EmbedRequest) (llm.EmbedResponse, error) {
	return llm.EmbedResponse{Embedding: p.embedding, Dimensions: len(p.embedding)}, nil
}

func TestSearchRanksReadyEmbeddingsAndAppliesCatalogFilter(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-12T00:00:00Z",
		Projects:    []scanner.Project{{ID: "app", Name: "App", Path: root}},
		Items: []scanner.AssetItem{
			assetItem(root, "car", "assets/car.png", ".png", "hash-car"),
			assetItem(root, "flower", "assets/flower.svg", ".svg", "hash-flower"),
		},
		Stats: scanner.CatalogStats{TotalFiles: 2},
	}); err != nil {
		t.Fatal(err)
	}
	insertEmbedding(t, store, "car", "assets/car.png", "hash-car", []float32{1, 0})
	insertEmbedding(t, store, "flower", "assets/flower.svg", "hash-flower", []float32{0, 1})

	settings := config.AppSettings{
		LLMEnabled:           true,
		LLMEmbedModel:        "fake-embed",
		EmbedSearchType:      "text",
		EmbedSearchLimit:     10,
		EmbedSearchThreshold: 0.1,
	}
	provider := fakeProvider{embedding: []float32{1, 0}}

	response, err := Search(context.Background(), store, provider, settings, Query{Text: "sports car", Type: "text"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].AssetID != "car" || response.Results[0].MatchType != "text" {
		t.Fatalf("unexpected ranking response: %#v", response.Results)
	}
	if response.TotalEmbeddings != 2 {
		t.Fatalf("total embeddings = %d, want 2", response.TotalEmbeddings)
	}

	filtered, err := Search(context.Background(), store, provider, settings, Query{
		Text:      "sports car",
		Type:      "text",
		Threshold: -1,
		Filter:    config.CatalogItemQuery{Ext: ".svg"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered.Results) != 1 || filtered.Results[0].AssetID != "flower" {
		t.Fatalf("filtered response = %#v", filtered.Results)
	}
}

func assetItem(root, id, repoPath, ext, hash string) scanner.AssetItem {
	return scanner.AssetItem{
		ID:            id,
		ProjectID:     "app",
		ProjectName:   "App",
		RepoPath:      repoPath,
		LocalPath:     filepath.Join(root, repoPath),
		Ext:           ext,
		Bytes:         100,
		ContentHash:   hash,
		HashAlgorithm: "xxh3",
		Image:         imageproc.Metadata{Format: ext[1:], Width: 1, Height: 1, Pages: 1},
		URL:           "/assets/" + repoPath,
		ThumbnailURL:  "/thumbs/" + id,
		UsedBy:        []string{},
		References:    []scanner.AssetReference{},
	}
}

func insertEmbedding(t *testing.T, store *config.Store, assetID, repoPath, hash string, vector []float32) {
	t.Helper()
	if err := store.UpsertEmbedding(config.EmbeddingResult{
		AssetID:       assetID,
		ProjectID:     "app",
		RepoPath:      repoPath,
		ContentHash:   hash,
		HashAlgorithm: "xxh3",
		EmbedType:     "text",
		ProviderName:  "fake",
		ModelName:     "fake-embed",
		Dimensions:    len(vector),
		Status:        "ready",
	}, vector); err != nil {
		t.Fatal(err)
	}
}

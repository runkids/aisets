package config

import (
	"path/filepath"
	"testing"
)

func openEmbedTestStore(t *testing.T) *Store {
	t.Helper()
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestEmbeddingUpsertAndQuery(t *testing.T) {
	store := openEmbedTestStore(t)

	vec := []float32{0.1, 0.2, 0.3, 0.4}
	r := EmbeddingResult{
		AssetID:       "asset1",
		ProjectID:     "proj1",
		RepoPath:      "src/icon.png",
		ContentHash:   "abc123",
		HashAlgorithm: "xxh3",
		EmbedType:     "text",
		ProviderName:  "ollama",
		ModelName:     "nomic-embed-text",
		Dimensions:    4,
		Status:        "ready",
		DurationMs:    50,
	}
	if err := store.UpsertEmbedding(r, vec); err != nil {
		t.Fatal(err)
	}

	all, err := store.AllReadyEmbeddings("text")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("expected 1, got %d", len(all))
	}
	got := all[0]
	if got.AssetID != "asset1" || got.ProjectID != "proj1" || got.Status != "ready" {
		t.Fatalf("unexpected: %+v", got.EmbeddingResult)
	}
	if len(got.Vector) != 4 || got.Vector[0] != 0.1 || got.Vector[3] != 0.4 {
		t.Fatalf("unexpected vector: %v", got.Vector)
	}
}

func TestEmbeddingCacheCheck(t *testing.T) {
	store := openEmbedTestStore(t)

	r := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		EmbedType: "text", ProviderName: "ollama", ModelName: "m1",
		Dimensions: 2, Status: "ready",
	}
	if err := store.UpsertEmbedding(r, []float32{1, 2}); err != nil {
		t.Fatal(err)
	}

	exists, err := store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected cache hit")
	}

	exists, err = store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "other-model")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected cache miss for different model")
	}
}

func TestEmbeddingTypeIsolation(t *testing.T) {
	store := openEmbedTestStore(t)

	base := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		ProviderName: "ollama", ModelName: "m1",
		Dimensions: 2, Status: "ready",
	}

	textR := base
	textR.EmbedType = "text"
	if err := store.UpsertEmbedding(textR, []float32{1, 0}); err != nil {
		t.Fatal(err)
	}
	imgR := base
	imgR.EmbedType = "image"
	if err := store.UpsertEmbedding(imgR, []float32{0, 1}); err != nil {
		t.Fatal(err)
	}

	textAll, err := store.AllReadyEmbeddings("text")
	if err != nil {
		t.Fatal(err)
	}
	if len(textAll) != 1 || textAll[0].Vector[0] != 1 {
		t.Fatalf("text isolation failed: %v", textAll)
	}

	imgAll, err := store.AllReadyEmbeddings("image")
	if err != nil {
		t.Fatal(err)
	}
	if len(imgAll) != 1 || imgAll[0].Vector[1] != 1 {
		t.Fatalf("image isolation failed: %v", imgAll)
	}

	tc, ic, err := store.EmbeddingReadyCounts()
	if err != nil {
		t.Fatal(err)
	}
	if tc != 1 || ic != 1 {
		t.Fatalf("counts: text=%d image=%d, expected 1,1", tc, ic)
	}
}

func TestEmbeddingErrorNoVector(t *testing.T) {
	store := openEmbedTestStore(t)

	r := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		EmbedType: "text", ProviderName: "ollama", ModelName: "m1",
		Dimensions: 0, Status: "error",
		ErrorCode: "embed_failed", ErrorMessage: "model not available",
	}
	if err := store.UpsertEmbedding(r, nil); err != nil {
		t.Fatal(err)
	}

	all, err := store.AllReadyEmbeddings("text")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatal("error rows should not appear in ready embeddings")
	}

	exists, err := store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("error rows should not be cache hits")
	}
}

func TestEmbeddingRemoveAll(t *testing.T) {
	store := openEmbedTestStore(t)

	r := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		EmbedType: "text", ProviderName: "ollama", ModelName: "m1",
		Dimensions: 2, Status: "ready",
	}
	if err := store.UpsertEmbedding(r, []float32{1, 2}); err != nil {
		t.Fatal(err)
	}

	if err := store.RemoveEmbeddings(); err != nil {
		t.Fatal(err)
	}

	all, err := store.AllReadyEmbeddings("text")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatal("expected 0 after remove")
	}

	var vectorCount int
	store.rdb.QueryRow("SELECT COUNT(*) FROM embedding_vectors").Scan(&vectorCount)
	if vectorCount != 0 {
		t.Fatalf("CASCADE should have cleared vectors, got %d", vectorCount)
	}
}

func TestEmbeddingForAsset(t *testing.T) {
	store := openEmbedTestStore(t)

	r := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		EmbedType: "text", ProviderName: "ollama", ModelName: "m1",
		Dimensions: 3, Status: "ready",
	}
	if err := store.UpsertEmbedding(r, []float32{0.5, 0.6, 0.7}); err != nil {
		t.Fatal(err)
	}

	got, err := store.EmbeddingForAsset("a1", "text")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected result")
	}
	if got.Dimensions != 3 || got.Vector[0] != 0.5 {
		t.Fatalf("unexpected: dims=%d vec=%v", got.Dimensions, got.Vector)
	}

	miss, err := store.EmbeddingForAsset("nonexistent", "text")
	if err != nil {
		t.Fatal(err)
	}
	if miss != nil {
		t.Fatal("expected nil for nonexistent asset")
	}
}

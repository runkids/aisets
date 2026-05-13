package config

import (
	"math"
	"path/filepath"
	"testing"

	"aisets/internal/aitag"
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
	if len(got.Vector) != 4 || math.Abs(float64(got.Vector[0]-0.18257418)) > 1e-6 || math.Abs(float64(got.Vector[3]-0.73029673)) > 1e-6 {
		t.Fatalf("unexpected vector: %v", got.Vector)
	}
}

func TestEmbeddingCacheCheck(t *testing.T) {
	store := openEmbedTestStore(t)

	r := EmbeddingResult{
		AssetID: "a1", ProjectID: "p1", RepoPath: "x.png",
		ContentHash: "h1", HashAlgorithm: "xxh3",
		InputHash: "input-a",
		EmbedType: "text", ProviderName: "ollama", ModelName: "m1",
		Dimensions: 2, Status: "ready",
	}
	if err := store.UpsertEmbedding(r, []float32{1, 2}); err != nil {
		t.Fatal(err)
	}

	exists, err := store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1", "")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected cache hit")
	}

	exists, err = store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1", "input-a")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected cache hit for matching input hash")
	}

	exists, err = store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1", "input-b")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected cache miss for changed input hash")
	}

	exists, err = store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "other-model", "")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expected cache miss for different model")
	}
}

func TestEmbeddingScopedQuery(t *testing.T) {
	store := openEmbedTestStore(t)

	rows := []EmbeddingResult{
		{AssetID: "a1", ProjectID: "p1", RepoPath: "a.png", ContentHash: "h1", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "m1", Dimensions: 2, Status: "ready"},
		{AssetID: "a2", ProjectID: "p1", RepoPath: "b.png", ContentHash: "h2", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "m2", Dimensions: 2, Status: "ready"},
		{AssetID: "a3", ProjectID: "p1", RepoPath: "c.png", ContentHash: "h3", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "m1", Dimensions: 3, Status: "ready"},
	}
	for _, row := range rows {
		vec := make([]float32, row.Dimensions)
		vec[0] = 1
		if err := store.UpsertEmbedding(row, vec); err != nil {
			t.Fatal(err)
		}
	}

	scoped, err := store.ReadyEmbeddings(EmbeddingQuery{
		EmbedType:    "text",
		ProviderName: "ollama",
		ModelName:    "m1",
		Dimensions:   2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(scoped) != 1 || scoped[0].AssetID != "a1" {
		t.Fatalf("unexpected scoped embeddings: %+v", scoped)
	}

	textCount, imageCount, err := store.EmbeddingReadyCountsForModel("ollama", "m1")
	if err != nil {
		t.Fatal(err)
	}
	if textCount != 2 || imageCount != 0 {
		t.Fatalf("unexpected scoped counts: text=%d image=%d", textCount, imageCount)
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

	exists, err := store.HasReadyEmbedding("p1", "x.png", "h1", "xxh3", "text", "ollama", "m1", "")
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
	if got.Dimensions != 3 || math.Abs(float64(got.Vector[0]-0.4767313)) > 1e-6 {
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

func TestEmbeddingCalibrationLabels(t *testing.T) {
	store := openEmbedTestStore(t)

	first, err := store.UpsertEmbeddingCalibrationLabel(EmbeddingCalibrationLabel{
		Query:      "red icon",
		SearchType: "image",
		AssetID:    "asset-1",
		ProjectID:  "project-1",
		RepoPath:   "assets/red.png",
		Label:      "match",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == 0 || first.Label != "match" {
		t.Fatalf("unexpected label: %+v", first)
	}

	updated, err := store.UpsertEmbeddingCalibrationLabel(EmbeddingCalibrationLabel{
		Query:      "red icon",
		SearchType: "image",
		AssetID:    "asset-1",
		ProjectID:  "project-1",
		RepoPath:   "assets/red.png",
		Label:      "reject",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != first.ID || updated.Label != "reject" {
		t.Fatalf("unexpected updated label: %+v", updated)
	}

	labels, err := store.EmbeddingCalibrationLabelsFor("red icon", "image")
	if err != nil {
		t.Fatal(err)
	}
	if len(labels) != 1 || labels[0].Label != "reject" {
		t.Fatalf("labels = %+v", labels)
	}
	if err := store.DeleteEmbeddingCalibrationLabel(updated.ID); err != nil {
		t.Fatal(err)
	}
	labels, err = store.EmbeddingCalibrationLabels()
	if err != nil {
		t.Fatal(err)
	}
	if len(labels) != 0 {
		t.Fatalf("expected no labels, got %+v", labels)
	}
}

func TestRepairEmbeddingInputs(t *testing.T) {
	store := openEmbedTestStore(t)

	valid := aitag.Result{
		ProjectID: "p1", RepoPath: "valid.png",
		ContentHash: "hv", HashAlgorithm: "xxh3",
		ProviderName: "ollama", ModelName: "vision",
		Status: aitag.StatusReady, Category: "icon",
		Tags:         []string{"button", "primary"},
		Description:  "A primary button icon",
		CategoryI18n: map[string]string{"en": "7.", "zh-TW": "圖示"},
		TagsI18n: map[string][]string{
			"en":    {"Button"},
			"zh-TW": {"按鈕", "主要"},
		},
		DescriptionI18n: map[string]string{"en": "...", "zh-TW": "主要按鈕圖示"},
	}
	invalid := aitag.Result{
		ProjectID: "p1", RepoPath: "invalid.png",
		ContentHash: "hi", HashAlgorithm: "xxh3",
		ProviderName: "ollama", ModelName: "vision",
		Status: aitag.StatusReady,
	}
	for _, result := range []aitag.Result{valid, invalid} {
		if err := store.UpsertAITagResult(result); err != nil {
			t.Fatal(err)
		}
	}
	for _, result := range []EmbeddingResult{
		{AssetID: "av", ProjectID: "p1", RepoPath: "valid.png", ContentHash: "hv", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "embed", Dimensions: 2, Status: "ready"},
		{AssetID: "ai", ProjectID: "p1", RepoPath: "invalid.png", ContentHash: "hi", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "embed", Dimensions: 2, Status: "ready"},
		{AssetID: "keep", ProjectID: "p1", RepoPath: "keep.png", ContentHash: "hk", HashAlgorithm: "xxh3", EmbedType: "text", ProviderName: "ollama", ModelName: "embed", Dimensions: 2, Status: "ready"},
	} {
		if err := store.UpsertEmbedding(result, []float32{1, 0}); err != nil {
			t.Fatal(err)
		}
	}

	report, err := store.RepairEmbeddingInputs(false)
	if err != nil {
		t.Fatal(err)
	}
	if report.InvalidAITags != 1 || report.ClearedI18nEntries != 1 || report.DeletedStaleTextEmbeddings != 2 {
		t.Fatalf("unexpected dry-run report: %+v", report)
	}
	if got, _ := store.AllReadyEmbeddings("text"); len(got) != 3 {
		t.Fatalf("dry-run should not delete embeddings, got %d", len(got))
	}

	report, err = store.RepairEmbeddingInputs(true)
	if err != nil {
		t.Fatal(err)
	}
	if report.InvalidAITags != 1 || report.ClearedI18nEntries != 1 || report.DeletedStaleTextEmbeddings != 2 {
		t.Fatalf("unexpected apply report: %+v", report)
	}
	if got, _ := store.AllReadyEmbeddings("text"); len(got) != 1 || got[0].AssetID != "keep" {
		t.Fatalf("unexpected remaining embeddings: %+v", got)
	}

	gotValid, err := store.AITagResultAnyWithEnglish("hv", "xxh3")
	if err != nil {
		t.Fatal(err)
	}
	if gotValid == nil || gotValid.Category != "icon" {
		t.Fatalf("expected invalid English i18n removed with raw fallback, got %+v", gotValid)
	}
	gotInvalid, err := store.AITagResultAnyWithEnglish("hi", "xxh3")
	if err != nil {
		t.Fatal(err)
	}
	if gotInvalid != nil {
		t.Fatalf("expected invalid raw AI tag to be unusable, got %+v", gotInvalid)
	}
}

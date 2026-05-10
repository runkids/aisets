package config

import (
	"path/filepath"
	"testing"

	"aisets/internal/aitag"
	"aisets/internal/scanner"
)

func TestAITagUpsertAndQuery(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	result := aitag.Result{
		ProjectID:          "proj1",
		RepoPath:           "src/icon.png",
		ContentHash:        "abc123",
		HashAlgorithm:      "sha256",
		ProviderName:       "ollama",
		ModelName:          "llava",
		Status:             aitag.StatusReady,
		Category:           "icon",
		Tags:               []string{"dark-mode", "navigation"},
		Description:        "A dark-themed navigation icon",
		ContainsFace:       false,
		SceneType:          "digital",
		EstimatedLocation:  "",
		LocationConfidence: "none",
		DurationMs:         3200,
	}
	if err := store.UpsertAITagResult(result); err != nil {
		t.Fatal(err)
	}

	items := []scanner.AssetItem{{
		ProjectID:     "proj1",
		RepoPath:      "src/icon.png",
		ContentHash:   "abc123",
		HashAlgorithm: "sha256",
	}}
	results, err := store.AITagResults(items, "ollama", "llava")
	if err != nil {
		t.Fatal(err)
	}
	got, ok := results[aiTagKey("proj1", "src/icon.png")]
	if !ok {
		t.Fatal("expected result for proj1/src/icon.png")
	}
	if got.Status != aitag.StatusReady || got.Category != "icon" || len(got.Tags) != 2 || got.Tags[0] != "dark-mode" || got.Description != "A dark-themed navigation icon" {
		t.Fatalf("unexpected result: %+v", got)
	}
	if got.ContainsFace != false || got.SceneType != "digital" || got.LocationConfidence != "none" {
		t.Fatalf("unexpected enrich fields: containsFace=%v sceneType=%q locationConfidence=%q", got.ContainsFace, got.SceneType, got.LocationConfidence)
	}
}

func TestAITagEnrichFieldsRoundTrip(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	result := aitag.Result{
		ProjectID:          "proj1",
		RepoPath:           "src/photo.jpg",
		ContentHash:        "facehash",
		HashAlgorithm:      "sha256",
		ProviderName:       "ollama",
		ModelName:          "llava",
		Status:             aitag.StatusReady,
		Category:           "photo",
		Tags:               []string{"portrait", "outdoor"},
		Description:        "A person standing in front of Tokyo Tower",
		ContainsFace:       true,
		SceneType:          "outdoor",
		EstimatedLocation:  "Tokyo, Japan",
		LocationConfidence: "high",
		DurationMs:         2500,
	}
	if err := store.UpsertAITagResult(result); err != nil {
		t.Fatal(err)
	}

	items := []scanner.AssetItem{{
		ProjectID: "proj1", RepoPath: "src/photo.jpg",
		ContentHash: "facehash", HashAlgorithm: "sha256",
	}}

	results, err := store.AITagResults(items, "ollama", "llava")
	if err != nil {
		t.Fatal(err)
	}
	got := results[aiTagKey("proj1", "src/photo.jpg")]
	if !got.ContainsFace {
		t.Fatal("expected containsFace=true")
	}
	if got.SceneType != "outdoor" {
		t.Fatalf("expected sceneType=outdoor, got %q", got.SceneType)
	}
	if got.EstimatedLocation != "Tokyo, Japan" {
		t.Fatalf("expected estimatedLocation='Tokyo, Japan', got %q", got.EstimatedLocation)
	}
	if got.LocationConfidence != "high" {
		t.Fatalf("expected locationConfidence=high, got %q", got.LocationConfidence)
	}

	best, err := store.AITagResultsBestMatch(items, "ollama", "llava")
	if err != nil {
		t.Fatal(err)
	}
	gotBest := best[aiTagKey("proj1", "src/photo.jpg")]
	if !gotBest.ContainsFace || gotBest.SceneType != "outdoor" || gotBest.EstimatedLocation != "Tokyo, Japan" {
		t.Fatalf("BestMatch enrich fields mismatch: %+v", gotBest)
	}

	gotHash, found, err := store.AITagResultForContentHash("facehash", "sha256", "ollama", "llava")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected content hash hit")
	}
	if !gotHash.ContainsFace || gotHash.EstimatedLocation != "Tokyo, Japan" {
		t.Fatalf("ContentHash dedup enrich fields mismatch: %+v", gotHash)
	}
}

func TestAITagContentHashDedup(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	result := aitag.Result{
		ProjectID:     "proj1",
		RepoPath:      "src/logo.png",
		ContentHash:   "hash999",
		HashAlgorithm: "sha256",
		ProviderName:  "ollama",
		ModelName:     "llava",
		Status:        aitag.StatusReady,
		Category:      "logo",
		Tags:          []string{"brand"},
		Description:   "Company logo",
		DurationMs:    1500,
	}
	if err := store.UpsertAITagResult(result); err != nil {
		t.Fatal(err)
	}

	// Same content hash, different path — should find the cached result
	got, found, err := store.AITagResultForContentHash("hash999", "sha256", "ollama", "llava")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected cache hit for same content hash")
	}
	if got.Category != "logo" || got.Tags[0] != "brand" {
		t.Fatalf("unexpected dedup result: %+v", got)
	}
}

func TestAITagCacheMissOnModelChange(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	result := aitag.Result{
		ProjectID:     "proj1",
		RepoPath:      "src/photo.jpg",
		ContentHash:   "hashXYZ",
		HashAlgorithm: "sha256",
		ProviderName:  "ollama",
		ModelName:     "llava",
		Status:        aitag.StatusReady,
		Category:      "photo",
		Tags:          []string{"outdoor"},
		Description:   "Outdoor scene",
		DurationMs:    2000,
	}
	if err := store.UpsertAITagResult(result); err != nil {
		t.Fatal(err)
	}

	// Different model = cache miss
	_, found, err := store.AITagResultForContentHash("hashXYZ", "sha256", "ollama", "moondream2")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("expected cache miss for different model")
	}
}

func TestAITagResultsBestMatchFallback(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	oldModel := aitag.Result{
		ProjectID: "proj1", RepoPath: "img/logo.png",
		ContentHash: "h1", HashAlgorithm: "sha256",
		ProviderName: "ollama", ModelName: "llava",
		Status: aitag.StatusReady, Category: "logo",
		Tags: []string{"brand"}, Description: "Old model logo",
		DurationMs: 1000,
	}
	newModel := aitag.Result{
		ProjectID: "proj1", RepoPath: "img/icon.png",
		ContentHash: "h2", HashAlgorithm: "sha256",
		ProviderName: "openai", ModelName: "gpt-4o",
		Status: aitag.StatusReady, Category: "icon",
		Tags: []string{"nav"}, Description: "New model icon",
		DurationMs: 500,
	}
	bothOld := aitag.Result{
		ProjectID: "proj1", RepoPath: "img/both.png",
		ContentHash: "h3", HashAlgorithm: "sha256",
		ProviderName: "ollama", ModelName: "llava",
		Status: aitag.StatusReady, Category: "photo",
		Tags: []string{"old"}, DurationMs: 800,
	}
	bothNew := aitag.Result{
		ProjectID: "proj1", RepoPath: "img/both.png",
		ContentHash: "h3", HashAlgorithm: "sha256",
		ProviderName: "openai", ModelName: "gpt-4o",
		Status: aitag.StatusReady, Category: "screenshot",
		Tags: []string{"new"}, DurationMs: 600,
	}
	for _, r := range []aitag.Result{oldModel, newModel, bothOld, bothNew} {
		if err := store.UpsertAITagResult(r); err != nil {
			t.Fatal(err)
		}
	}

	items := []scanner.AssetItem{
		{ProjectID: "proj1", RepoPath: "img/logo.png", ContentHash: "h1", HashAlgorithm: "sha256"},
		{ProjectID: "proj1", RepoPath: "img/icon.png", ContentHash: "h2", HashAlgorithm: "sha256"},
		{ProjectID: "proj1", RepoPath: "img/both.png", ContentHash: "h3", HashAlgorithm: "sha256"},
	}

	results, err := store.AITagResultsBestMatch(items, "openai", "gpt-4o")
	if err != nil {
		t.Fatal(err)
	}

	// logo.png: only old model has it → should fallback
	got, ok := results[aiTagKey("proj1", "img/logo.png")]
	if !ok {
		t.Fatal("expected fallback result for logo.png")
	}
	if got.Category != "logo" || got.ProviderName != "ollama" {
		t.Fatalf("logo.png: expected fallback to ollama/logo, got %s/%s", got.ProviderName, got.Category)
	}

	// icon.png: current model has it → should use current
	got, ok = results[aiTagKey("proj1", "img/icon.png")]
	if !ok {
		t.Fatal("expected result for icon.png")
	}
	if got.Category != "icon" || got.ProviderName != "openai" {
		t.Fatalf("icon.png: expected openai/icon, got %s/%s", got.ProviderName, got.Category)
	}

	// both.png: both models have it → should prefer current model
	got, ok = results[aiTagKey("proj1", "img/both.png")]
	if !ok {
		t.Fatal("expected result for both.png")
	}
	if got.Category != "screenshot" || got.ProviderName != "openai" {
		t.Fatalf("both.png: expected current model (openai/screenshot), got %s/%s", got.ProviderName, got.Category)
	}
}

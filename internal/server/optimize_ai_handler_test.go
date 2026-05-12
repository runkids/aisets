package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aisets/internal/agent"
	"aisets/internal/config"
	"aisets/internal/scanner"
)

type fakeAgentChatProvider struct {
	result agent.ChatResult
}

func (p fakeAgentChatProvider) ChatBatch(_ context.Context, reqs []agent.ChatRequest, onResult func(int, agent.ChatResult)) error {
	for i := range reqs {
		onResult(i, p.result)
	}
	return nil
}

func (p fakeAgentChatProvider) Close() error { return nil }

func TestOptimizeAIAdvice_MissingAssetID(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/optimize-advice", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	_ = root
}

func TestOptimizeAIAdvice_AINotConfigured(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/optimize-advice?assetId=foo", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (AI not configured), got %d: %s", rec.Code, rec.Body.String())
	}
	_ = root
}

func TestOptimizeAIAdvice_AssetNotFound(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	enabled := true
	provider := "ollama"
	endpoint := "http://localhost:11434"
	model := "moondream"
	store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:     &enabled,
		LLMProvider:    &provider,
		LLMEndpoint:    &endpoint,
		LLMVisionModel: &model,
	})

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-10T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: filepath.Join(root, "proj")}},
		Items:       []scanner.AssetItem{serverScanAsset(root, "img/a.png", 5000, "aaa", 1)},
		Stats:       scanner.CatalogStats{TotalFiles: 1},
	}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/optimize-advice?assetId=nonexistent", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestOptimizeAIAdvice_ReturnsResolvedModel(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	enabled := true
	backend := "agent:codex"
	model := "gpt-fixture"
	store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:       &enabled,
		AgentModel:         &model,
		VLMBackendOptimize: &backend,
	})

	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-10T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: filepath.Join(root, "proj")}},
		Items:       []scanner.AssetItem{serverScanAsset(root, "img/a.png", 5000, "aaa", 1)},
		Stats:       scanner.CatalogStats{TotalFiles: 1},
	}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	s.agentProviders["codex"] = fakeAgentChatProvider{result: agent.ChatResult{
		Content:      `{"contentType":"illustration","recommendedFormat":"webp","recommendedQuality":null,"lossless":true,"rationale":"Use lossless WebP."}`,
		InputTokens:  11,
		OutputTokens: 7,
	}}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/ai/optimize-advice?assetId=p:img/a.png", nil)
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body OptimizeAIAdviceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ProviderName != "agent:codex" || body.ModelName != "gpt-fixture" {
		t.Fatalf("provider/model = %q/%q", body.ProviderName, body.ModelName)
	}
}

package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOMLXName(t *testing.T) {
	p := NewOMLXProvider("http://localhost:8000/v1", "")
	if got := p.Name(); got != "omlx" {
		t.Fatalf("Name() = %q, want %q", got, "omlx")
	}
}

func TestOMLXListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[
			{"id":"qwen3-8b","created":1700000000,"owned_by":"local"},
			{"id":"bge-m3","created":1710000000,"owned_by":"local"}
		]}`)
	}))
	defer srv.Close()

	p := NewOMLXProvider(srv.URL+"/v1", "")
	models, err := p.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels error: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].Name != "qwen3-8b" {
		t.Errorf("models[0].Name = %q, want %q", models[0].Name, "qwen3-8b")
	}
}

func TestOMLXChat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"choices":[{"message":{"content":"hello from omlx"}}],
			"usage":{"prompt_tokens":10,"completion_tokens":5}
		}`)
	}))
	defer srv.Close()

	p := NewOMLXProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model:    "qwen3-8b",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Chat error: %v", err)
	}
	if resp.Content != "hello from omlx" {
		t.Errorf("Content = %q, want %q", resp.Content, "hello from omlx")
	}
	if resp.InputTokens != 10 {
		t.Errorf("InputTokens = %d, want 10", resp.InputTokens)
	}
	if resp.OutputTokens != 5 {
		t.Errorf("OutputTokens = %d, want 5", resp.OutputTokens)
	}
}

func TestOMLXAvailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"id":"test","created":0,"owned_by":"local"}]}`)
	}))
	defer srv.Close()

	p := NewOMLXProvider(srv.URL+"/v1", "")
	if err := p.Available(context.Background()); err != nil {
		t.Fatalf("Available error: %v", err)
	}
}

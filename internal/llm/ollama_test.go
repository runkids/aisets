package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOllamaName(t *testing.T) {
	p := NewOllamaProvider("http://localhost:11434")
	if got := p.Name(); got != "ollama" {
		t.Fatalf("Name() = %q, want %q", got, "ollama")
	}
}

func TestOllamaListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tags" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"models":[
			{"name":"llava:7b","size":4000000000,"modified_at":"2025-01-01T00:00:00Z"},
			{"name":"nomic-embed-text:latest","size":274302432,"modified_at":"2025-02-01T00:00:00Z"}
		]}`)
	}))
	defer srv.Close()

	p := NewOllamaProvider(srv.URL)
	models, err := p.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels error: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].Name != "llava:7b" {
		t.Errorf("models[0].Name = %q, want %q", models[0].Name, "llava:7b")
	}
	if models[1].Name != "nomic-embed-text:latest" {
		t.Errorf("models[1].Name = %q, want %q", models[1].Name, "nomic-embed-text:latest")
	}
}

func TestOllamaChat(t *testing.T) {
	var capturedBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&capturedBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"message":{"role":"assistant","content":"Hello!"},"prompt_eval_count":10,"eval_count":5}`)
	}))
	defer srv.Close()

	p := NewOllamaProvider(srv.URL)
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model: "llava:7b",
		Messages: []ChatMessage{
			{Role: "user", Content: "Hi"},
		},
	})
	if err != nil {
		t.Fatalf("Chat error: %v", err)
	}
	if resp.Content != "Hello!" {
		t.Errorf("Content = %q, want %q", resp.Content, "Hello!")
	}
	if resp.InputTokens != 10 {
		t.Errorf("InputTokens = %d, want 10", resp.InputTokens)
	}
	if resp.OutputTokens != 5 {
		t.Errorf("OutputTokens = %d, want 5", resp.OutputTokens)
	}

	// Verify stream=false was sent
	streamVal, ok := capturedBody["stream"]
	if !ok {
		t.Fatal("stream field missing from request body")
	}
	streamBool, ok := streamVal.(bool)
	if !ok || streamBool {
		t.Errorf("stream = %v, want false", streamVal)
	}
}

func TestOllamaEmbed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/embed" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"embeddings":[[0.1,0.2,0.3]]}`)
	}))
	defer srv.Close()

	p := NewOllamaProvider(srv.URL)
	resp, err := p.Embed(context.Background(), EmbedRequest{
		Model: "nomic-embed-text:latest",
		Input: "hello world",
	})
	if err != nil {
		t.Fatalf("Embed error: %v", err)
	}
	if len(resp.Embedding) != 3 {
		t.Fatalf("expected 3 floats, got %d", len(resp.Embedding))
	}
	want := []float32{0.1, 0.2, 0.3}
	for i, v := range want {
		if resp.Embedding[i] != v {
			t.Errorf("Embedding[%d] = %v, want %v", i, resp.Embedding[i], v)
		}
	}
}

func TestOllamaAvailableSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"models":[]}`)
	}))
	defer srv.Close()

	p := NewOllamaProvider(srv.URL)
	if err := p.Available(context.Background()); err != nil {
		t.Fatalf("Available() error: %v", err)
	}
}

func TestOllamaAvailableConnectionRefused(t *testing.T) {
	p := NewOllamaProvider("http://127.0.0.1:1")
	if err := p.Available(context.Background()); err == nil {
		t.Fatal("Available() expected error for unreachable server, got nil")
	}
}

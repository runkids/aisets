package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenAICompatName(t *testing.T) {
	p := NewOpenAICompatProvider("http://localhost:1234/v1", "")
	if got := p.Name(); got != "openai-compat" {
		t.Fatalf("Name() = %q, want %q", got, "openai-compat")
	}
}

func TestOpenAICompatListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[
			{"id":"llava-v1.6","created":1700000000,"owned_by":"local"},
			{"id":"nomic-embed-text","created":1710000000,"owned_by":"local"}
		]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	models, err := p.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels error: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].Name != "llava-v1.6" {
		t.Errorf("models[0].Name = %q, want %q", models[0].Name, "llava-v1.6")
	}
	if models[1].Name != "nomic-embed-text" {
		t.Errorf("models[1].Name = %q, want %q", models[1].Name, "nomic-embed-text")
	}
	// ModifiedAt should be RFC3339 derived from unix timestamp 1700000000
	if models[0].ModifiedAt == "" {
		t.Error("models[0].ModifiedAt should not be empty")
	}
}

func TestOpenAICompatChat(t *testing.T) {
	var capturedBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&capturedBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"Hello!"}}],"usage":{"prompt_tokens":8,"completion_tokens":3}}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model: "llava-v1.6",
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
	if resp.InputTokens != 8 {
		t.Errorf("InputTokens = %d, want 8", resp.InputTokens)
	}
	if resp.OutputTokens != 3 {
		t.Errorf("OutputTokens = %d, want 3", resp.OutputTokens)
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

func TestOpenAICompatChatWithVision(t *testing.T) {
	var capturedBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&capturedBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"I see an image."}}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model: "llava-v1.6",
		Messages: []ChatMessage{
			{
				Role:    "user",
				Content: "describe this",
				Images:  []string{"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="},
			},
		},
	})
	if err != nil {
		t.Fatalf("Chat error: %v", err)
	}
	if resp.Content != "I see an image." {
		t.Errorf("Content = %q, want %q", resp.Content, "I see an image.")
	}

	// Verify messages content is an array (vision format)
	messages, ok := capturedBody["messages"].([]interface{})
	if !ok || len(messages) == 0 {
		t.Fatal("messages field missing or empty")
	}
	msg, ok := messages[0].(map[string]interface{})
	if !ok {
		t.Fatal("messages[0] is not an object")
	}
	contentArr, ok := msg["content"].([]interface{})
	if !ok {
		t.Fatalf("content should be an array for vision messages, got %T", msg["content"])
	}
	if len(contentArr) != 2 {
		t.Fatalf("expected 2 content parts, got %d", len(contentArr))
	}

	// First part: text
	textPart, ok := contentArr[0].(map[string]interface{})
	if !ok {
		t.Fatal("content[0] is not an object")
	}
	if textPart["type"] != "text" {
		t.Errorf("content[0].type = %q, want %q", textPart["type"], "text")
	}
	if textPart["text"] != "describe this" {
		t.Errorf("content[0].text = %q, want %q", textPart["text"], "describe this")
	}

	// Second part: image_url
	imagePart, ok := contentArr[1].(map[string]interface{})
	if !ok {
		t.Fatal("content[1] is not an object")
	}
	if imagePart["type"] != "image_url" {
		t.Errorf("content[1].type = %q, want %q", imagePart["type"], "image_url")
	}
	imageURL, ok := imagePart["image_url"].(map[string]interface{})
	if !ok {
		t.Fatal("content[1].image_url is not an object")
	}
	url, ok := imageURL["url"].(string)
	if !ok || url == "" {
		t.Fatal("content[1].image_url.url is missing or empty")
	}
	// Should be a data URI
	if len(url) < 5 || url[:5] != "data:" {
		t.Errorf("image_url.url should be a data URI, got prefix %q", url[:min(len(url), 30)])
	}
}

func TestOpenAICompatChatWithTools(t *testing.T) {
	var capturedBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&capturedBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"choices":[{
				"message":{
					"content":"",
					"tool_calls":[{
						"id":"call-1",
						"type":"function",
						"function":{
							"name":"search_assets",
							"arguments":"{\"q\":\"dog\",\"limit\":1}"
						}
					}]
				}
			}],
			"usage":{"prompt_tokens":12,"completion_tokens":4}
		}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model: "test-model",
		Messages: []ChatMessage{
			{Role: "user", Content: "find a dog"},
		},
		Tools: []ChatTool{{
			Name:        "search_assets",
			Description: "Search assets",
			Parameters:  map[string]any{"type": "object"},
		}},
	})
	if err != nil {
		t.Fatalf("Chat error: %v", err)
	}
	tools, ok := capturedBody["tools"].([]interface{})
	if !ok || len(tools) != 1 {
		t.Fatalf("tools missing from request: %#v", capturedBody["tools"])
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %#v", resp.ToolCalls)
	}
	if resp.ToolCalls[0].Name != "search_assets" {
		t.Fatalf("tool name = %q", resp.ToolCalls[0].Name)
	}
	if resp.ToolCalls[0].Arguments["q"] != "dog" {
		t.Fatalf("arguments = %#v", resp.ToolCalls[0].Arguments)
	}
	if resp.InputTokens != 12 || resp.OutputTokens != 4 {
		t.Fatalf("usage = %d/%d", resp.InputTokens, resp.OutputTokens)
	}
}

func TestOpenAICompatChatWithToolsFallsBackWhenUnsupported(t *testing.T) {
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		var capturedBody map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&capturedBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, hasTools := capturedBody["tools"]; hasTools {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":{"message":"tools are not supported"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"fallback"}}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model:    "test-model",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
		Tools:    []ChatTool{{Name: "search_assets"}},
	})
	if err != nil {
		t.Fatalf("Chat error: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
	if resp.Content != "fallback" {
		t.Fatalf("content = %q", resp.Content)
	}
}

func TestOpenAICompatEmbed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.4,0.5,0.6]}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Embed(context.Background(), EmbedRequest{
		Model: "nomic-embed-text",
		Input: "hello world",
	})
	if err != nil {
		t.Fatalf("Embed error: %v", err)
	}
	if len(resp.Embedding) != 3 {
		t.Fatalf("expected 3 floats, got %d", len(resp.Embedding))
	}
	want := []float32{0.4, 0.5, 0.6}
	for i, v := range want {
		if resp.Embedding[i] != v {
			t.Errorf("Embedding[%d] = %v, want %v", i, resp.Embedding[i], v)
		}
	}
}

func TestOpenAICompatEmbedDimensions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.4,0.5,0.6]}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Embed(context.Background(), EmbedRequest{
		Model: "nomic-embed-text",
		Input: "hello",
	})
	if err != nil {
		t.Fatalf("Embed error: %v", err)
	}
	if resp.Dimensions != 3 {
		t.Errorf("expected Dimensions=3, got %d", resp.Dimensions)
	}
}

func TestOpenAICompatEmbedRejectsImageOnly(t *testing.T) {
	p := NewOpenAICompatProvider("http://localhost:1/v1", "")
	_, err := p.Embed(context.Background(), EmbedRequest{
		Model:  "clip-model",
		Images: []string{"data:image/png;base64,AQID"},
	})
	if err != ErrImageEmbedNotSupported {
		t.Errorf("expected ErrImageEmbedNotSupported, got %v", err)
	}
}

func TestOpenAICompatEmbedTextWithImagesIgnoresImages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.1]}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Embed(context.Background(), EmbedRequest{
		Model:  "nomic-embed-text",
		Input:  "hello",
		Images: []string{"data:image/png;base64,AQID"},
	})
	if err != nil {
		t.Fatalf("expected success when Input is set, got %v", err)
	}
	if resp.Dimensions != 1 {
		t.Errorf("expected Dimensions=1, got %d", resp.Dimensions)
	}
}

func TestOpenAICompatChatTimeoutSec(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"slow"}}]}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	_, err := p.Chat(context.Background(), ChatRequest{
		Model:      "test-model",
		Messages:   []ChatMessage{{Role: "user", Content: "hi"}},
		TimeoutSec: 1,
	})
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if !strings.Contains(err.Error(), "context deadline exceeded") {
		t.Fatalf("expected context deadline exceeded, got: %v", err)
	}
}

func TestOpenAICompatChatDefaultTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"fast"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	resp, err := p.Chat(context.Background(), ChatRequest{
		Model:    "test-model",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Content != "fast" {
		t.Errorf("Content = %q, want %q", resp.Content, "fast")
	}
}

func TestOpenAICompatAvailableConnectionRefused(t *testing.T) {
	p := NewOpenAICompatProvider("http://127.0.0.1:1/v1", "")
	if err := p.Available(context.Background()); err == nil {
		t.Fatal("Available() expected error for unreachable server, got nil")
	}
}

func TestOpenAICompatChatErrorBodySurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"unsupported image format: webp"}}`)
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	_, err := p.Chat(context.Background(), ChatRequest{
		Model:    "test-model",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	})
	if err == nil {
		t.Fatal("expected error for 400 response, got nil")
	}
	if !strings.Contains(err.Error(), "status 400") {
		t.Errorf("error should contain 'status 400', got: %v", err)
	}
	if !strings.Contains(err.Error(), "unsupported image format: webp") {
		t.Errorf("error should contain response body, got: %v", err)
	}
}

func TestOpenAICompatListModelsErrorBodySurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "server overloaded")
	}))
	defer srv.Close()

	p := NewOpenAICompatProvider(srv.URL+"/v1", "")
	_, err := p.ListModels(context.Background())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "server overloaded") {
		t.Errorf("error should contain response body, got: %v", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

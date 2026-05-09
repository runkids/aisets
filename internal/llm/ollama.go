package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// OllamaProvider implements Provider for a local Ollama instance.
type OllamaProvider struct {
	endpoint string
	client   *http.Client
}

// NewOllamaProvider creates an OllamaProvider targeting the given endpoint.
func NewOllamaProvider(endpoint string) *OllamaProvider {
	return &OllamaProvider{
		endpoint: strings.TrimRight(endpoint, "/"),
		client:   &http.Client{},
	}
}

func (p *OllamaProvider) Name() string { return "ollama" }

// Available probes the Ollama instance with a 5s timeout.
func (p *OllamaProvider) Available(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := p.ListModels(ctx)
	return err
}

// ollamaTagsResponse is the shape returned by GET /api/tags.
type ollamaTagsResponse struct {
	Models []struct {
		Name       string `json:"name"`
		Size       int64  `json:"size"`
		ModifiedAt string `json:"modified_at"`
	} `json:"models"`
}

// ListModels fetches available models from GET /api/tags.
func (p *OllamaProvider) ListModels(ctx context.Context) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint+"/api/tags", nil)
	if err != nil {
		return nil, fmt.Errorf("ollama: build request: %w", err)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: list models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama: list models: status %d", resp.StatusCode)
	}

	var raw ollamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("ollama: decode tags: %w", err)
	}

	models := make([]Model, len(raw.Models))
	for i, m := range raw.Models {
		models[i] = Model{
			Name:       m.Name,
			Size:       m.Size,
			ModifiedAt: m.ModifiedAt,
		}
	}
	return models, nil
}

// ollamaChatRequest is the body sent to POST /api/chat.
type ollamaChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

// ollamaChatResponse is the shape returned by POST /api/chat.
type ollamaChatResponse struct {
	Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"message"`
}

// Chat sends a chat request to POST /api/chat with a 60s timeout.
func (p *OllamaProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	msgs := make([]ChatMessage, len(req.Messages))
	for i, m := range req.Messages {
		msgs[i] = m
		if len(m.Images) > 0 {
			stripped := make([]string, len(m.Images))
			for j, img := range m.Images {
				if idx := strings.Index(img, ";base64,"); idx >= 0 {
					stripped[j] = img[idx+8:]
				} else {
					stripped[j] = img
				}
			}
			msgs[i].Images = stripped
		}
	}

	body := ollamaChatRequest{
		Model:    req.Model,
		Messages: msgs,
		Stream:   false,
	}
	b, err := json.Marshal(body)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("ollama: marshal chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("ollama: build chat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("ollama: chat: %w", err)
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		return ChatResponse{}, fmt.Errorf("ollama: chat: status %d", resp.StatusCode)
	}

	var raw ollamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return ChatResponse{}, fmt.Errorf("ollama: decode chat response: %w", err)
	}

	return ChatResponse{
		Content:    raw.Message.Content,
		DurationMs: durationMs,
	}, nil
}

// ollamaEmbedRequest is the body sent to POST /api/embed.
type ollamaEmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

// ollamaEmbedResponse is the shape returned by POST /api/embed.
type ollamaEmbedResponse struct {
	Embeddings [][]float32 `json:"embeddings"`
}

// Embed sends an embed request to POST /api/embed with a 30s timeout.
// It returns the first embedding vector from the response.
func (p *OllamaProvider) Embed(ctx context.Context, req EmbedRequest) (EmbedResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	body := ollamaEmbedRequest{Model: req.Model, Input: req.Input}
	b, err := json.Marshal(body)
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("ollama: marshal embed request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/api/embed", bytes.NewReader(b))
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("ollama: build embed request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("ollama: embed: %w", err)
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		return EmbedResponse{}, fmt.Errorf("ollama: embed: status %d", resp.StatusCode)
	}

	var raw ollamaEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return EmbedResponse{}, fmt.Errorf("ollama: decode embed response: %w", err)
	}
	if len(raw.Embeddings) == 0 {
		return EmbedResponse{}, fmt.Errorf("ollama: embed: empty embeddings in response")
	}

	return EmbedResponse{
		Embedding:  raw.Embeddings[0],
		DurationMs: durationMs,
	}, nil
}

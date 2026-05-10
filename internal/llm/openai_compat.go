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

// OpenAICompatProvider implements Provider for any server exposing the OpenAI-compatible
// /v1/models, /v1/chat/completions, and /v1/embeddings endpoints (e.g. LM Studio, llama.cpp, vLLM).
type OpenAICompatProvider struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

// NewOpenAICompatProvider creates an OpenAICompatProvider targeting the given endpoint.
// endpoint should include /v1, e.g. "http://localhost:1234/v1".
func NewOpenAICompatProvider(endpoint, apiKey string) *OpenAICompatProvider {
	return &OpenAICompatProvider{
		endpoint: strings.TrimRight(endpoint, "/"),
		apiKey:   apiKey,
		client:   &http.Client{},
	}
}

func (p *OpenAICompatProvider) Name() string { return "openai-compat" }

func (p *OpenAICompatProvider) setAuth(req *http.Request) {
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
}

// Available probes the server with a 5s timeout.
func (p *OpenAICompatProvider) Available(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := p.ListModels(ctx)
	return err
}

// openAIModelsResponse is the shape returned by GET /v1/models.
type openAIModelsResponse struct {
	Data []struct {
		ID      string `json:"id"`
		Created int64  `json:"created"`
		OwnedBy string `json:"owned_by"`
	} `json:"data"`
}

// ListModels fetches available models from GET /v1/models.
func (p *OpenAICompatProvider) ListModels(ctx context.Context) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("openai-compat: build request: %w", err)
	}
	p.setAuth(req)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai-compat: list models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openai-compat: list models: status %d", resp.StatusCode)
	}

	var raw openAIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("openai-compat: decode models: %w", err)
	}

	models := make([]Model, len(raw.Data))
	for i, m := range raw.Data {
		models[i] = Model{
			Name:       m.ID,
			ModifiedAt: time.Unix(m.Created, 0).UTC().Format(time.RFC3339),
		}
	}
	return models, nil
}

// openAIContentPart is a single element in a vision message content array.
type openAIContentPart struct {
	Type     string              `json:"type"`
	Text     string              `json:"text,omitempty"`
	ImageURL *openAIImageURLPart `json:"image_url,omitempty"`
}

// openAIImageURLPart holds the data URI for an image content part.
type openAIImageURLPart struct {
	URL string `json:"url"`
}

// openAIChatMessage is the wire format for a single chat message sent to the API.
// Content is interface{} to support both string (text-only) and []openAIContentPart (vision).
type openAIChatMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

// openAIChatRequest is the body sent to POST /v1/chat/completions.
type openAIChatRequest struct {
	Model    string              `json:"model"`
	Messages []openAIChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
}

// openAIChatResponse is the shape returned by POST /v1/chat/completions.
type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	} `json:"usage"`
}

func (p *OpenAICompatProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	timeout := DefaultChatTimeout
	if req.TimeoutSec > 0 {
		timeout = req.TimeoutSec
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	msgs := make([]openAIChatMessage, len(req.Messages))
	for i, m := range req.Messages {
		if len(m.Images) == 0 {
			msgs[i] = openAIChatMessage{Role: m.Role, Content: m.Content}
		} else {
			parts := make([]openAIContentPart, 0, 1+len(m.Images))
			parts = append(parts, openAIContentPart{Type: "text", Text: m.Content})
			for _, img := range m.Images {
				parts = append(parts, openAIContentPart{
					Type:     "image_url",
					ImageURL: &openAIImageURLPart{URL: img},
				})
			}
			msgs[i] = openAIChatMessage{Role: m.Role, Content: parts}
		}
	}

	body := openAIChatRequest{
		Model:    req.Model,
		Messages: msgs,
		Stream:   false,
	}
	b, err := json.Marshal(body)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai-compat: marshal chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai-compat: build chat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	p.setAuth(httpReq)

	start := time.Now()
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("openai-compat: chat: %w", err)
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		return ChatResponse{}, fmt.Errorf("openai-compat: chat: status %d", resp.StatusCode)
	}

	var raw openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return ChatResponse{}, fmt.Errorf("openai-compat: decode chat response: %w", err)
	}
	if len(raw.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("openai-compat: chat: empty choices in response")
	}

	return ChatResponse{
		Content:      raw.Choices[0].Message.Content,
		DurationMs:   durationMs,
		InputTokens:  raw.Usage.PromptTokens,
		OutputTokens: raw.Usage.CompletionTokens,
	}, nil
}

// openAIEmbedRequest is the body sent to POST /v1/embeddings.
type openAIEmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

// openAIEmbedResponse is the shape returned by POST /v1/embeddings.
type openAIEmbedResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

// Embed sends an embed request to POST /v1/embeddings with a 30s timeout.
// It returns the first embedding vector from the response.
func (p *OpenAICompatProvider) Embed(ctx context.Context, req EmbedRequest) (EmbedResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	body := openAIEmbedRequest{Model: req.Model, Input: req.Input}
	b, err := json.Marshal(body)
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("openai-compat: marshal embed request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/embeddings", bytes.NewReader(b))
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("openai-compat: build embed request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	p.setAuth(httpReq)

	start := time.Now()
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return EmbedResponse{}, fmt.Errorf("openai-compat: embed: %w", err)
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		return EmbedResponse{}, fmt.Errorf("openai-compat: embed: status %d", resp.StatusCode)
	}

	var raw openAIEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return EmbedResponse{}, fmt.Errorf("openai-compat: decode embed response: %w", err)
	}
	if len(raw.Data) == 0 {
		return EmbedResponse{}, fmt.Errorf("openai-compat: embed: empty data in response")
	}

	return EmbedResponse{
		Embedding:  raw.Data[0].Embedding,
		DurationMs: durationMs,
	}, nil
}

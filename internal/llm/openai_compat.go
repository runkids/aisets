package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("openai-compat: list models: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
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
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

// openAIChatMessage is the wire format for a single chat message sent to the API.
// Content is interface{} to support both string (text-only) and []openAIContentPart (vision).
type openAIChatMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type openAIChatTool struct {
	Type     string             `json:"type"`
	Function openAIChatFunction `json:"function"`
}

type openAIChatFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

// openAIChatRequest is the body sent to POST /v1/chat/completions.
type openAIChatRequest struct {
	Model      string              `json:"model"`
	Messages   []openAIChatMessage `json:"messages"`
	Stream     bool                `json:"stream"`
	Tools      []openAIChatTool    `json:"tools,omitempty"`
	ToolChoice any                 `json:"tool_choice,omitempty"`
}

// openAIChatResponse is the shape returned by POST /v1/chat/completions.
type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
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
	imageDetail := strings.TrimSpace(req.ImageDetail)
	if imageDetail == "" {
		imageDetail = "low"
	}
	for i, m := range req.Messages {
		if len(m.Images) == 0 {
			msgs[i] = openAIChatMessage{Role: m.Role, Content: m.Content}
		} else {
			parts := make([]openAIContentPart, 0, 1+len(m.Images))
			parts = append(parts, openAIContentPart{Type: "text", Text: m.Content})
			for _, img := range m.Images {
				parts = append(parts, openAIContentPart{
					Type:     "image_url",
					ImageURL: &openAIImageURLPart{URL: img, Detail: imageDetail},
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
	if len(req.Tools) > 0 {
		body.Tools = make([]openAIChatTool, 0, len(req.Tools))
		for _, tool := range req.Tools {
			body.Tools = append(body.Tools, openAIChatTool{
				Type: "function",
				Function: openAIChatFunction{
					Name:        tool.Name,
					Description: tool.Description,
					Parameters:  tool.Parameters,
				},
			})
		}
		if req.ToolChoice != "" {
			body.ToolChoice = req.ToolChoice
		}
	}
	raw, durationMs, err := p.postChat(ctx, body)
	if err != nil && body.ToolChoice != nil && len(body.Tools) > 0 && isOpenAICompatToolChoiceUnsupported(err.Error()) {
		body.ToolChoice = nil
		raw, durationMs, err = p.postChat(ctx, body)
	}
	if err != nil && openAIChatRequestHasImages(body) && isOpenAICompatContextLengthError(err.Error()) {
		body = openAIChatRequestWithoutImages(body)
		raw, durationMs, err = p.postChat(ctx, body)
	}
	if err != nil && len(body.Tools) > 0 && isOpenAICompatToolUnsupported(err.Error()) {
		body.Tools = nil
		body.ToolChoice = nil
		raw, durationMs, err = p.postChat(ctx, body)
	}
	if err != nil {
		return ChatResponse{}, err
	}
	if len(raw.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("openai-compat: chat: empty choices in response")
	}

	return ChatResponse{
		Content:      raw.Choices[0].Message.Content,
		ToolCalls:    openAIToolCalls(raw.Choices[0].Message.ToolCalls),
		DurationMs:   durationMs,
		InputTokens:  raw.Usage.PromptTokens,
		OutputTokens: raw.Usage.CompletionTokens,
	}, nil
}

func (p *OpenAICompatProvider) postChat(ctx context.Context, body openAIChatRequest) (openAIChatResponse, int64, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return openAIChatResponse{}, 0, fmt.Errorf("openai-compat: marshal chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return openAIChatResponse{}, 0, fmt.Errorf("openai-compat: build chat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	p.setAuth(httpReq)

	start := time.Now()
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return openAIChatResponse{}, 0, fmt.Errorf("openai-compat: chat: %w", err)
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return openAIChatResponse{}, durationMs, fmt.Errorf("openai-compat: chat: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var raw openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return openAIChatResponse{}, durationMs, fmt.Errorf("openai-compat: decode chat response: %w", err)
	}

	return raw, durationMs, nil
}

func isOpenAICompatToolUnsupported(msg string) bool {
	msg = strings.ToLower(msg)
	return strings.Contains(msg, "tool") || strings.Contains(msg, "function")
}

func isOpenAICompatToolChoiceUnsupported(msg string) bool {
	msg = strings.ToLower(msg)
	return strings.Contains(msg, "tool_choice") || strings.Contains(msg, "tool choice")
}

func isOpenAICompatContextLengthError(msg string) bool {
	msg = strings.ToLower(msg)
	return strings.Contains(msg, "context length") ||
		strings.Contains(msg, "context window") ||
		strings.Contains(msg, "too many tokens") ||
		strings.Contains(msg, "prompt is too long")
}

func openAIChatRequestHasImages(body openAIChatRequest) bool {
	for _, msg := range body.Messages {
		parts, ok := msg.Content.([]openAIContentPart)
		if !ok {
			continue
		}
		for _, part := range parts {
			if part.Type == "image_url" && part.ImageURL != nil && part.ImageURL.URL != "" {
				return true
			}
		}
	}
	return false
}

func openAIChatRequestWithoutImages(body openAIChatRequest) openAIChatRequest {
	next := body
	next.Messages = make([]openAIChatMessage, 0, len(body.Messages))
	for _, msg := range body.Messages {
		parts, ok := msg.Content.([]openAIContentPart)
		if !ok {
			next.Messages = append(next.Messages, msg)
			continue
		}
		var textParts []string
		for _, part := range parts {
			if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
				textParts = append(textParts, part.Text)
			}
		}
		msg.Content = strings.Join(textParts, "\n")
		next.Messages = append(next.Messages, msg)
	}
	return next
}

func openAIToolCalls(raw []struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}) []ChatToolCall {
	var calls []ChatToolCall
	for _, tc := range raw {
		if tc.Function.Name == "" {
			continue
		}
		args := parseOpenAIToolArguments(tc.Function.Arguments)
		calls = append(calls, ChatToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}
	return calls
}

func parseOpenAIToolArguments(raw json.RawMessage) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err == nil {
		raw = json.RawMessage(encoded)
	}
	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil
	}
	return args
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
	if len(req.Images) > 0 && req.Input == "" {
		return EmbedResponse{}, ErrImageEmbedNotSupported
	}
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
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return EmbedResponse{}, fmt.Errorf("openai-compat: embed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var raw openAIEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return EmbedResponse{}, fmt.Errorf("openai-compat: decode embed response: %w", err)
	}
	if len(raw.Data) == 0 {
		return EmbedResponse{}, fmt.Errorf("openai-compat: embed: empty data in response")
	}

	vec := raw.Data[0].Embedding
	return EmbedResponse{
		Embedding:  vec,
		Dimensions: len(vec),
		DurationMs: durationMs,
	}, nil
}

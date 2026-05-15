package llm

import "errors"

// ErrImageEmbedNotSupported is returned by Embed when the provider cannot embed images.
var ErrImageEmbedNotSupported = errors.New("provider does not support image embedding")

const (
	DefaultConcurrency = 1
	MaxConcurrency     = 8
	DefaultChatTimeout = 120
	MinChatTimeout     = 30
	MaxChatTimeout     = 600
)

type Model struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type ChatMessage struct {
	Role    string   `json:"role"`
	Content string   `json:"content"`
	Images  []string `json:"images,omitempty"`
}

type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Tools       []ChatTool    `json:"tools,omitempty"`
	ToolChoice  string        `json:"toolChoice,omitempty"`
	ImageDetail string        `json:"imageDetail,omitempty"`
	TimeoutSec  int           `json:"timeoutSec,omitempty"`
}

type ChatTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type ChatToolCall struct {
	ID        string         `json:"id,omitempty"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type ChatResponse struct {
	Content      string         `json:"content"`
	DurationMs   int64          `json:"durationMs"`
	InputTokens  int64          `json:"inputTokens"`
	OutputTokens int64          `json:"outputTokens"`
	ToolCalls    []ChatToolCall `json:"toolCalls,omitempty"`
}

type EmbedRequest struct {
	Model  string   `json:"model"`
	Input  string   `json:"input"`
	Images []string `json:"images,omitempty"`
}

type EmbedResponse struct {
	Embedding  []float32 `json:"embedding"`
	Dimensions int       `json:"dimensions"`
	DurationMs int64     `json:"durationMs"`
}

type RuntimeStatus struct {
	Provider    string  `json:"provider"`
	Endpoint    string  `json:"endpoint"`
	Connected   bool    `json:"connected"`
	Error       string  `json:"error,omitempty"`
	Models      []Model `json:"models"`
	VisionModel string  `json:"visionModel"`
	EmbedModel  string  `json:"embedModel"`
}

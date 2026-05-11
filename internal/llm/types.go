package llm

const (
	DefaultConcurrency = 1
	MaxConcurrency     = 8
	DefaultChatTimeout = 30
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
	Model      string        `json:"model"`
	Messages   []ChatMessage `json:"messages"`
	TimeoutSec int           `json:"timeoutSec,omitempty"`
}

type ChatResponse struct {
	Content      string `json:"content"`
	DurationMs   int64  `json:"durationMs"`
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
}

type EmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type EmbedResponse struct {
	Embedding  []float32 `json:"embedding"`
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

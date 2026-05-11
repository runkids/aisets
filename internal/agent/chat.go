package agent

import "context"

type ChatRequest struct {
	Model        string
	SystemPrompt string
	Prompt       string
	ImagePaths   []string
	TimeoutSec   int
}

type ChatResult struct {
	Content      string
	InputTokens  int64
	OutputTokens int64
	DurationMs   int64
	Err          error
}

type ChatProvider interface {
	ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(idx int, res ChatResult)) error
	Close() error
}

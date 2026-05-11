package agent

import (
	"context"
	"fmt"
	"strings"
)

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

func runBatch(ctx context.Context, reqs []ChatRequest, onResult func(int, ChatResult), chatOne func(context.Context, ChatRequest) ChatResult) error {
	for i, req := range reqs {
		onResult(i, chatOne(ctx, req))
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}

func buildCLIPrompt(systemPrompt, userPrompt string, imagePaths []string) string {
	var b strings.Builder
	if systemPrompt != "" {
		b.WriteString(systemPrompt)
		b.WriteString("\n\n")
	}
	for _, p := range imagePaths {
		fmt.Fprintf(&b, "First, read the image file at: %s\nThen analyze it as instructed below.\n\n", p)
	}
	b.WriteString(userPrompt)
	return b.String()
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

package agent

import (
	"aisets/internal/llm"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

type PrepareImageFunc func(localPath, ext, purpose string) (string, error)

type LocalLLMChatProvider struct {
	provider     llm.Provider
	prepareImage PrepareImageFunc
}

func NewLocalLLMChatProvider(provider llm.Provider, prepareImage PrepareImageFunc) *LocalLLMChatProvider {
	return &LocalLLMChatProvider{provider: provider, prepareImage: prepareImage}
}

func (p *LocalLLMChatProvider) ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(int, ChatResult)) error {
	return runBatch(ctx, reqs, onResult, p.chatOne)
}

func (p *LocalLLMChatProvider) Close() error { return nil }

func (p *LocalLLMChatProvider) chatOne(ctx context.Context, req ChatRequest) ChatResult {
	var images []string
	for _, imgPath := range req.ImagePaths {
		ext := strings.ToLower(filepath.Ext(imgPath))
		dataURI, err := p.prepareImage(imgPath, ext, "vlm")
		if err != nil {
			return ChatResult{Err: fmt.Errorf("prepare image %s: %w", imgPath, err)}
		}
		images = append(images, dataURI)
	}

	var messages []llm.ChatMessage
	if req.SystemPrompt != "" {
		messages = append(messages, llm.ChatMessage{Role: "system", Content: req.SystemPrompt})
	}
	messages = append(messages, llm.ChatMessage{
		Role:    "user",
		Content: req.Prompt,
		Images:  images,
	})

	start := time.Now()
	resp, err := p.provider.Chat(ctx, llm.ChatRequest{
		Model:      req.Model,
		Messages:   messages,
		TimeoutSec: req.TimeoutSec,
	})
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		return ChatResult{DurationMs: durationMs, Err: err}
	}
	return ChatResult{
		Content:      resp.Content,
		InputTokens:  resp.InputTokens,
		OutputTokens: resp.OutputTokens,
		DurationMs:   durationMs,
	}
}

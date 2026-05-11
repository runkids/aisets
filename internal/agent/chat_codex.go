package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type CodexChatProvider struct {
	binPath string
}

func NewCodexChatProvider(binPath string) *CodexChatProvider {
	return &CodexChatProvider{binPath: binPath}
}

func (p *CodexChatProvider) ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(idx int, res ChatResult)) error {
	for i, req := range reqs {
		res := p.chatOne(ctx, req)
		onResult(i, res)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}

func (p *CodexChatProvider) Close() error { return nil }

func (p *CodexChatProvider) chatOne(ctx context.Context, req ChatRequest) ChatResult {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := []string{"exec"}
	for _, img := range req.ImagePaths {
		args = append(args, "-i", img)
	}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}

	prompt := req.Prompt
	if req.SystemPrompt != "" {
		prompt = req.SystemPrompt + "\n\n" + req.Prompt
	}

	cmd := exec.CommandContext(ctx, p.binPath, args...)
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		return ChatResult{
			DurationMs: durationMs,
			Err:        fmt.Errorf("codex cli: %w (stderr: %s)", err, truncate(stderr.String(), 500)),
		}
	}

	return ChatResult{
		Content:    strings.TrimSpace(stdout.String()),
		DurationMs: durationMs,
	}
}

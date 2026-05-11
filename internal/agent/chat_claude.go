package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type ClaudeChatProvider struct {
	binPath string
}

func NewClaudeChatProvider(binPath string) *ClaudeChatProvider {
	return &ClaudeChatProvider{binPath: binPath}
}

func (p *ClaudeChatProvider) ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(idx int, res ChatResult)) error {
	for i, req := range reqs {
		res := p.chatOne(ctx, req)
		onResult(i, res)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}

func (p *ClaudeChatProvider) Close() error { return nil }

func (p *ClaudeChatProvider) chatOne(ctx context.Context, req ChatRequest) ChatResult {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := []string{
		"-p",
		"--bare",
		"--output-format", "text",
		"--allowedTools", "Read",
	}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}

	prompt := buildCLIPrompt(req.SystemPrompt, req.Prompt, req.ImagePaths)

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
			Err:        fmt.Errorf("claude cli: %w (stderr: %s)", err, truncate(stderr.String(), 500)),
		}
	}

	return ChatResult{
		Content:    strings.TrimSpace(stdout.String()),
		DurationMs: durationMs,
	}
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

package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type CLIChatProvider struct {
	binPath      string
	name         string
	buildArgs    func(req ChatRequest) []string
	buildPrompt  func(req ChatRequest) string
}

func (p *CLIChatProvider) ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(int, ChatResult)) error {
	return runBatch(ctx, reqs, onResult, p.chatOne)
}

func (p *CLIChatProvider) Close() error { return nil }

func (p *CLIChatProvider) chatOne(ctx context.Context, req ChatRequest) ChatResult {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := p.buildArgs(req)
	prompt := p.buildPrompt(req)

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
			Err:        fmt.Errorf("%s cli: %w (stderr: %s)", p.name, err, truncate(stderr.String(), 500)),
		}
	}

	return ChatResult{
		Content:    strings.TrimSpace(stdout.String()),
		DurationMs: durationMs,
	}
}

func defaultCLIPrompt(req ChatRequest) string {
	return buildCLIPrompt(req.SystemPrompt, req.Prompt, req.ImagePaths)
}

func plainPrompt(req ChatRequest) string {
	if req.SystemPrompt != "" {
		return req.SystemPrompt + "\n\n" + req.Prompt
	}
	return req.Prompt
}

func newCLIChatProvider(binPath, name string, buildArgs func(ChatRequest) []string) *CLIChatProvider {
	return &CLIChatProvider{
		binPath:     binPath,
		name:        filepath.Base(binPath),
		buildArgs:   buildArgs,
		buildPrompt: defaultCLIPrompt,
	}
}

func newClaudeChatProvider(binPath string) *CLIChatProvider {
	p := newCLIChatProvider(binPath, "claude", func(req ChatRequest) []string {
		args := []string{"-p", "--bare", "--output-format", "text", "--allowedTools", "Read"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
	return p
}

func newCodexChatProvider(binPath string) *CLIChatProvider {
	p := newCLIChatProvider(binPath, "codex", func(req ChatRequest) []string {
		args := []string{"exec"}
		for _, img := range req.ImagePaths {
			args = append(args, "-i", img)
		}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
	p.buildPrompt = plainPrompt
	return p
}

func newGeminiChatProvider(binPath string) *CLIChatProvider {
	return newCLIChatProvider(binPath, "gemini", func(req ChatRequest) []string {
		args := []string{"--output-format", "text", "--yolo"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

func newCopilotChatProvider(binPath string) *CLIChatProvider {
	return newCLIChatProvider(binPath, "copilot", func(req ChatRequest) []string {
		args := []string{"--allow-all-tools", "--output-format", "text"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

func newCursorChatProvider(binPath string) *CLIChatProvider {
	return newCLIChatProvider(binPath, "cursor-agent", func(req ChatRequest) []string {
		args := []string{"--print", "--force", "--trust"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

func newPiChatProvider(binPath string) *CLIChatProvider {
	return newCLIChatProvider(binPath, "pi", func(req ChatRequest) []string {
		args := []string{"-p"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

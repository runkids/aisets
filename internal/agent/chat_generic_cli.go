package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type GenericCLIChatProvider struct {
	binPath   string
	buildArgs func(req ChatRequest) []string
}

func NewGeminiChatProvider(binPath string) *GenericCLIChatProvider {
	return &GenericCLIChatProvider{
		binPath: binPath,
		buildArgs: func(req ChatRequest) []string {
			args := []string{"--output-format", "text", "--yolo"}
			if req.Model != "" {
				args = append(args, "--model", req.Model)
			}
			return args
		},
	}
}

func NewCopilotChatProvider(binPath string) *GenericCLIChatProvider {
	return &GenericCLIChatProvider{
		binPath: binPath,
		buildArgs: func(req ChatRequest) []string {
			args := []string{"--allow-all-tools", "--output-format", "text"}
			if req.Model != "" {
				args = append(args, "--model", req.Model)
			}
			return args
		},
	}
}

func NewCursorChatProvider(binPath string) *GenericCLIChatProvider {
	return &GenericCLIChatProvider{
		binPath: binPath,
		buildArgs: func(req ChatRequest) []string {
			args := []string{"--print", "--force", "--trust"}
			if req.Model != "" {
				args = append(args, "--model", req.Model)
			}
			return args
		},
	}
}

func NewPiChatProvider(binPath string) *GenericCLIChatProvider {
	return &GenericCLIChatProvider{
		binPath: binPath,
		buildArgs: func(req ChatRequest) []string {
			args := []string{"-p"}
			if req.Model != "" {
				args = append(args, "--model", req.Model)
			}
			return args
		},
	}
}

func (p *GenericCLIChatProvider) ChatBatch(ctx context.Context, reqs []ChatRequest, onResult func(idx int, res ChatResult)) error {
	for i, req := range reqs {
		res := p.chatOne(ctx, req)
		onResult(i, res)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}

func (p *GenericCLIChatProvider) Close() error { return nil }

func (p *GenericCLIChatProvider) chatOne(ctx context.Context, req ChatRequest) ChatResult {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := p.buildArgs(req)
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
			Err:        fmt.Errorf("%s cli: %w (stderr: %s)", p.binPath, err, truncate(stderr.String(), 500)),
		}
	}

	return ChatResult{
		Content:    strings.TrimSpace(stdout.String()),
		DurationMs: durationMs,
	}
}

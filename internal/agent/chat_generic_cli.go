package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
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
	prepareImage PrepareImageFunc
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

	req, cleanup, err := p.prepareImages(req)
	if err != nil {
		return ChatResult{Err: err}
	}
	defer cleanup()

	args := p.buildArgs(req)
	prompt := p.buildPrompt(req)

	cmd := exec.CommandContext(ctx, p.binPath, args...)
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err = cmd.Run()
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		detail := truncate(stderr.String(), 500)
		if detail == "" {
			detail = truncate(stdout.String(), 500)
		}
		return ChatResult{
			DurationMs: durationMs,
			Err:        fmt.Errorf("%s cli: %w (output: %s)", p.name, err, detail),
		}
	}

	return ChatResult{
		Content:    strings.TrimSpace(stdout.String()),
		DurationMs: durationMs,
	}
}

func (p *CLIChatProvider) prepareImages(req ChatRequest) (ChatRequest, func(), error) {
	if p.prepareImage == nil || len(req.ImagePaths) == 0 {
		return req, func() {}, nil
	}
	next := req
	next.ImagePaths = append([]string(nil), req.ImagePaths...)
	cleanups := make([]func(), 0, len(req.ImagePaths))
	cleanup := func() {
		for i := len(cleanups) - 1; i >= 0; i-- {
			cleanups[i]()
		}
	}

	for i, imgPath := range req.ImagePaths {
		ext := strings.ToLower(filepath.Ext(imgPath))
		dataURI, err := p.prepareImage(imgPath, ext, "vlm")
		if err != nil {
			continue
		}
		tmpPath, tmpCleanup, err := dataURIToTempFile(dataURI)
		if err != nil {
			cleanup()
			return ChatRequest{}, func() {}, fmt.Errorf("prepare cli image %s: %w", imgPath, err)
		}
		next.ImagePaths[i] = tmpPath
		cleanups = append(cleanups, tmpCleanup)
	}
	return next, cleanup, nil
}

func dataURIToTempFile(dataURI string) (string, func(), error) {
	header, encoded, ok := strings.Cut(dataURI, ",")
	if !ok || !strings.Contains(header, ";base64") {
		return "", nil, fmt.Errorf("unsupported data URI")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, err
	}
	suffix := ".png"
	if strings.Contains(header, "image/jpeg") {
		suffix = ".jpg"
	} else if strings.Contains(header, "image/webp") {
		suffix = ".webp"
	} else if strings.Contains(header, "image/gif") {
		suffix = ".gif"
	} else if strings.Contains(header, "image/avif") {
		suffix = ".avif"
	}
	f, err := os.CreateTemp("", "aisets-agent-image-*"+suffix)
	if err != nil {
		return "", nil, err
	}
	path := f.Name()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", nil, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", nil, err
	}
	return path, func() { _ = os.Remove(path) }, nil
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

func newCLIChatProvider(binPath, name string, prepareImage PrepareImageFunc, buildArgs func(ChatRequest) []string) *CLIChatProvider {
	return &CLIChatProvider{
		binPath:      binPath,
		name:         name,
		buildArgs:    buildArgs,
		buildPrompt:  defaultCLIPrompt,
		prepareImage: prepareImage,
	}
}

func newClaudeChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	p := newCLIChatProvider(binPath, "claude", prepareImage, func(req ChatRequest) []string {
		args := []string{"-p", "--output-format", "text", "--allowedTools", "Read"}
		if req.SystemPrompt != "" {
			args = append(args, "--system-prompt", req.SystemPrompt)
		}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
	p.buildPrompt = func(req ChatRequest) string {
		return buildCLIPrompt("", req.Prompt, req.ImagePaths)
	}
	return p
}

func newCodexChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	p := newCLIChatProvider(binPath, "codex", prepareImage, func(req ChatRequest) []string {
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

func newAntigravityChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	return newCLIChatProvider(binPath, "antigravity", prepareImage, func(req ChatRequest) []string {
		return []string{"--print", "--dangerously-skip-permissions"}
	})
}

func newCopilotChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	return newCLIChatProvider(binPath, "copilot", prepareImage, func(req ChatRequest) []string {
		args := []string{"--allow-all-tools", "--output-format", "text"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

func newCursorChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	return newCLIChatProvider(binPath, "cursor-agent", prepareImage, func(req ChatRequest) []string {
		args := []string{"--print", "--force", "--trust"}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
}

func newPiChatProvider(binPath string, prepareImage PrepareImageFunc) *CLIChatProvider {
	p := newCLIChatProvider(binPath, "pi", prepareImage, func(req ChatRequest) []string {
		args := []string{"-p"}
		if req.SystemPrompt != "" {
			args = append(args, "--system-prompt", req.SystemPrompt)
		}
		if req.Model != "" {
			args = append(args, "--model", req.Model)
		}
		return args
	})
	p.buildPrompt = func(req ChatRequest) string {
		return buildCLIPrompt("", req.Prompt, req.ImagePaths)
	}
	return p
}

package agent

import (
	"context"
	"os/exec"
	"strings"
)

type GeminiAdapter struct{}

func (a *GeminiAdapter) ID() string { return "gemini" }

func (a *GeminiAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("gemini")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "gemini",
		Name:    "Gemini CLI",
		Version: version,
		Path:    path,
	}, nil
}

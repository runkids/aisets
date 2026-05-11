package agent

import (
	"context"
	"os/exec"
	"strings"
)

type ClaudeAdapter struct{}

func (a *ClaudeAdapter) ID() string { return "claude" }

func (a *ClaudeAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("claude")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "claude",
		Name:    "Claude Code",
		Version: version,
		Path:    path,
	}, nil
}

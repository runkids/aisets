package agent

import (
	"context"
	"os/exec"
	"strings"
)

type CodexAdapter struct{}

func (a *CodexAdapter) ID() string { return "codex" }

func (a *CodexAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("codex")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "codex",
		Name:    "Codex CLI",
		Version: version,
		Path:    path,
	}, nil
}

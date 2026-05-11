package agent

import (
	"context"
	"os/exec"
	"strings"
)

type CursorAdapter struct{}

func (a *CursorAdapter) ID() string { return "cursor-agent" }

func (a *CursorAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("cursor-agent")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "cursor-agent",
		Name:    "Cursor Agent",
		Version: version,
		Path:    path,
	}, nil
}

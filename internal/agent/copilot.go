package agent

import (
	"context"
	"os/exec"
	"strings"
)

type CopilotAdapter struct{}

func (a *CopilotAdapter) ID() string { return "copilot" }

func (a *CopilotAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("copilot")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "copilot",
		Name:    "Copilot CLI",
		Version: version,
		Path:    path,
	}, nil
}

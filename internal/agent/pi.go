package agent

import (
	"context"
	"os/exec"
	"strings"
)

type PiAdapter struct{}

func (a *PiAdapter) ID() string { return "pi" }

func (a *PiAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath("pi")
	if err != nil {
		return nil, nil
	}
	version := ""
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{
		ID:      "pi",
		Name:    "Pi",
		Version: version,
		Path:    path,
	}, nil
}

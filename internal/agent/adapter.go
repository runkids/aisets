package agent

import (
	"context"
	"os/exec"
	"strings"
)

const (
	AdapterClaude      = "claude"
	AdapterCodex       = "codex"
	AdapterCursorAgent = "cursor-agent"
	AdapterGemini      = "gemini"
	AdapterCopilot     = "copilot"
	AdapterPi          = "pi"
	AdapterLocalLLM    = "local-llm"

	BackendLocalLLM = "local-llm"
	backendPrefix   = "agent:"

	FeatureTag       = "tag"
	FeatureOCR       = "ocr"
	FeatureOptimize  = "optimize"
	FeatureDuplicate = "duplicate"
	FeaturePrecheck  = "precheck"
	FeatureTranslate = "translate"
)

func AgentBackendID(backend string) (id string, ok bool) {
	if strings.HasPrefix(backend, backendPrefix) {
		rest := strings.TrimPrefix(backend, backendPrefix)
		if idx := strings.Index(rest, "/"); idx >= 0 {
			return rest[:idx], true
		}
		return rest, true
	}
	return "", false
}

func AgentBackendModel(backend string) string {
	if strings.HasPrefix(backend, backendPrefix) {
		rest := strings.TrimPrefix(backend, backendPrefix)
		if idx := strings.Index(rest, "/"); idx >= 0 {
			return rest[idx+1:]
		}
	}
	return ""
}

func LocalLLMBackendModel(backend string) string {
	const prefix = BackendLocalLLM + "/"
	if strings.HasPrefix(backend, prefix) {
		return strings.TrimPrefix(backend, prefix)
	}
	return ""
}

func FormatAgentBackend(adapterID string) string {
	return backendPrefix + adapterID
}

type Adapter interface {
	ID() string
	Detect(ctx context.Context) (*AdapterInfo, error)
}

type CLIAdapter struct {
	id, name, bin string
}

func (a *CLIAdapter) ID() string { return a.id }

func (a *CLIAdapter) Detect(ctx context.Context) (*AdapterInfo, error) {
	path, err := exec.LookPath(a.bin)
	if err != nil {
		return nil, nil
	}
	version := ""
	if out, err := exec.CommandContext(ctx, path, "--version").Output(); err == nil {
		version = strings.TrimSpace(string(out))
	}
	return &AdapterInfo{ID: a.id, Name: a.name, Version: version, Path: path}, nil
}

type AdapterInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

type RuntimeStatus struct {
	Adapters  []AdapterInfo `json:"adapters"`
	Active    string        `json:"active"`
	Available bool          `json:"available"`
}

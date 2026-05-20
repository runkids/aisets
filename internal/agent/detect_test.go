package agent

import (
	"context"
	"testing"
)

func TestResolveActive_Auto(t *testing.T) {
	adapters := []AdapterInfo{
		{ID: "codex", Name: "Codex CLI"},
		{ID: "claude", Name: "Claude Code"},
	}
	got := ResolveActive(adapters, "auto")
	if got != "codex" {
		t.Errorf("auto: expected codex, got %s", got)
	}
}

func TestResolveActive_Explicit(t *testing.T) {
	adapters := []AdapterInfo{
		{ID: "codex", Name: "Codex CLI"},
		{ID: "claude", Name: "Claude Code"},
	}
	got := ResolveActive(adapters, "claude")
	if got != "claude" {
		t.Errorf("explicit: expected claude, got %s", got)
	}
}

func TestResolveActive_ExplicitNotFound(t *testing.T) {
	adapters := []AdapterInfo{
		{ID: "codex", Name: "Codex CLI"},
	}
	got := ResolveActive(adapters, "claude")
	if got != "" {
		t.Errorf("not found: expected empty, got %s", got)
	}
}

func TestResolveActive_Empty(t *testing.T) {
	got := ResolveActive(nil, "auto")
	if got != "" {
		t.Errorf("empty: expected empty, got %s", got)
	}
}

func TestResolveActive_EmptyPreference(t *testing.T) {
	adapters := []AdapterInfo{
		{ID: "antigravity", Name: "Antigravity 2.0"},
	}
	got := ResolveActive(adapters, "")
	if got != "antigravity" {
		t.Errorf("empty pref: expected antigravity, got %s", got)
	}
}

func TestBuildRuntimeStatus(t *testing.T) {
	status := BuildRuntimeStatus(context.Background(), "auto", LLMInfo{})
	if status.Adapters == nil {
		status.Adapters = []AdapterInfo{}
	}
	if len(status.Active) > 0 && !status.Available {
		t.Error("active set but available is false")
	}
}

func TestDefaultAntigravityAdapterUsesAgyCLI(t *testing.T) {
	for _, adapter := range defaultAdapters {
		cli, ok := adapter.(*CLIAdapter)
		if !ok || cli.id != AdapterAntigravity {
			continue
		}
		if cli.bin != "agy" {
			t.Fatalf("expected Antigravity CLI binary agy, got %s", cli.bin)
		}
		return
	}
	t.Fatal("expected Antigravity adapter")
}

func TestLocalLLMDetect_Enabled(t *testing.T) {
	a := NewLocalLLMAdapter(LLMInfo{Enabled: true, Provider: "ollama", Model: "llava:7b"})
	info, err := a.Detect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info == nil {
		t.Fatal("expected local-llm info")
	}
	if info.ID != "local-llm" {
		t.Errorf("expected local-llm, got %s", info.ID)
	}
	if info.Version != "ollama/llava:7b" {
		t.Errorf("expected ollama/llava:7b, got %s", info.Version)
	}
}

func TestLocalLLMDetect_Disabled(t *testing.T) {
	a := NewLocalLLMAdapter(LLMInfo{Enabled: false, Provider: "ollama"})
	info, _ := a.Detect(context.Background())
	if info != nil {
		t.Error("expected nil when disabled")
	}
}

func TestLocalLLMDetect_NoProvider(t *testing.T) {
	a := NewLocalLLMAdapter(LLMInfo{Enabled: true, Provider: ""})
	info, _ := a.Detect(context.Background())
	if info != nil {
		t.Error("expected nil when no provider")
	}
}

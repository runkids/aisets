package agent

import "testing"

func TestAgentBackendID(t *testing.T) {
	tests := []struct {
		input  string
		wantID string
		wantOK bool
	}{
		{"agent:codex", "codex", true},
		{"agent:claude", "claude", true},
		{"agent:codex/gpt-5.5", "codex", true},
		{"agent:claude/claude-sonnet-4-6", "claude", true},
		{"local-llm", "", false},
		{"local-llm/gemma-4-e4b-it", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		id, ok := AgentBackendID(tt.input)
		if id != tt.wantID || ok != tt.wantOK {
			t.Errorf("AgentBackendID(%q) = (%q, %v), want (%q, %v)", tt.input, id, ok, tt.wantID, tt.wantOK)
		}
	}
}

func TestAgentBackendModel(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"agent:codex/gpt-5.5", "gpt-5.5"},
		{"agent:claude/claude-sonnet-4-6", "claude-sonnet-4-6"},
		{"agent:codex", ""},
		{"local-llm", ""},
		{"local-llm/gemma-4-e4b-it", ""},
		{"", ""},
	}
	for _, tt := range tests {
		got := AgentBackendModel(tt.input)
		if got != tt.want {
			t.Errorf("AgentBackendModel(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestLocalLLMBackendModel(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"local-llm/gemma-4-e4b-it", "gemma-4-e4b-it"},
		{"local-llm/qwen3-vl-4b-instruct", "qwen3-vl-4b-instruct"},
		{"local-llm", ""},
		{"agent:codex", ""},
		{"agent:codex/gpt-5.5", ""},
		{"", ""},
	}
	for _, tt := range tests {
		got := LocalLLMBackendModel(tt.input)
		if got != tt.want {
			t.Errorf("LocalLLMBackendModel(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

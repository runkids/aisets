package config

import "testing"

func TestRewriteLocalhostEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"localhost with port", "http://localhost:1234/v1", "http://host.docker.internal:1234/v1"},
		{"localhost default ollama", "http://localhost:11434", "http://host.docker.internal:11434"},
		{"127.0.0.1 with port", "http://127.0.0.1:1234/v1", "http://host.docker.internal:1234/v1"},
		{"localhost no port", "http://localhost", "http://host.docker.internal"},
		{"localhost https", "https://localhost:8443/api", "https://host.docker.internal:8443/api"},
		{"non-localhost unchanged", "http://my-server:1234/v1", "http://my-server:1234/v1"},
		{"remote host unchanged", "https://api.openai.com/v1", "https://api.openai.com/v1"},
		{"empty string", "", ""},
		{"host.docker.internal unchanged", "http://host.docker.internal:11434", "http://host.docker.internal:11434"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := rewriteLocalhostEndpoint(tt.input)
			if got != tt.expected {
				t.Errorf("rewriteLocalhostEndpoint(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

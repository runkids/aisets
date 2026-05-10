package ocr

import "testing"

func TestFinalizeResultDeriveModelName(t *testing.T) {
	tests := []struct {
		name         string
		engineName   string
		engineVer    string
		wantProvider string
		wantModel    string
	}{
		{"vlm ollama", "vlm", "ollama/llava", "ollama", "llava"},
		{"vlm openai-compat", "vlm", "openai-compat/gpt-4o", "openai-compat", "gpt-4o"},
		{"vlm nested slash", "vlm", "openai-compat/org/model", "openai-compat", "org/model"},
		{"vlm no provider", "vlm", "some-model", "", "some-model"},
		{"tesseract untouched", "tesseract", "5.3.1", "", ""},
		{"vlm empty version", "vlm", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &Result{EngineName: tt.engineName, EngineVersion: tt.engineVer, Status: StatusReady}
			FinalizeResult(r)
			if r.ProviderName != tt.wantProvider {
				t.Errorf("ProviderName = %q, want %q", r.ProviderName, tt.wantProvider)
			}
			if r.ModelName != tt.wantModel {
				t.Errorf("ModelName = %q, want %q", r.ModelName, tt.wantModel)
			}
		})
	}
}

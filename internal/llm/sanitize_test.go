package llm

import "testing"

func TestStripFences(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain json", `{"a":1}`, `{"a":1}`},
		{"json fence", "```json\n{\"a\":1}\n```", `{"a":1}`},
		{"bare fence", "```\n{\"a\":1}\n```", `{"a":1}`},
		{"no closing fence", "```json\n{\"a\":1}", `{"a":1}`},
		{"no opening fence", "{\"a\":1}\n```", `{"a":1}`},
		{"surrounding whitespace", "  ```json\n{\"a\":1}\n```  ", `{"a":1}`},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StripFences(tt.in)
			if got != tt.want {
				t.Errorf("StripFences(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestFixJSON(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"valid json", `{"a":1}`, `{"a":1}`},
		{"trailing comma obj", `{"a":1,}`, `{"a":1}`},
		{"trailing comma arr", `{"a":[1,2,]}`, `{"a":[1,2]}`},
		{"leading text", `Here is the JSON: {"a":1}`, `{"a":1}`},
		{"trailing text", `{"a":1} some text`, `{"a":1}`},
		{
			"missing comma between lines",
			"{\"a\":1\n\"b\":2}",
			"{\"a\":1,\"b\":2}",
		},
		{"no braces", "hello world", "hello world"},
		{"empty", "", ""},
		{
			"nested objects",
			`{"a":{"b":1,},"c":[3,]}`,
			`{"a":{"b":1},"c":[3]}`,
		},
		{
			"non-JSON brace before real JSON",
			`{æ¯å‹•} {"tags":["icon"]}`,
			`{"tags":["icon"]}`,
		},
		{
			"CJK text with braces before JSON",
			`這是分析結果{結果}：{"category":"ui"}`,
			`{"category":"ui"}`,
		},
		{
			"only non-JSON braces",
			`{æ¯å‹•ç•«}`,
			`{æ¯å‹•ç•«}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FixJSON(tt.in)
			if got != tt.want {
				t.Errorf("FixJSON(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestCleanJSON(t *testing.T) {
	in := "```json\nHere: {\"a\":1,}\n```"
	want := `{"a":1}`
	got := CleanJSON(in)
	if got != want {
		t.Errorf("CleanJSON(%q) = %q, want %q", in, got, want)
	}
}

func TestLocaleDisplayName(t *testing.T) {
	tests := []struct {
		lang string
		want string
	}{
		{"en", "English"},
		{"zh-TW", "Traditional Chinese (繁體中文)"},
		{"zh-CN", "Simplified Chinese (简体中文)"},
		{"ja", "Japanese (日本語)"},
		{"ko", "Korean (한국어)"},
		{"fr", ""},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			got := LocaleDisplayName(tt.lang)
			if got != tt.want {
				t.Errorf("LocaleDisplayName(%q) = %q, want %q", tt.lang, got, tt.want)
			}
		})
	}
}

func TestSystemPrompt(t *testing.T) {
	if got := SystemPrompt(true, "hello"); got != "hello" {
		t.Errorf("got %q", got)
	}
	if got := SystemPrompt(false, "hello"); got != "" {
		t.Errorf("got %q", got)
	}
	if got := SystemPrompt(true, ""); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestAppendLocaleInstruction(t *testing.T) {
	base := "Analyze this image."
	tests := []struct {
		name        string
		autoLocale  bool
		lang        string
		instruction string
		want        string
	}{
		{
			"appends when enabled",
			true, "ja", "Write all text in",
			base + "\n\nIMPORTANT: Write all text in Japanese (日本語).",
		},
		{"disabled", false, "ja", "Write all text in", base},
		{"empty lang", true, "", "Write all text in", base},
		{"unknown lang", true, "fr", "Write all text in", base},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := AppendLocaleInstruction(base, tt.autoLocale, tt.lang, tt.instruction)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

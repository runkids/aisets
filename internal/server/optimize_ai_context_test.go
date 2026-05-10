package server

import (
	"testing"

	"aisets/internal/imageproc"
	"aisets/internal/lint"
	"aisets/internal/scanner"
)

func TestFormatFileMetadata(t *testing.T) {
	tests := []struct {
		name string
		item scanner.AssetItem
		want string
	}{
		{
			name: "png with transparency",
			item: scanner.AssetItem{
				RepoPath: "assets/icon.png",
				Ext:      ".png",
				Bytes:    245760,
				Image:    imageproc.Metadata{Width: 512, Height: 512, Alpha: true},
			},
			want: "File: icon.png (.png, 240 KB, 512x512, has transparency, not animated)",
		},
		{
			name: "animated gif",
			item: scanner.AssetItem{
				RepoPath: "images/loading.gif",
				Ext:      ".gif",
				Bytes:    1048576,
				Image:    imageproc.Metadata{Width: 200, Height: 200, Animated: true},
			},
			want: "File: loading.gif (.gif, 1.0 MB, 200x200, no transparency, animated)",
		},
		{
			name: "large svg",
			item: scanner.AssetItem{
				RepoPath: "assets/images/tutorial.svg",
				Ext:      ".svg",
				Bytes:    8073216,
				Image:    imageproc.Metadata{Width: 360, Height: 614},
			},
			want: "File: tutorial.svg (.svg, 7.7 MB, 360x614, no transparency, not animated)",
		},
		{
			name: "small file",
			item: scanner.AssetItem{
				RepoPath: "thumb.jpg",
				Ext:      ".jpg",
				Bytes:    512,
				Image:    imageproc.Metadata{Width: 32, Height: 32},
			},
			want: "File: thumb.jpg (.jpg, 512 B, 32x32, no transparency, not animated)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatFileMetadata(tt.item)
			if got != tt.want {
				t.Errorf("formatFileMetadata() =\n  %q\nwant\n  %q", got, tt.want)
			}
		})
	}
}

func TestFormatLintFindings(t *testing.T) {
	tests := []struct {
		name     string
		findings []lint.Finding
		want     string
	}{
		{
			name:     "empty",
			findings: nil,
			want:     "",
		},
		{
			name: "single finding with suggestion",
			findings: []lint.Finding{
				{Severity: "error", RuleID: "embedded-bitmap", Message: "SVG contains embedded bitmap data", Suggestion: "Extract and use WebP/AVIF"},
			},
			want: "Lint findings for this asset:\n- [error/embedded-bitmap] SVG contains embedded bitmap data → Extract and use WebP/AVIF",
		},
		{
			name: "multiple findings",
			findings: []lint.Finding{
				{Severity: "warning", RuleID: "oversized", Message: "File exceeds 1MB"},
				{Severity: "info", RuleID: "missing-alt", Message: "No alt text found", Suggestion: "Add descriptive alt text"},
			},
			want: "Lint findings for this asset:\n- [warning/oversized] File exceeds 1MB\n- [info/missing-alt] No alt text found → Add descriptive alt text",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatLintFindings(tt.findings)
			if got != tt.want {
				t.Errorf("formatLintFindings() =\n  %q\nwant\n  %q", got, tt.want)
			}
		})
	}
}

func TestFormatOptimizationFindings(t *testing.T) {
	tests := []struct {
		name string
		opts []scanner.OptimizationSuggestion
		want string
	}{
		{
			name: "empty",
			opts: nil,
			want: "",
		},
		{
			name: "with savings",
			opts: []scanner.OptimizationSuggestion{
				{Severity: "warning", ReasonCode: "format/try-webp", Reason: "PNG without alpha compresses better as WebP", SavingsBytes: 184320, Suggestion: "Convert to WebP"},
			},
			want: "Rule-based optimization analysis:\n- [warning/format/try-webp] PNG without alpha compresses better as WebP (est. savings: 180 KB) → Convert to WebP",
		},
		{
			name: "no savings",
			opts: []scanner.OptimizationSuggestion{
				{Severity: "info", ReasonCode: "metadata/strip", Reason: "File contains EXIF metadata"},
			},
			want: "Rule-based optimization analysis:\n- [info/metadata/strip] File contains EXIF metadata",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatOptimizationFindings(tt.opts)
			if got != tt.want {
				t.Errorf("formatOptimizationFindings() =\n  %q\nwant\n  %q", got, tt.want)
			}
		})
	}
}

func TestReplaceDynamicVars(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		vars   map[string]string
		want   string
	}{
		{
			name:   "replaces present vars",
			prompt: "Hello {{fileMetadata}} world",
			vars:   map[string]string{"fileMetadata": "File: test.png (.png, 100 KB, 100x100, no transparency, not animated)"},
			want:   "Hello File: test.png (.png, 100 KB, 100x100, no transparency, not animated) world",
		},
		{
			name:   "removes empty var with surrounding newlines",
			prompt: "Header\n\n{{lintFindings}}\n\nFooter",
			vars:   map[string]string{"lintFindings": ""},
			want:   "Header\n\nFooter",
		},
		{
			name:   "preserves unknown placeholders",
			prompt: "{{contentTypes}} and {{unknown}}",
			vars:   map[string]string{},
			want:   "{{contentTypes}} and {{unknown}}",
		},
		{
			name:   "mixed present and empty",
			prompt: "Start\n\n{{fileMetadata}}\n\n{{lintFindings}}\n\nEnd",
			vars:   map[string]string{"fileMetadata": "File: x.png", "lintFindings": ""},
			want:   "Start\n\nFile: x.png\n\nEnd",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceDynamicVars(tt.prompt, tt.vars)
			if got != tt.want {
				t.Errorf("replaceDynamicVars() =\n  %q\nwant\n  %q", got, tt.want)
			}
		})
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		bytes int64
		want  string
	}{
		{512, "512 B"},
		{1024, "1 KB"},
		{245760, "240 KB"},
		{1048576, "1.0 MB"},
		{8073216, "7.7 MB"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := formatBytes(tt.bytes)
			if got != tt.want {
				t.Errorf("formatBytes(%d) = %q, want %q", tt.bytes, got, tt.want)
			}
		})
	}
}

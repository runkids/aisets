package optimize

import (
	"strings"
	"testing"

	"asset-studio/internal/scanner"
)

func TestComputeAggregatesOptimizableItems(t *testing.T) {
	items := []scanner.AssetItem{
		{ID: "skip", Bytes: 999},
		{
			ID:          "a",
			RepoPath:    "src/photo.png",
			ProjectName: "web",
			Bytes:       1000,
			Optimization: []scanner.OptimizationSuggestion{
				{Category: "size", Severity: "critical", SavingsBytes: 700},
				{Category: "format", Severity: "warning", SavingsBytes: 200},
			},
		},
		{
			ID:          "b",
			RepoPath:    "src/icon.svg",
			ProjectName: "web",
			Bytes:       100,
			Optimization: []scanner.OptimizationSuggestion{
				{Category: "size", Severity: "info", SavingsBytes: 50},
			},
		},
	}

	got := Compute(items)
	if got.ItemCount != 2 || got.TotalBytes != 1100 || got.SavingsBytes != 950 {
		t.Fatalf("aggregate = %#v", got)
	}
	if got.BySeverity["critical"] != 1 || got.BySeverity["warning"] != 1 || got.BySeverity["info"] != 1 {
		t.Fatalf("severity counts = %#v", got.BySeverity)
	}
	if len(got.Items) != 2 || got.Items[0].AssetID != "a" || got.Items[0].SavingsBytes != 900 {
		t.Fatalf("items = %#v", got.Items)
	}
	if len(got.ByCategory) != 2 || got.ByCategory[0].Category != "size" || got.ByCategory[0].SavingsBytes != 750 || got.ByCategory[1].Category != "format" {
		t.Fatalf("categories = %#v", got.ByCategory)
	}
}

func TestComputeSortsCategoryTiesByCount(t *testing.T) {
	items := []scanner.AssetItem{{
		ID:    "a",
		Bytes: 10,
		Optimization: []scanner.OptimizationSuggestion{
			{Category: "one", Severity: "info", SavingsBytes: 50},
			{Category: "many", Severity: "info", SavingsBytes: 25},
			{Category: "many", Severity: "info", SavingsBytes: 25},
		},
	}}

	got := Compute(items)
	if got.ByCategory[0].Category != "many" || got.ByCategory[0].Count != 2 {
		t.Fatalf("category tie order = %#v", got.ByCategory)
	}
}

func TestGenerateScriptBuildsCommandsForRecommendations(t *testing.T) {
	items := []scanner.AssetItem{
		{
			RepoPath:    "assets/icon.svg",
			LocalPath:   `assets/icon "quoted".svg`,
			ProjectName: "web",
			Optimization: []scanner.OptimizationSuggestion{
				{Severity: "warning", Category: "svg-minify", Reason: "verbose", Suggestion: "minify", SuggestionCode: "preview_svg_minify"},
				{Severity: "info", Category: "manual", Reason: "needs review", Suggestion: "review", SuggestionCode: "manual_review"},
			},
		},
		{
			RepoPath:    "assets/photo.png",
			ProjectName: "web",
			Optimization: []scanner.OptimizationSuggestion{
				{Severity: "warning", Category: "format", Reason: "modern", Suggestion: "webp", SuggestionCode: "try_modern_photographic_format"},
				{Severity: "critical", Category: "dimensions", Reason: "large", Suggestion: "resize", SuggestionCode: "use_responsive_or_smaller_source"},
			},
		},
	}

	script := GenerateScript(items)
	for _, want := range []string{
		"#!/usr/bin/env bash",
		`svgo --input "assets/icon \"quoted\".svg" --output "assets/icon \"quoted\".svg"`,
		`#   (no automated command for manual_review; review "assets/icon \"quoted\".svg" manually)`,
		`cwebp -q 85 "assets/photo.png" -o "assets/photo.webp"`,
		`magick "assets/photo.png" -resize 1200x "assets/photo@1200.png"`,
		`echo "asset-studio: optimization script complete."`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q:\n%s", want, script)
		}
	}
}

func TestGenerateScriptHandlesEmptySelection(t *testing.T) {
	script := GenerateScript([]scanner.AssetItem{{RepoPath: "assets/a.png"}})
	if !strings.Contains(script, "# No optimizable items in selection.") {
		t.Fatalf("empty script = %s", script)
	}
}

func TestCommandForCompressionVariants(t *testing.T) {
	tests := []struct {
		name string
		code string
		ext  string
		path string
		want string
	}{
		{"png compression", "review_compression_or_modern_format", ".png", "a.png", `pngquant --quality=80-95 --skip-if-larger --force --output "a.png" "a.png"`},
		{"jpeg compression", "review_compression_or_modern_format", ".jpeg", "a.jpeg", `jpegoptim --max=85 --strip-all "a.jpeg"`},
		{"webp recompress", "review_compression_or_modern_format", ".webp", "a.webp", `cwebp -q 80 "a.webp" -o "a.min.webp"`},
		{"gif compression", "review_compression_or_modern_format", ".gif", "a.gif", `gifsicle --optimize=3 --output "a.gif" "a.gif"`},
		{"unsupported modern format", "try_modern_photographic_format", ".svg", "a.svg", ""},
		{"unknown code", "unknown", ".png", "a.png", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := commandFor(tt.code, tt.ext, tt.path); got != tt.want {
				t.Fatalf("commandFor() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestReplaceExtAndShellQuote(t *testing.T) {
	if got := replaceExt("asset", ".webp"); got != "asset.webp" {
		t.Fatalf("replaceExt without extension = %q", got)
	}
	if got := shellQuote(""); got != `""` {
		t.Fatalf("shellQuote empty = %q", got)
	}
}

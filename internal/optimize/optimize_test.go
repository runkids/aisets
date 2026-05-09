package optimize

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aisets/internal/actions"
	"aisets/internal/imageproc"
	"aisets/internal/scanner"
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
			Ext:         ".png",
			Image: imageproc.Metadata{
				Format: "png",
				Width:  2400,
				Height: 1600,
			},
			Optimization: []scanner.OptimizationSuggestion{
				{Severity: "warning", Category: "format", Reason: "modern", Suggestion: "webp", SuggestionCode: "try_modern_photographic_format"},
				{Severity: "critical", Category: "dimensions", Reason: "large", Suggestion: "resize", SuggestionCode: "use_responsive_or_smaller_source"},
			},
		},
	}

	script := GenerateScript(items, Request{})
	for _, want := range []string{
		"#!/usr/bin/env bash",
		`svgo --input "assets/icon \"quoted\".svg" --output "assets/icon \"quoted\".svg"`,
		`# [info/manual] needs review → review`,
		`aisets-imgtools convert --format avif --quality 50 --speed 6 --resize 1200 "assets/photo.png" "assets/photo.avif"`,
		`echo "aisets: optimization script complete."`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q:\n%s", want, script)
		}
	}
}

func TestGenerateScriptHandlesEmptySelection(t *testing.T) {
	script := GenerateScript([]scanner.AssetItem{{RepoPath: "assets/a.png"}}, Request{})
	if !strings.Contains(script, "# No optimizable items in selection.") {
		t.Fatalf("empty script = %s", script)
	}
}

func TestCommandForCompressionVariants(t *testing.T) {
	tests := []struct {
		name string
		op   Operation
		path string
		want string
	}{
		{"png conversion", Operation{Operation: "convert-avif", OutputFormat: "avif", RepoPath: "a.png", TargetPath: "a.avif"}, "a.png", `aisets-imgtools convert --format avif --quality 50 --speed 6 "a.png" "a.avif"`},
		{"jpeg conversion", Operation{Operation: "convert-avif", OutputFormat: "avif", RepoPath: "a.jpeg", TargetPath: "a.avif"}, "a.jpeg", `aisets-imgtools convert --format avif --quality 50 --speed 6 "a.jpeg" "a.avif"`},
		{"webp recompress via size", Operation{Operation: "webp-recompress", OutputFormat: "webp", RepoPath: "a.webp", TargetPath: "a.webp"}, "a.webp", `aisets-imgtools convert --format webp --quality 60 "a.webp" "a.webp"`},
		{"gif optimize", Operation{Operation: "gif-optimize", OutputFormat: "gif", RepoPath: "a.gif", TargetPath: "a.gif"}, "a.gif", `aisets-imgtools convert --format gif --quality 75 "a.gif" "a.gif"`},
		{"convert with resize", Operation{Operation: "convert-webp", OutputFormat: "webp", RepoPath: "a.png", TargetPath: "a.webp", ResizeMaxDimensionPx: 1800}, "a.png", `aisets-imgtools convert --format webp --quality 80 --resize 1800 "a.png" "a.webp"`},
		{"unsupported operation", Operation{Operation: "manual-review", OutputFormat: "svg", RepoPath: "a.svg", TargetPath: "a.svg"}, "a.svg", ""},
		{"unknown operation", Operation{Operation: "unknown", OutputFormat: "png", RepoPath: "a.png", TargetPath: "a.png"}, "a.png", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := commandForOperation(tt.op, tt.path, Request{}); got != tt.want {
				t.Fatalf("commandForOperation() = %q, want %q", got, tt.want)
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

func TestPlanUsesProjectTypeOnlyForReferencePolicy(t *testing.T) {
	items := []scanner.AssetItem{
		{
			ID:         "code",
			RepoPath:   "src/photo.png",
			Ext:        ".png",
			Bytes:      1000,
			ScanIntent: scanner.ProjectScanIntentCode,
			Image:      imageMeta(false),
			References: []scanner.AssetReference{{File: "src/app.tsx", Specifier: "./photo.png"}},
			Optimization: []scanner.OptimizationSuggestion{{
				Category:       "format",
				Severity:       "info",
				SuggestionCode: "try_modern_photographic_format",
			}},
		},
		{
			ID:         "pack",
			RepoPath:   "icons/photo.png",
			Ext:        ".png",
			Bytes:      1000,
			ScanIntent: scanner.ProjectScanIntentAssetPack,
			Image:      imageMeta(false),
			Optimization: []scanner.OptimizationSuggestion{{
				Category:       "format",
				Severity:       "info",
				SuggestionCode: "try_modern_photographic_format",
			}},
		},
	}
	ops := planWithTools(items, Request{}, func(string) bool { return true })
	if len(ops) != 2 || ops[0].Operation != "convert-avif" || ops[1].Operation != "convert-avif" {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0].ReferencePolicy != "canUpdateReferences" || ops[1].ReferencePolicy != "manualReview" {
		t.Fatalf("reference policies = %#v %#v", ops[0].ReferencePolicy, ops[1].ReferencePolicy)
	}
}

func TestPlanUsesBuiltInOperationsForCommonFormats(t *testing.T) {
	items := []scanner.AssetItem{
		{
			ID:         "webp",
			RepoPath:   "src/photo.webp",
			Ext:        ".webp",
			Bytes:      1000,
			ScanIntent: scanner.ProjectScanIntentCode,
			Image:      imageMeta(false),
			Optimization: []scanner.OptimizationSuggestion{{
				Category:       "format",
				Severity:       "info",
				SuggestionCode: "review_compression_or_modern_format",
			}},
		},
		{
			ID:         "gif",
			RepoPath:   "src/anim.gif",
			Ext:        ".gif",
			Bytes:      1000,
			ScanIntent: scanner.ProjectScanIntentCode,
			Image:      imageMeta(false),
			Optimization: []scanner.OptimizationSuggestion{{
				Category:       "animation",
				Severity:       "info",
				SuggestionCode: "review_compression_or_modern_format",
			}},
		},
	}
	ops := planWithTools(items, Request{}, func(string) bool { return false })
	if len(ops) != 2 {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0].Operation != "webp-recompress" || ops[0].Tool != "aisets-imgtools" {
		t.Fatalf("webp op = %#v", ops[0])
	}
	if ops[1].Operation != "convert-webp" || ops[1].Tool != "aisets-imgtools" {
		t.Fatalf("gif op = %#v", ops[1])
	}
	for i, name := range []string{"webp-recompress", "convert-webp"} {
		if ops[i].CanApply || ops[i].Available {
			t.Fatalf("%s should be blocked when imgtools unavailable", name)
		}
	}

	opsAvail := planWithTools(items, Request{}, func(string) bool { return true })
	for i, name := range []string{"webp-recompress", "convert-webp"} {
		if !opsAvail[i].CanApply || !opsAvail[i].Available {
			t.Fatalf("%s should be available when imgtools present", name)
		}
	}
}

func TestPlanRoutesFormatsByRules(t *testing.T) {
	tests := []struct {
		name   string
		code   string
		ext    string
		wantOp string
	}{
		{"png no alpha → avif", "try_modern_photographic_format", ".png", "convert-avif"},
		{"png alpha → webp", "try_alpha_preserving_format", ".png", "convert-webp"},
		{"jpeg large → avif", "review_compression_or_modern_format", ".jpeg", "convert-avif"},
		{"webp large → recompress", "review_compression_or_modern_format", ".webp", "webp-recompress"},
		{"gif large → webp", "review_compression_or_modern_format", ".gif", "convert-webp"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items := []scanner.AssetItem{{
				ID: "a", RepoPath: "src/img" + tt.ext, Ext: tt.ext, Bytes: 1000,
				ScanIntent: scanner.ProjectScanIntentCode,
				Image:      imageMeta(false),
				Optimization: []scanner.OptimizationSuggestion{{
					Category: "format", Severity: "info", SuggestionCode: tt.code,
				}},
			}}
			ops := planWithTools(items, Request{}, func(string) bool { return true })
			if len(ops) != 1 || ops[0].Operation != tt.wantOp {
				t.Fatalf("got %q, want %q", ops[0].Operation, tt.wantOp)
			}
		})
	}
}

func TestPlanDoesNotAutoMinifyLargeSVGReview(t *testing.T) {
	items := []scanner.AssetItem{{
		ID:         "a",
		RepoPath:   "src/tutorial.svg",
		Ext:        ".svg",
		Bytes:      7 * 1024 * 1024,
		ScanIntent: scanner.ProjectScanIntentCode,
		Image:      imageproc.Metadata{Format: "svg", Width: 360, Height: 614, Alpha: true},
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "critical",
			ReasonCode:     "svg_large_low_minify_savings",
			SuggestionCode: "review_complex_svg_or_raster_format",
		}},
	}}

	ops := planWithTools(items, Request{Strategies: imageproc.DefaultOptimizationStrategies()}, func(string) bool { return true })
	if len(ops) != 1 {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0].Operation != "manual-review" || ops[0].CanApply {
		t.Fatalf("large SVG review should not auto-minify: %#v", ops[0])
	}
}

func TestPlanUsesSettingsStrategiesAndChainsResize(t *testing.T) {
	items := []scanner.AssetItem{{
		ID:         "a",
		RepoPath:   "src/photo.png",
		Ext:        ".png",
		Bytes:      3 * 1024 * 1024,
		ScanIntent: scanner.ProjectScanIntentCode,
		Image: imageproc.Metadata{
			Format: "png",
			Width:  4000,
			Height: 2000,
			Alpha:  false,
		},
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "info",
			SuggestionCode: "review_compression_or_modern_format",
		}},
	}}

	ops := planWithTools(items, Request{MaxDimensionPx: 1800, Strategies: imageproc.DefaultOptimizationStrategies()}, func(string) bool { return true })
	if len(ops) != 1 {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0].Operation != "convert-avif" || ops[0].ResizeMaxDimensionPx != 1800 || ops[0].Quality != 50 || ops[0].AvifSpeed != 6 {
		t.Fatalf("strategy op = %#v", ops[0])
	}
}

func TestDisabledStrategyFallsBackToSuggestionRule(t *testing.T) {
	strategies := imageproc.DefaultOptimizationStrategies()
	for index := range strategies {
		strategies[index].Enabled = false
	}
	items := []scanner.AssetItem{{
		ID:         "a",
		RepoPath:   "src/photo.png",
		Ext:        ".png",
		Bytes:      1000,
		ScanIntent: scanner.ProjectScanIntentCode,
		Image:      imageMeta(false),
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "info",
			SuggestionCode: "try_alpha_preserving_format",
		}},
	}}

	ops := planWithTools(items, Request{Strategies: strategies}, func(string) bool { return true })
	if len(ops) != 1 || ops[0].Operation != "convert-webp" || ops[0].Quality != 0 {
		t.Fatalf("fallback op = %#v", ops)
	}
}

func TestFormatQualityDefaults(t *testing.T) {
	tests := []struct {
		operation string
		want      int
	}{
		{"convert-avif", 50},
		{"convert-webp", 80},
		{"webp-recompress", 60},
		{"gif-optimize", 75},
	}
	for _, tt := range tests {
		t.Run(tt.operation, func(t *testing.T) {
			got := formatQuality(Operation{Operation: tt.operation}, 0)
			if got != tt.want {
				t.Fatalf("formatQuality(%s, 0) = %d, want %d", tt.operation, got, tt.want)
			}
		})
	}
	if got := formatQuality(Operation{Operation: "convert-avif"}, 70); got != 70 {
		t.Fatalf("user override: got %d, want 70", got)
	}
}

func TestPreviewAndApplySVGMinify(t *testing.T) {
	root := t.TempDir()
	svgPath := filepath.Join(root, "src", "icon.svg")
	if err := os.MkdirAll(filepath.Dir(svgPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(svgPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
  <g>
    <rect x="0" y="0" width="20" height="20" fill="#ff0000"></rect>
  </g>
</svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	project := scanner.Project{ID: "p", Name: "web", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	item := scanner.AssetItem{
		ID:          "a",
		ProjectID:   "p",
		ProjectName: "web",
		RepoPath:    "src/icon.svg",
		LocalPath:   svgPath,
		Ext:         ".svg",
		Bytes:       fileSize(t, svgPath),
		ScanIntent:  scanner.ProjectScanIntentCode,
		Image:       imageMeta(false),
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "svg-minify",
			Severity:       "warning",
			SuggestionCode: "preview_svg_minify",
			SavingsBytes:   1,
		}},
	}
	blocked := scanner.AssetItem{
		ID:          "blocked",
		ProjectID:   "p",
		ProjectName: "web",
		RepoPath:    "src/raw.bin",
		Ext:         ".bin",
		Bytes:       1024,
		ScanIntent:  scanner.ProjectScanIntentCode,
		Image:       imageMeta(false),
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "warning",
			SuggestionCode: "unsupported_test_operation",
		}},
	}
	preview, err := Preview(project, []scanner.AssetItem{item, blocked}, Request{OutputMode: OutputModeReplace})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.CanApply || preview.Type != "optimization" {
		t.Fatalf("preview = %#v", preview)
	}
	if len(preview.Blockers) != 1 || preview.Blockers[0].File != blocked.RepoPath {
		t.Fatalf("blockers = %#v", preview.Blockers)
	}
	result, err := Apply(project, preview)
	if err != nil {
		t.Fatal(err)
	}
	if result.MovedFiles != 1 {
		t.Fatalf("result = %#v", result)
	}
	if got := fileSize(t, svgPath); got >= item.Bytes {
		t.Fatalf("expected minified SVG to be smaller, before=%d after=%d", item.Bytes, got)
	}
	if _, err := os.Stat(svgPath); err != nil {
		t.Fatal(err)
	}
}

func TestReplacementEffectsUpdatesReferencesAndDeletesOriginal(t *testing.T) {
	root := t.TempDir()
	imagePath := filepath.Join(root, "src", "photo.png")
	if err := os.MkdirAll(filepath.Dir(imagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(root, "src", "app.tsx")
	if err := os.WriteFile(sourcePath, []byte(`import photo from "./photo.png";`), 0o644); err != nil {
		t.Fatal(err)
	}
	project := scanner.Project{ID: "p", Name: "web", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	item := scanner.AssetItem{
		ID:          "a",
		ProjectID:   "p",
		ProjectName: "web",
		RepoPath:    "src/photo.png",
		LocalPath:   imagePath,
		Ext:         ".png",
		Bytes:       fileSize(t, imagePath),
		ScanIntent:  scanner.ProjectScanIntentCode,
		Image:       imageMeta(false),
		References: []scanner.AssetReference{{
			File:      "src/app.tsx",
			Line:      1,
			Specifier: "./photo.png",
		}},
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "warning",
			SuggestionCode: "try_modern_photographic_format",
			SavingsBytes:   1,
		}},
	}
	ops := []Operation{{
		AssetID:        "a",
		RepoPath:       "src/photo.png",
		TargetPath:     "src/photo.avif",
		CurrentBytes:   item.Bytes,
		EstimatedBytes: 1,
		SavingsBytes:   item.Bytes - 1,
		CanApply:       true,
	}}
	changes, deletes, blockers := replacementEffects(project, []scanner.AssetItem{item}, ops, Request{
		OutputMode:       OutputModeReplace,
		UpdateReferences: true,
	})
	if len(blockers) != 0 || len(changes) != 1 || len(deletes) != 1 {
		t.Fatalf("changes=%#v deletes=%#v blockers=%#v", changes, deletes, blockers)
	}
	if changes[0].NewSpecifier != "./photo.avif" || deletes[0] != "src/photo.png" || ops[0].ReferenceEditCount != 1 {
		t.Fatalf("changes/deletes/op = %#v %#v %#v", changes, deletes, ops[0])
	}
}

func TestApplyOptimizationPreviewUpdatesReferencesAndDeletesOriginal(t *testing.T) {
	root := t.TempDir()
	imagePath := filepath.Join(root, "src", "photo.png")
	if err := os.MkdirAll(filepath.Dir(imagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	candidatePath := filepath.Join(root, "candidate.avif")
	if err := os.WriteFile(candidatePath, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(root, "src", "app.tsx")
	if err := os.WriteFile(sourcePath, []byte(`import photo from "./photo.png";`), 0o644); err != nil {
		t.Fatal(err)
	}
	project := scanner.Project{ID: "p", Name: "web", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	preview := actions.Preview{
		ID:        "optimization-test",
		Type:      "optimization",
		ProjectID: "p",
		Changes: []actions.Change{{
			File:         "src/app.tsx",
			Line:         1,
			OldSpecifier: "./photo.png",
			NewSpecifier: "./photo.avif",
		}},
		Deletes:  []string{"src/photo.png"},
		CanApply: true,
		Payload: map[string]any{"optimization": PreviewResult{Operations: []Operation{{
			AssetID:       "a",
			RepoPath:      "src/photo.png",
			TargetPath:    "src/photo.avif",
			CandidatePath: candidatePath,
			CanApply:      true,
		}}}},
	}
	result, err := Apply(project, preview)
	if err != nil {
		t.Fatal(err)
	}
	if result.MovedFiles != 1 || result.ChangedReferences != 1 || result.DeletedFiles != 1 {
		t.Fatalf("result = %#v", result)
	}
	if _, err := os.Stat(imagePath); !os.IsNotExist(err) {
		t.Fatalf("expected original removed, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "src", "photo.avif")); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(bytes), `import photo from "./photo.avif";`) {
		t.Fatalf("source was not updated: %s", string(bytes))
	}
}

func TestReplacementEffectsBlocksReferencedConversionWithoutUpdate(t *testing.T) {
	root := t.TempDir()
	imagePath := filepath.Join(root, "src", "photo.png")
	if err := os.MkdirAll(filepath.Dir(imagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(root, "src", "app.tsx")
	if err := os.WriteFile(sourcePath, []byte(`import photo from "./photo.png";`), 0o644); err != nil {
		t.Fatal(err)
	}
	project := scanner.Project{ID: "p", Name: "web", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	item := scanner.AssetItem{
		ID:          "a",
		ProjectID:   "p",
		ProjectName: "web",
		RepoPath:    "src/photo.png",
		LocalPath:   imagePath,
		Ext:         ".png",
		Bytes:       fileSize(t, imagePath),
		ScanIntent:  scanner.ProjectScanIntentCode,
		Image:       imageMeta(false),
		References: []scanner.AssetReference{{
			File:      "src/app.tsx",
			Line:      1,
			Specifier: "./photo.png",
		}},
		Optimization: []scanner.OptimizationSuggestion{{
			Category:       "format",
			Severity:       "warning",
			SuggestionCode: "try_modern_photographic_format",
			SavingsBytes:   1,
		}},
	}
	ops := []Operation{{
		AssetID:        "a",
		RepoPath:       "src/photo.png",
		TargetPath:     "src/photo.avif",
		CurrentBytes:   item.Bytes,
		EstimatedBytes: 1,
		SavingsBytes:   item.Bytes - 1,
		CanApply:       true,
	}}
	changes, deletes, blockers := replacementEffects(project, []scanner.AssetItem{item}, ops, Request{OutputMode: OutputModeReplace})
	if len(changes) != 0 || len(deletes) != 0 || len(blockers) != 1 {
		t.Fatalf("changes=%#v deletes=%#v blockers=%#v", changes, deletes, blockers)
	}
	if ops[0].CanApply || ops[0].ReasonCode != "replace_requires_reference_update" {
		t.Fatalf("op = %#v", ops[0])
	}
}

func writeTestGIF(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewPaletted(image.Rect(0, 0, 4, 4), color.Palette{color.Black, color.White})
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{
		Image: []*image.Paletted{img},
		Delay: []int{10},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestMeasureOperationsGIFSuggestsWebPWhenCwebpMissing(t *testing.T) {
	root := t.TempDir()
	gifPath := filepath.Join(root, "src", "anim.gif")
	writeTestGIF(t, gifPath)

	project := scanner.Project{ID: "p", Name: "test", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	ops := []Operation{{
		AssetID:      "a",
		RepoPath:     "src/anim.gif",
		Operation:    "gif-optimize",
		OutputFormat: "gif",
		TargetPath:   "src/anim.gif",
		CurrentBytes: fileSize(t, gifPath),
		CanApply:     true,
		Available:    true,
	}}

	result, blockers := measureOperations(project, ops, Request{Quality: 80}, false, func(string) bool { return false })

	if result[0].Operation != "convert-webp" {
		t.Fatalf("expected convert-webp suggestion, got %s", result[0].Operation)
	}
	if result[0].OutputFormat != "webp" {
		t.Fatalf("expected webp output format, got %s", result[0].OutputFormat)
	}
	if result[0].Tool != "aisets-imgtools" {
		t.Fatalf("expected aisets-imgtools tool, got %s", result[0].Tool)
	}
	if result[0].Available {
		t.Fatal("expected tool to be marked unavailable")
	}
	if result[0].CanApply {
		t.Fatal("expected operation to be blocked")
	}
	if result[0].ReasonCode != "optimizer_tool_missing" {
		t.Fatalf("expected optimizer_tool_missing, got %s", result[0].ReasonCode)
	}
	if len(blockers) != 1 {
		t.Fatalf("expected 1 blocker, got %d", len(blockers))
	}
}

func TestMeasureOperationsGIFFallbackToWebP(t *testing.T) {
	if !defaultToolChecker("aisets-imgtools") {
		t.Skip("aisets-imgtools not installed, skipping WebP fallback test")
	}
	root := t.TempDir()
	gifPath := filepath.Join(root, "src", "anim.gif")
	writeTestGIF(t, gifPath)

	project := scanner.Project{ID: "p", Name: "test", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	ops := []Operation{{
		AssetID:      "a",
		RepoPath:     "src/anim.gif",
		Operation:    "gif-optimize",
		OutputFormat: "gif",
		TargetPath:   "src/anim.gif",
		CurrentBytes: fileSize(t, gifPath),
		CanApply:     true,
		Available:    true,
	}}

	result, blockers := measureOperations(project, ops, Request{Quality: 80}, false, defaultToolChecker)

	if result[0].Operation != "convert-webp" {
		t.Fatalf("expected fallback to convert-webp, got %s", result[0].Operation)
	}
	if !result[0].CanApply {
		t.Fatal("expected fallback operation to be applicable")
	}
	if result[0].OutputFormat != "webp" {
		t.Fatalf("expected webp output, got %s", result[0].OutputFormat)
	}
	if result[0].SavingsBytes <= 0 {
		t.Fatalf("expected positive savings, got %d", result[0].SavingsBytes)
	}
	if len(blockers) != 0 {
		t.Fatalf("expected 0 blockers, got %d", len(blockers))
	}
}

func writeTestPNG(t *testing.T, path string, w, h int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestImgtoolsConvertFormats(t *testing.T) {
	if !defaultToolChecker("aisets-imgtools") {
		t.Skip("aisets-imgtools not installed")
	}
	root := t.TempDir()
	pngPath := filepath.Join(root, "src", "photo.png")
	writeTestPNG(t, pngPath, 64, 64)
	project := scanner.Project{ID: "p", Name: "test", Path: root}

	tests := []struct {
		name      string
		operation string
		format    string
	}{
		{"PNG→AVIF", "convert-avif", "avif"},
		{"PNG→WebP", "convert-webp", "webp"},
		{"PNG recompress", "png-recompress", "png"},
		{"PNG→JPEG", "jpeg-recompress", "jpg"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			op := Operation{
				AssetID:      "a",
				RepoPath:     "src/photo.png",
				Operation:    tc.operation,
				OutputFormat: tc.format,
				TargetPath:   "src/photo." + tc.format,
				CurrentBytes: fileSize(t, pngPath),
				CanApply:     true,
				Available:    true,
			}
			candidate, estBytes, err := buildCandidate(project, op, Request{Quality: 80, MaxDimensionPx: 1200})
			if err != nil {
				t.Fatalf("buildCandidate failed: %v", err)
			}
			defer os.Remove(candidate)
			if estBytes <= 0 {
				t.Fatalf("expected positive output size, got %d", estBytes)
			}
			if candidate == "" {
				t.Fatal("expected candidate path")
			}
		})
	}
}

func TestImgtoolsResize(t *testing.T) {
	if !defaultToolChecker("aisets-imgtools") {
		t.Skip("aisets-imgtools not installed")
	}
	root := t.TempDir()
	pngPath := filepath.Join(root, "src", "large.png")
	writeTestPNG(t, pngPath, 2000, 1500)
	project := scanner.Project{ID: "p", Name: "test", Path: root}

	op := Operation{
		AssetID:      "a",
		RepoPath:     "src/large.png",
		Operation:    "resize-variant",
		OutputFormat: "png",
		TargetPath:   "src/large-thumb.png",
		CurrentBytes: fileSize(t, pngPath),
		CanApply:     true,
		Available:    true,
	}
	candidate, estBytes, err := buildCandidate(project, op, Request{Quality: 80, MaxDimensionPx: 800})
	if err != nil {
		t.Fatalf("buildCandidate failed: %v", err)
	}
	defer os.Remove(candidate)
	if estBytes >= op.CurrentBytes {
		t.Fatalf("expected resized output smaller than original, got %d >= %d", estBytes, op.CurrentBytes)
	}
}

func imageMeta(alpha bool) imageproc.Metadata {
	return imageproc.Metadata{Format: "png", Width: 10, Height: 10, Alpha: alpha}
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Size()
}

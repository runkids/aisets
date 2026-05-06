package precheck

import (
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"asset-studio/internal/imageproc"
	"asset-studio/internal/scanner"
)

func TestAnalyzeReportsExactMatchNamingIssuesAndDuplicateVerdict(t *testing.T) {
	root := t.TempDir()
	upload := filepath.Join(root, "upload.png")
	writePNG(t, upload, color.NRGBA{R: 200, G: 20, B: 40, A: 255})
	hash, err := hashFile(context.Background(), upload)
	if err != nil {
		t.Fatal(err)
	}
	catalog := scanner.Catalog{Items: []scanner.AssetItem{{
		ID:          "asset-1",
		RepoPath:    "assets/upload.png",
		ProjectName: "web",
		ContentHash: hash,
	}}}

	got, err := Analyze(context.Background(), "Icon Bad!.PNG", upload, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Icon Bad!.PNG" || got.Ext != ".png" || got.HashAlgorithm != HashAlgorithm || got.ContentHash != hash {
		t.Fatalf("metadata = %#v", got)
	}
	if len(got.ExactMatches) != 1 || got.ExactMatches[0].AssetID != "asset-1" {
		t.Fatalf("exact matches = %#v", got.ExactMatches)
	}
	if got.Verdict != VerdictDuplicate {
		t.Fatalf("verdict = %s (%s)", got.Verdict, got.VerdictReason)
	}
	if !hasNamingIssue(got.NamingIssues, "contains_spaces") || !hasNamingIssue(got.NamingIssues, "uppercase_letters") || !hasNamingIssue(got.NamingIssues, "special_chars") {
		t.Fatalf("naming issues = %#v", got.NamingIssues)
	}
	if got.Image.Format != "png" || got.DHash == "" || got.DHashFlipped == "" {
		t.Fatalf("image/hash metadata = %#v", got)
	}
}

func TestAnalyzeReportsNearMatchesIncludingFlippedHashes(t *testing.T) {
	root := t.TempDir()
	upload := filepath.Join(root, "upload.png")
	writeAsymmetricPNG(t, upload)
	hashes, err := imageproc.DHash(upload)
	if err != nil {
		t.Fatal(err)
	}
	catalog := scanner.Catalog{Items: []scanner.AssetItem{
		{ID: "near", RepoPath: "assets/near.png", ProjectName: "web", ContentHash: "different", DHash: hashes.DHash},
		{ID: "flipped", RepoPath: "assets/flipped.png", ProjectName: "web", ContentHash: "also-different", DHash: hashes.DHashFlipped},
	}}

	got, err := Analyze(context.Background(), "clean-name.png", upload, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if got.Verdict != VerdictWarning {
		t.Fatalf("verdict = %s (%s)", got.Verdict, got.VerdictReason)
	}
	if len(got.NearMatches) != 2 {
		t.Fatalf("near matches = %#v", got.NearMatches)
	}
	if got.NearMatches[0].AssetID != "near" || got.NearMatches[0].Distance != 0 || got.NearMatches[0].Flipped {
		t.Fatalf("first near match = %#v", got.NearMatches[0])
	}
	if got.NearMatches[1].AssetID != "flipped" || got.NearMatches[1].Distance != 0 || !got.NearMatches[1].Flipped {
		t.Fatalf("flipped near match = %#v", got.NearMatches[1])
	}
}

func TestAnalyzeReturnsFileErrors(t *testing.T) {
	_, err := Analyze(context.Background(), "missing.png", filepath.Join(t.TempDir(), "missing.png"), scanner.Catalog{})
	if err == nil {
		t.Fatal("expected missing file error")
	}
}

func TestHashFileHonorsContextCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset.bin")
	if err := os.WriteFile(path, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := hashFile(ctx, path)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("hashFile canceled error = %v", err)
	}
}

func TestFindMatchesAndNamingHelpers(t *testing.T) {
	catalog := scanner.Catalog{Items: []scanner.AssetItem{
		{ID: "exact", RepoPath: "a.png", ProjectName: "web", ContentHash: "hash"},
		{ID: "invalid", RepoPath: "b.png", ProjectName: "web", ContentHash: "other", DHash: "not-hex"},
	}}
	if got := findExactMatches("", catalog); len(got) != 0 {
		t.Fatalf("empty exact matches = %#v", got)
	}
	if got := findExactMatches("hash", catalog); len(got) != 1 || got[0].AssetID != "exact" {
		t.Fatalf("exact matches = %#v", got)
	}
	if got := findNearMatches("", "", "", catalog); len(got) != 0 {
		t.Fatalf("empty near matches = %#v", got)
	}
	if got := findNearMatches("also-not-hex", "", "", catalog); len(got) != 0 {
		t.Fatalf("invalid near matches = %#v", got)
	}

	issues := checkNaming("-.Bad Name!.png")
	for _, code := range []string{"contains_spaces", "uppercase_letters", "special_chars", "leading_punctuation"} {
		if !hasNamingIssue(issues, code) {
			t.Fatalf("missing naming issue %s in %#v", code, issues)
		}
	}
	if clean := checkNaming("clean-name.png"); len(clean) != 0 {
		t.Fatalf("clean name issues = %#v", clean)
	}
}

func TestDecideVerdictPriority(t *testing.T) {
	tests := []struct {
		name string
		res  Result
		want Verdict
	}{
		{"exact", Result{ExactMatches: []ExactMatch{{AssetID: "a"}}}, VerdictDuplicate},
		{"near", Result{NearMatches: []NearMatch{{AssetID: "a"}}}, VerdictWarning},
		{"critical optimization", Result{Optimization: []scanner.OptimizationSuggestion{{Severity: "critical"}}}, VerdictWarning},
		{"naming", Result{NamingIssues: []NamingIssue{{Code: "uppercase_letters"}}}, VerdictWarning},
		{"ok", Result{}, VerdictOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := decideVerdict(tt.res)
			if got != tt.want || reason == "" {
				t.Fatalf("decideVerdict() = %s, %q; want %s", got, reason, tt.want)
			}
		})
	}
}

func hasNamingIssue(issues []NamingIssue, code string) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func writePNG(t *testing.T, path string, c color.NRGBA) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, c)
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeAsymmetricPNG(t *testing.T, path string) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			c := color.NRGBA{R: 240, G: 240, B: 240, A: 255}
			if x < 4 || (x > 10 && y > 4 && y < 12) {
				c = color.NRGBA{R: 20, G: 20, B: 20, A: 255}
			}
			img.Set(x, y, c)
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

package scanner

import (
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestNewReturnsUsableScanner(t *testing.T) {
	if New() == nil {
		t.Fatal("New() returned nil")
	}
}

func TestScanCatalogDuplicatesAndUnused(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "icon-a.png"), solidImage(4, 4, color.NRGBA{R: 255, A: 255}))
	bytes, err := os.ReadFile(filepath.Join(root, "src", "icon-a.png"))
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, filepath.Join(root, "src", "icon-b.png"), bytes)
	mustWrite(t, filepath.Join(root, "src", "unused.svg"), "<svg/>")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import icon from "./icon-a.png"`)

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.TotalFiles != 3 {
		t.Fatalf("total files = %d, want 3", catalog.Stats.TotalFiles)
	}
	if catalog.Stats.DuplicateGroups != 1 {
		t.Fatalf("duplicate groups = %d, want 1", catalog.Stats.DuplicateGroups)
	}
	if catalog.Stats.UnusedFiles != 2 {
		t.Fatalf("unused files = %d, want 2", catalog.Stats.UnusedFiles)
	}
	var used AssetItem
	for _, item := range catalog.Items {
		if item.RepoPath == "src/icon-a.png" {
			used = item
		}
	}
	if len(used.UsedBy) != 1 || used.UsedBy[0] != "src/App.tsx" {
		t.Fatalf("usedBy = %#v, want src/App.tsx", used.UsedBy)
	}
	if used.ContentHash == "" || used.HashAlgorithm != "blake3" {
		t.Fatalf("content hash = %q algorithm = %q", used.ContentHash, used.HashAlgorithm)
	}
	if used.Image.Format != "png" || used.Image.Width != 4 {
		t.Fatalf("image metadata = %#v", used.Image)
	}
}

func TestScanMarksVitePublicAbsoluteReferencesUsed(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "ui", "public", "favicon.png"), solidImage(2, 2, color.White))
	writePNG(t, filepath.Join(root, "ui", "public", "brand", "app-icon.png"), solidImage(2, 2, color.Black))
	mustWrite(t, filepath.Join(root, "ui", "index.html"), `<link rel="icon" href="/favicon.png" />`)
	mustWrite(t, filepath.Join(root, "ui", "src", "AppTopbar.tsx"), `<img src="/brand/app-icon.png" />`)

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.UnusedFiles != 0 {
		t.Fatalf("unused files = %d, want 0; items = %#v", catalog.Stats.UnusedFiles, catalog.Items)
	}
	for _, item := range catalog.Items {
		if len(item.UsedBy) == 0 {
			t.Fatalf("%s usedBy = %#v, want public absolute reference", item.RepoPath, item.UsedBy)
		}
	}
}

func TestScanCatalogJSONUsesEmptyArrays(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "unused.png"), solidImage(2, 2, color.NRGBA{A: 128}))

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Items []struct {
			UsedBy       []string                 `json:"usedBy"`
			References   []AssetReference         `json:"references"`
			Duplicates   []string                 `json:"duplicates"`
			Similar      []string                 `json:"similar"`
			Optimization []OptimizationSuggestion `json:"optimizationRecommendations"`
		} `json:"items"`
		DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
		NearDuplicates  []NearDuplicate  `json:"nearDuplicates"`
		LintFindings    []struct{}       `json:"lintFindings"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Items[0].References == nil {
		t.Fatalf("references decoded as nil from JSON: %s", body)
	}
	if decoded.Items[0].UsedBy == nil || decoded.Items[0].Duplicates == nil || decoded.Items[0].Similar == nil || decoded.Items[0].Optimization == nil {
		t.Fatalf("asset array fields decoded as nil from JSON: %s", body)
	}
	if decoded.DuplicateGroups == nil || decoded.NearDuplicates == nil || decoded.LintFindings == nil {
		t.Fatalf("catalog array fields decoded as nil from JSON: %s", body)
	}
}

func TestScanWithProgressReportsPhases(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "asset.png"), solidImage(2, 2, color.White))
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import asset from "./asset.png"`)

	var events []ScanProgress
	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	_, err := s.ScanWithProgress(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}}, nil, func(event ScanProgress) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[ScanPhase]bool{}
	metadataDone := false
	for _, event := range events {
		seen[event.Phase] = true
		if event.Phase == ScanPhaseMetadata && event.Current == 1 && event.Total == 1 {
			metadataDone = true
		}
	}
	for _, phase := range []ScanPhase{ScanPhaseCollecting, ScanPhaseMetadata, ScanPhaseReferences, ScanPhaseDuplicates, ScanPhaseNearDuplicates, ScanPhaseLint} {
		if !seen[phase] {
			t.Fatalf("missing progress phase %s in %#v", phase, events)
		}
	}
	if !metadataDone {
		t.Fatalf("metadata progress did not complete with 1/1: %#v", events)
	}
}

func TestScanSkipsHeavyDirectories(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "node_modules", "ignored.png"), solidImage(2, 2, color.Black))
	writePNG(t, filepath.Join(root, "src", "kept.png"), solidImage(2, 2, color.White))

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.TotalFiles != 1 {
		t.Fatalf("total files = %d, want 1", catalog.Stats.TotalFiles)
	}
	if catalog.Items[0].RepoPath != "src/kept.png" {
		t.Fatalf("repo path = %s, want src/kept.png", catalog.Items[0].RepoPath)
	}
}

func TestScanWithProgressHonorsExcludePatterns(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "assets", "logo.png"), solidImage(2, 2, color.White))
	writePNG(t, filepath.Join(root, "src", "__mocks__", "mock.png"), solidImage(2, 2, color.Black))
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "views", "BrowseView.test.ts"), `const fixture = "src/assets/logo.png"`)

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.ScanWithProgress(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}}, []string{"**/*.test.*", "**/__mocks__/**"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.TotalFiles != 1 {
		t.Fatalf("total files = %d, want 1", catalog.Stats.TotalFiles)
	}
	if catalog.Items[0].RepoPath != "src/assets/logo.png" {
		t.Fatalf("repo path = %s, want src/assets/logo.png", catalog.Items[0].RepoPath)
	}
	if len(catalog.Items[0].UsedBy) != 1 || catalog.Items[0].UsedBy[0] != "src/App.tsx" {
		t.Fatalf("usedBy = %#v, want only src/App.tsx", catalog.Items[0].UsedBy)
	}
}

func TestScanUsesPersistentCacheAndNearDuplicates(t *testing.T) {
	root := t.TempDir()
	cacheDir := filepath.Join(t.TempDir(), "cache")
	writePNG(t, filepath.Join(root, "src", "a.png"), gradientImage(16, 16, false))
	writePNG(t, filepath.Join(root, "src", "b.png"), gradientImage(16, 16, true))

	first, err := NewWithCacheDir(cacheDir).Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if first.Stats.CacheHits != 0 {
		t.Fatalf("first scan cache hits = %d, want 0", first.Stats.CacheHits)
	}
	if len(first.NearDuplicates) == 0 {
		t.Fatalf("near duplicates = %#v", first.NearDuplicates)
	}

	second, err := NewWithCacheDir(cacheDir).Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if second.Stats.CacheHits != 2 {
		t.Fatalf("second scan cache hits = %d, want 2", second.Stats.CacheHits)
	}
}

func TestThumbnailAndHelperErrorPaths(t *testing.T) {
	root := t.TempDir()
	assetPath := filepath.Join(root, "src", "thumb.png")
	writePNG(t, assetPath, solidImage(8, 8, color.NRGBA{R: 10, G: 20, B: 30, A: 255}))
	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog := Catalog{Items: []AssetItem{{ID: "asset", ProjectID: root, RepoPath: "src/thumb.png", LocalPath: assetPath, Bytes: 10}}}

	thumb, err := s.Thumbnail(context.Background(), catalog, "asset", 4)
	if err != nil {
		t.Fatal(err)
	}
	if thumb.Path == "" || thumb.MimeType != "image/png" {
		t.Fatalf("thumbnail = %#v", thumb)
	}
	if _, err := s.Thumbnail(context.Background(), catalog, "missing", 4); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing thumbnail err = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Thumbnail(ctx, catalog, "asset", 4); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled thumbnail err = %v", err)
	}
}

func TestCollectCandidatesAndContentHashHonorContext(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "asset.png"), solidImage(2, 2, color.White))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := collectCandidates(ctx, []Project{{ID: root, Name: "fixture", Path: root}}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("collectCandidates canceled err = %v", err)
	}
	if _, err := contentHashFile(ctx, filepath.Join(root, "src", "asset.png")); !errors.Is(err, context.Canceled) {
		t.Fatalf("contentHashFile canceled err = %v", err)
	}
}

func TestNormalizeCatalogSlicesAndStableHelpers(t *testing.T) {
	catalog := normalizeCatalogSlices(Catalog{Items: []AssetItem{{}}})
	if catalog.Projects == nil || catalog.DuplicateGroups == nil || catalog.NearDuplicates == nil || catalog.LintFindings == nil {
		t.Fatalf("catalog arrays = %#v", catalog)
	}
	item := catalog.Items[0]
	if item.UsedBy == nil || item.References == nil || item.Duplicates == nil || item.Similar == nil || item.Optimization == nil {
		t.Fatalf("item arrays = %#v", item)
	}
	if stableID("same") != stableID("same") || stableID("same") == stableID("other") {
		t.Fatal("stableID did not behave deterministically")
	}
	if assetKey("p", "a.png") != "p\x00a.png" {
		t.Fatalf("assetKey = %q", assetKey("p", "a.png"))
	}
	refs := uniqueReferenceFiles([]AssetReference{{File: "b.tsx"}, {File: "a.tsx"}, {File: "b.tsx"}})
	if len(refs) != 2 || refs[0] != "a.tsx" || refs[1] != "b.tsx" {
		t.Fatalf("uniqueReferenceFiles = %#v", refs)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	mustWriteBytes(t, path, []byte(content))
}

func mustWriteBytes(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func writePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
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

func solidImage(width, height int, c color.Color) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

func gradientImage(width, height int, offset bool) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			v := uint8((x + y) * 8)
			if offset && x == width-1 && y == height-1 {
				v += 2
			}
			img.Set(x, y, color.NRGBA{R: v, G: v, B: v, A: 255})
		}
	}
	return img
}

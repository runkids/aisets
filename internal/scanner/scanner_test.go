package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
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
	startedAt, err := time.Parse(time.RFC3339, catalog.StartedAt)
	if err != nil {
		t.Fatalf("startedAt = %q, want RFC3339 timestamp: %v", catalog.StartedAt, err)
	}
	generatedAt, err := time.Parse(time.RFC3339, catalog.GeneratedAt)
	if err != nil {
		t.Fatalf("generatedAt = %q, want RFC3339 timestamp: %v", catalog.GeneratedAt, err)
	}
	if generatedAt.Before(startedAt) {
		t.Fatalf("generatedAt %s is before startedAt %s", catalog.GeneratedAt, catalog.StartedAt)
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

func TestScanAssetPackMarksUsageNotApplicable(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "icons", "logo.png"), solidImage(2, 2, color.White))

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "assets", Path: root, ScanIntent: ProjectScanIntentAssetPack}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Analysis.References != AnalysisNotComputed || catalog.Stats.UnusedFiles != 0 || catalog.Stats.UsageNotApplicableFiles != 1 {
		t.Fatalf("catalog analysis/stats = %#v %#v", catalog.Analysis, catalog.Stats)
	}
	if got := catalog.Items[0]; got.UsageClassification != UsageNotApplicable || got.DeleteUnusedAllowed || got.LintApplicability != LintNotApplicable || got.OptimizeApplicability != OptimizeNotApplicable {
		t.Fatalf("item policy = %#v", got)
	}
	if len(catalog.Items[0].Optimization) != 0 {
		t.Fatalf("asset pack item should have no optimization suggestions, got %d", len(catalog.Items[0].Optimization))
	}
}

func TestScanLibraryMarksZeroReferenceAssetsAdvisory(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "logo.png"), solidImage(2, 2, color.White))
	mustWrite(t, filepath.Join(root, "src", "index.ts"), `export const x = 1`)

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.Scan(context.Background(), []Project{{ID: root, Name: "library", Path: root, ScanIntent: ProjectScanIntentLibrary}})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.UnusedFiles != 0 || catalog.Stats.PossiblyUnusedFiles != 1 {
		t.Fatalf("stats = %#v", catalog.Stats)
	}
	if got := catalog.Items[0]; got.UsageClassification != UsagePossiblyUnused || got.DeleteUnusedAllowed || got.OptimizeApplicability != OptimizeAdvisory {
		t.Fatalf("item policy = %#v", got)
	}
}

func TestScanUsesIntentSpecificExcludePatterns(t *testing.T) {
	root := t.TempDir()
	codeRoot := filepath.Join(root, "code")
	assetRoot := filepath.Join(root, "assets")
	writePNG(t, filepath.Join(codeRoot, "src", "logo.png"), solidImage(2, 2, color.White))
	mustWrite(t, filepath.Join(codeRoot, "src", "App.tsx"), `export function App() { return null }`)
	mustWrite(t, filepath.Join(codeRoot, "src", "App.test.tsx"), `import logo from "./logo.png"`)
	writePNG(t, filepath.Join(assetRoot, "icons", "skip.png"), solidImage(2, 2, color.Black))

	options := FullScanOptions()
	options.ExcludePatternsByIntent = ExcludePatternsByIntent{
		ProjectScanIntentCode:      []string{"**/*.test.*"},
		ProjectScanIntentAssetPack: []string{"icons/skip.png"},
	}

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.ScanWithOptions(context.Background(), []Project{
		{ID: "code", Name: "code", Path: codeRoot, ScanIntent: ProjectScanIntentCode},
		{ID: "assets", Name: "assets", Path: assetRoot, ScanIntent: ProjectScanIntentAssetPack},
	}, options, nil)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Stats.TotalFiles != 1 || catalog.Items[0].RepoPath != "src/logo.png" {
		t.Fatalf("items = %#v stats = %#v", catalog.Items, catalog.Stats)
	}
	if len(catalog.Items[0].UsedBy) != 0 || catalog.Items[0].UsageClassification != UsageUnused {
		t.Fatalf("item policy = %#v", catalog.Items[0])
	}
}

func TestProjectReferenceCoverageRequiresFrontendSignals(t *testing.T) {
	frontend := t.TempDir()
	mustWrite(t, filepath.Join(frontend, "src", "App.tsx"), `export function App() { return null }`)
	if got := ProjectReferenceCoverage(context.Background(), Project{ID: "frontend", Path: frontend, ScanIntent: ProjectScanIntentCode}, nil); got != ReferenceCoverageSupported {
		t.Fatalf("frontend coverage = %s, want %s", got, ReferenceCoverageSupported)
	}

	backendTemplates := t.TempDir()
	mustWrite(t, filepath.Join(backendTemplates, "go.mod"), "module fixture\n")
	mustWrite(t, filepath.Join(backendTemplates, "templates", "index.html"), `<img src="/logo.png">`)
	mustWrite(t, filepath.Join(backendTemplates, "templates", "app.js"), `console.log("fixture")`)
	if got := ProjectReferenceCoverage(context.Background(), Project{ID: "backend", Path: backendTemplates, ScanIntent: ProjectScanIntentCode}, nil); got != ReferenceCoveragePartial {
		t.Fatalf("backend template coverage = %s, want %s", got, ReferenceCoveragePartial)
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

func TestScanSkipsExcludedDirectories(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "node_modules", "ignored.png"), solidImage(2, 2, color.Black))
	writePNG(t, filepath.Join(root, "src", "kept.png"), solidImage(2, 2, color.White))

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	options := FullScanOptions()
	options.ExcludePatterns = []string{"node_modules"}
	catalog, err := s.ScanWithOptions(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}}, options, nil)
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
	writePNG(t, filepath.Join(root, "ui", "public", "brand", "aisets-logo.png"), solidImage(2, 2, color.White))
	writePNG(t, filepath.Join(root, "src", "__mocks__", "mock.png"), solidImage(2, 2, color.Black))
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "views", "BrowseView.test.ts"), `const fixture = "src/assets/logo.png"`)

	s := NewWithCacheDir(filepath.Join(t.TempDir(), "cache"))
	catalog, err := s.ScanWithProgress(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}}, []string{"**/*.test.*", "**/__mocks__/**", "aisets-logo.png"}, nil)
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

func TestMarkNearDuplicatesUsesIndexedCandidates(t *testing.T) {
	items := []AssetItem{
		{ID: "a", RepoPath: "a.png", DHash: "0000000000000000", ContentHash: "same"},
		{ID: "b", RepoPath: "b.png", DHash: "ffffffffffffffff", DHashFlipped: "000000000000001f"},
		{ID: "c", RepoPath: "c.png", DHash: "0000000000000001", ContentHash: "same"},
	}
	var events []ScanProgress
	near, err := markNearDuplicates(context.Background(), items, func(event ScanProgress) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(near) != 1 {
		t.Fatalf("near duplicates = %#v, want one", near)
	}
	if near[0].LeftID != "a" || near[0].RightID != "b" || !near[0].Flipped || near[0].Distance != 5 {
		t.Fatalf("near duplicate = %#v", near[0])
	}
	if len(items[0].Similar) != 1 || items[0].Similar[0] != "b" || len(items[1].Similar) != 1 || items[1].Similar[0] != "a" || len(items[2].Similar) != 0 {
		t.Fatalf("similar links = %#v %#v %#v", items[0].Similar, items[1].Similar, items[2].Similar)
	}
	if len(events) != len(items) || events[len(events)-1].Current != len(items) || events[len(events)-1].Total != len(items) {
		t.Fatalf("progress events = %#v", events)
	}
}

func TestScanRejectsFlatDifferentColorNearDuplicate(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "src", "red.png"), solidImage(16, 16, color.NRGBA{R: 255, A: 255}))
	writePNG(t, filepath.Join(root, "src", "blue.png"), solidImage(16, 16, color.NRGBA{B: 255, A: 255}))

	catalog, err := NewWithCacheDir(filepath.Join(t.TempDir(), "cache")).Scan(context.Background(), []Project{{ID: root, Name: "fixture", Path: root}})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.NearDuplicates) != 0 {
		t.Fatalf("near duplicates = %#v, want none for flat assets with different colors", catalog.NearDuplicates)
	}
	for _, item := range catalog.Items {
		if len(item.Similar) != 0 {
			t.Fatalf("%s similar = %#v, want none", item.RepoPath, item.Similar)
		}
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

func TestScanInvalidatesCacheWhenContentChangesWithPreservedStat(t *testing.T) {
	root := t.TempDir()
	cacheDir := filepath.Join(t.TempDir(), "cache")
	assetPath := filepath.Join(root, "src", "asset.png")
	peerPath := filepath.Join(root, "src", "peer.png")
	mtime := time.Unix(1_700_000_000, 0)
	project := []Project{{ID: root, Name: "fixture", Path: root}}

	writeUncompressedPNG(t, assetPath, solidImage(8, 8, color.NRGBA{R: 255, A: 255}))
	writeUncompressedPNG(t, peerPath, solidImage(8, 8, color.NRGBA{R: 255, A: 255}))
	if err := os.Chtimes(assetPath, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(peerPath, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	originalInfo, err := os.Stat(assetPath)
	if err != nil {
		t.Fatal(err)
	}

	s := NewWithCacheDir(cacheDir)
	first, err := s.Scan(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	firstItem := mustCatalogItem(t, first, "src/asset.png")
	firstPeer := mustCatalogItem(t, first, "src/peer.png")
	if firstItem.ContentHash == "" || firstItem.ContentHash != firstPeer.ContentHash {
		t.Fatalf("initial duplicate content hashes = %q peer = %q", firstItem.ContentHash, firstPeer.ContentHash)
	}
	if first.Stats.DuplicateGroups != 1 {
		t.Fatalf("initial duplicate groups = %d, want 1", first.Stats.DuplicateGroups)
	}

	writeUncompressedPNG(t, assetPath, solidImage(8, 8, color.NRGBA{B: 255, A: 255}))
	if err := os.Chtimes(assetPath, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	changedInfo, err := os.Stat(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	if changedInfo.Size() != originalInfo.Size() || !changedInfo.ModTime().Equal(originalInfo.ModTime()) {
		t.Fatalf("test fixture must preserve size and mtime: before=(%d,%s) after=(%d,%s)", originalInfo.Size(), originalInfo.ModTime(), changedInfo.Size(), changedInfo.ModTime())
	}

	second, err := s.Scan(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	secondItem := mustCatalogItem(t, second, "src/asset.png")
	secondPeer := mustCatalogItem(t, second, "src/peer.png")
	if secondItem.ContentHash == firstItem.ContentHash {
		t.Fatalf("content hash stayed stale after same-size same-mtime content change: %q", secondItem.ContentHash)
	}
	if secondItem.ContentHash == secondPeer.ContentHash || second.Stats.DuplicateGroups != 0 {
		t.Fatalf("stale duplicate state after content change: asset=%q peer=%q duplicateGroups=%d cacheHits=%d", secondItem.ContentHash, secondPeer.ContentHash, second.Stats.DuplicateGroups, second.Stats.CacheHits)
	}
}

func TestThumbnailCacheInvalidatesWhenAssetContentChangesWithPreservedStat(t *testing.T) {
	root := t.TempDir()
	cacheDir := filepath.Join(t.TempDir(), "cache")
	assetPath := filepath.Join(root, "src", "thumb.png")
	project := []Project{{ID: root, Name: "fixture", Path: root}}
	mtime := time.Unix(1_700_000_000, 0)

	writeUncompressedPNG(t, assetPath, solidImage(8, 8, color.NRGBA{R: 255, A: 255}))
	if err := os.Chtimes(assetPath, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	originalInfo, err := os.Stat(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithCacheDir(cacheDir)
	first, err := s.Scan(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	firstThumb, err := s.Thumbnail(context.Background(), first, first.Items[0].ID, 4)
	if err != nil {
		t.Fatal(err)
	}
	firstBytes, err := os.ReadFile(firstThumb.Path)
	if err != nil {
		t.Fatal(err)
	}

	writeUncompressedPNG(t, assetPath, solidImage(8, 8, color.NRGBA{B: 255, A: 255}))
	if err := os.Chtimes(assetPath, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	changedInfo, err := os.Stat(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	if changedInfo.Size() != originalInfo.Size() || !changedInfo.ModTime().Equal(originalInfo.ModTime()) {
		t.Fatalf("test fixture must preserve size and mtime: before=(%d,%s) after=(%d,%s)", originalInfo.Size(), originalInfo.ModTime(), changedInfo.Size(), changedInfo.ModTime())
	}
	second, err := s.Scan(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	if second.Items[0].ThumbnailURL == first.Items[0].ThumbnailURL {
		t.Fatalf("thumbnail URL version stayed stale: before=%q after=%q", first.Items[0].ThumbnailURL, second.Items[0].ThumbnailURL)
	}
	secondThumb, err := s.Thumbnail(context.Background(), second, second.Items[0].ID, 4)
	if err != nil {
		t.Fatal(err)
	}
	secondBytes, err := os.ReadFile(secondThumb.Path)
	if err != nil {
		t.Fatal(err)
	}

	if bytes.Equal(firstBytes, secondBytes) {
		t.Fatalf("thumbnail cache reused stale content: first=%s second=%s secondCacheHit=%v", firstThumb.Path, secondThumb.Path, secondThumb.CacheHit)
	}
}

func mustCatalogItem(t *testing.T, catalog Catalog, repoPath string) AssetItem {
	t.Helper()
	for _, item := range catalog.Items {
		if item.RepoPath == repoPath {
			return item
		}
	}
	t.Fatalf("catalog item %q not found in %#v", repoPath, catalog.Items)
	return AssetItem{}
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
	if _, err := collectCandidates(ctx, []Project{{ID: root, Name: "fixture", Path: root}}, ScanOptions{}); !errors.Is(err, context.Canceled) {
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
	writePNGWithEncoder(t, path, img, png.Encoder{})
}

func writeUncompressedPNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	writePNGWithEncoder(t, path, img, png.Encoder{CompressionLevel: png.NoCompression})
}

func writePNGWithEncoder(t *testing.T, path string, img image.Image, encoder png.Encoder) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := encoder.Encode(file, img); err != nil {
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

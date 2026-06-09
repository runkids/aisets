package references

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveReferenceKinds(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		importer string
		spec     string
		want     string
	}{
		{"src/components/App.tsx", "../assets/logo.png", "src/assets/logo.png"},
		{"src/components/App.tsx", "@/assets/logo.png", "src/assets/logo.png"},
		{"src/components/App.tsx", "/src/assets/logo.png", "src/assets/logo.png"},
		{"src/components/App.tsx", "src/assets/logo.png?raw", "src/assets/logo.png"},
		// Monorepo: @/ resolves relative to nearest src/ ancestor
		{"apps/mobile/src/views/Page.vue", "@/assets/logo.png", "apps/mobile/src/assets/logo.png"},
		{"apps/mobile/src/views/Page.vue", "~/assets/logo.png", "apps/mobile/src/assets/logo.png"},
		{"packages/ui/src/components/Card.tsx", "@/assets/icon.svg", "packages/ui/src/assets/icon.svg"},
		// No src/ ancestor falls back to bare src/
		{"lib/util.ts", "@/assets/logo.png", "src/assets/logo.png"},
	}
	for _, tt := range tests {
		if got := Resolve(root, tt.importer, tt.spec); got != tt.want {
			t.Fatalf("Resolve(%q, %q) = %q, want %q", tt.importer, tt.spec, got, tt.want)
		}
	}
	if got := Resolve(root, "src/App.tsx", `./${name}.png`); got != "" {
		t.Fatalf("dynamic template resolved to %q", got)
	}
}

func TestResolveWithImportAliases(t *testing.T) {
	root := t.TempDir()
	aliases := map[string]string{
		"@acme/shared-ui":  "packages/shared-ui",
		"@acme/design-tokens": "packages/design-tokens",
	}
	tests := []struct {
		importer string
		spec     string
		want     string
	}{
		{"src/App.tsx", "@acme/shared-ui/images/icon.svg", "packages/shared-ui/images/icon.svg"},
		{"src/App.tsx", "@acme/shared-ui/images/icon.svg?component", "packages/shared-ui/images/icon.svg"},
		{"src/App.tsx", "@acme/design-tokens/images/logo.png", "packages/design-tokens/images/logo.png"},
		// No alias match falls through to existing behavior
		{"src/App.tsx", "@/assets/logo.png", "src/assets/logo.png"},
		{"src/App.tsx", "./assets/logo.png", "src/assets/logo.png"},
	}
	for _, tt := range tests {
		if got := ResolveWithAliases(root, tt.importer, tt.spec, aliases); got != tt.want {
			t.Fatalf("ResolveWithAliases(%q, %q) = %q, want %q", tt.importer, tt.spec, got, tt.want)
		}
	}
	// Nil aliases = same as Resolve
	if got := ResolveWithAliases(root, "src/App.tsx", "@/assets/logo.png", nil); got != "src/assets/logo.png" {
		t.Fatalf("ResolveWithAliases nil aliases = %q", got)
	}
}

func TestBuildMapResolvesImportAliases(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "packages", "shared-assets", "images", "icon.svg"), "image")
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "views", "Home.vue"),
		`import Icon from '@acme/shared-ui/images/icon.svg'`)

	aliases := map[string]string{"@acme/shared-ui": "packages/shared-ui"}
	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root, ImportAliases: aliases}},
		[]Asset{{ProjectID: "p", RepoPath: "packages/shared-ui/images/icon.svg"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	got := refs["p\x00packages/shared-ui/images/icon.svg"]
	if len(got) != 1 || got[0].File != "apps/web/src/views/Home.vue" {
		t.Fatalf("alias refs = %#v, want 1 ref from Home.vue", got)
	}
}

func TestExtractCSSStringAndPatternReferences(t *testing.T) {
	content := `
const a = "./assets/a.png"
const b = ` + "`./assets/${name}.png`" + `
.hero { background-image: url("../assets/bg.webp"); }
`
	refs := Extract(content)
	if len(refs) != 3 {
		t.Fatalf("refs = %#v", refs)
	}
	if refs[0].Kind != "string" || refs[1].Kind != "pattern" || refs[2].Kind != "css-url" {
		t.Fatalf("unexpected kinds = %#v", refs)
	}
}

func TestExtractIgnoresBareImageExtensions(t *testing.T) {
	content := `
const suffix = ".png"
const querySuffix = ".webp?raw"
const file = "logo.png"
`
	refs := Extract(content)
	if len(refs) != 1 || refs[0].Specifier != "logo.png" {
		t.Fatalf("refs = %#v, want only logo.png", refs)
	}
}

func TestBuildMapResolvesProjectReferences(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "assets", "logo.png"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "@/assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "style.css"), `.logo{background:url("./assets/logo.png")}`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{{ProjectID: "p", RepoPath: "src/assets/logo.png"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	got := refs["p\x00src/assets/logo.png"]
	if len(got) != 2 {
		t.Fatalf("refs = %#v", got)
	}
	if got[0].File != "src/App.tsx" || got[1].File != "src/style.css" {
		t.Fatalf("refs sorted/resolved = %#v", got)
	}
}

func TestBuildMapResolvesAbsolutePublicReferences(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "ui", "public", "favicon.png"), "image")
	mustWrite(t, filepath.Join(root, "ui", "public", "brand", "app-icon.png"), "image")
	mustWrite(t, filepath.Join(root, "ui", "index.html"), `<link rel="icon" href="/favicon.png" />`)
	mustWrite(t, filepath.Join(root, "ui", "public", "site.webmanifest"), `{"icons":[{"src":"/brand/app-icon.png"}]}`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{
			{ProjectID: "p", RepoPath: "ui/public/favicon.png"},
			{ProjectID: "p", RepoPath: "ui/public/brand/app-icon.png"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := refs["p\x00ui/public/favicon.png"]; len(got) != 1 || got[0].File != "ui/index.html" {
		t.Fatalf("favicon refs = %#v, want ui/index.html", got)
	}
	if got := refs["p\x00ui/public/brand/app-icon.png"]; len(got) != 1 || got[0].File != "ui/public/site.webmanifest" {
		t.Fatalf("app icon refs = %#v, want ui/public/site.webmanifest", got)
	}
}

func TestBuildMapResolvesAbsolutePathInMonorepo(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "apps", "dashboard", "src", "assets", "hero.webp"), "image")
	mustWrite(t, filepath.Join(root, "apps", "dashboard", "index.html"),
		`<img src="/src/assets/hero.webp" alt="hero" />`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{{ProjectID: "p", RepoPath: "apps/dashboard/src/assets/hero.webp"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	got := refs["p\x00apps/dashboard/src/assets/hero.webp"]
	if len(got) != 1 || got[0].File != "apps/dashboard/index.html" {
		t.Fatalf("absolute path monorepo refs = %#v, want 1 ref from index.html", got)
	}
}

func TestBuildMapAbsoluteSrcPathDoesNotMatchSiblingAppAssets(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "assets", "hero.webp"), "web")
	mustWrite(t, filepath.Join(root, "apps", "admin", "src", "assets", "hero.webp"), "admin")
	mustWrite(t, filepath.Join(root, "apps", "web", "index.html"), `<img src="/src/assets/hero.webp" />`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{
			{ProjectID: "p", RepoPath: "apps/web/src/assets/hero.webp"},
			{ProjectID: "p", RepoPath: "apps/admin/src/assets/hero.webp"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := refs["p\x00apps/web/src/assets/hero.webp"]; len(got) != 1 {
		t.Fatalf("web refs = %#v, want 1", got)
	}
	if got := refs["p\x00apps/admin/src/assets/hero.webp"]; len(got) != 0 {
		t.Fatalf("admin refs = %#v, want none", got)
	}
}

func TestBuildMapResolvesMonorepoAtAliasImports(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "assets", "images", "banner.png"), "image")
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "views", "Home.vue"),
		`import Banner from '@/assets/images/banner.png'`)
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "views", "About.vue"),
		`.hero { background-image: url('@/assets/images/banner.png'); }`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{{ProjectID: "p", RepoPath: "apps/web/src/assets/images/banner.png"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	got := refs["p\x00apps/web/src/assets/images/banner.png"]
	if len(got) != 2 {
		t.Fatalf("monorepo @/ refs = %#v, want 2 refs", got)
	}
	if got[0].File != "apps/web/src/views/About.vue" || got[1].File != "apps/web/src/views/Home.vue" {
		t.Fatalf("monorepo @/ refs files = [%s, %s], want About.vue and Home.vue", got[0].File, got[1].File)
	}
}

func TestBuildMapTildeAliasDoesNotMatchSiblingAppAssets(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "assets", "logo.png"), "web")
	mustWrite(t, filepath.Join(root, "apps", "admin", "src", "assets", "logo.png"), "admin")
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "App.tsx"), `import logo from "~/assets/logo.png"`)

	refs, err := BuildMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{
			{ProjectID: "p", RepoPath: "apps/web/src/assets/logo.png"},
			{ProjectID: "p", RepoPath: "apps/admin/src/assets/logo.png"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := refs["p\x00apps/web/src/assets/logo.png"]; len(got) != 1 {
		t.Fatalf("web refs = %#v, want 1", got)
	}
	if got := refs["p\x00apps/admin/src/assets/logo.png"]; len(got) != 0 {
		t.Fatalf("admin refs = %#v, want none", got)
	}
}

func TestBuildMapWithProgressExcludesMatchedCodeFiles(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "assets", "logo.png"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "@/assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "views", "BrowseView.test.ts"), `const fixture = "src/assets/logo.png"`)
	mustWrite(t, filepath.Join(root, "src", "__tests__", "nested", "fixture.ts"), `const fixture = "src/assets/logo.png"`)

	refs, err := BuildMapWithProgress(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]Asset{{ProjectID: "p", RepoPath: "src/assets/logo.png"}},
		[]string{"**/*.test.*", "**/__tests__/**"},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	got := refs["p\x00src/assets/logo.png"]
	if len(got) != 1 || got[0].File != "src/App.tsx" {
		t.Fatalf("refs = %#v, want only src/App.tsx", got)
	}
}

func TestMatchExcludePatternTreatsPlainFileNameAsAnyDepth(t *testing.T) {
	if !MatchExcludePattern("aisets-logo.png", "ui/public/brand/aisets-logo.png") {
		t.Fatal("plain filename pattern should match the same file at any depth")
	}
	if MatchExcludePattern("aisets-logo.png", "ui/public/brand/aisets-logo@2x.png") {
		t.Fatal("plain filename pattern should not partially match other filenames")
	}
	if !MatchExcludePattern("/demo/", "packages/demo/logo.png") {
		t.Fatal("slash-wrapped plain pattern should match a path segment")
	}
	if MatchExcludePattern("/demo/", "logo.png") {
		t.Fatal("slash-wrapped plain pattern should not match when the segment is outside the project-relative path")
	}
}

func TestReferenceHelperFunctions(t *testing.T) {
	root := t.TempDir()
	exts := CodeExtensions()
	if !exts[".tsx"] || !exts[".css"] {
		t.Fatalf("CodeExtensions = %#v", exts)
	}
	exts[".tsx"] = false
	if !CodeExtensions()[".tsx"] {
		t.Fatal("CodeExtensions returned shared map")
	}
	if !referenceMayPointTo(root, "src/assets/logo.png", "src/App.tsx", "./assets/logo.png?raw") {
		t.Fatal("expected suffix reference to point to asset")
	}
	if referenceMayPointTo(root, "src/assets/logo.png", "src/App.tsx", "./other.png") {
		t.Fatal("unexpected reference match")
	}
	if referenceMayPointTo(root, "demo/英/电子/PTG2029_choy sun doa.png", "src/App.tsx", "a.png") {
		t.Fatal("partial filename suffix should not match")
	}
	if !referenceMayPointTo(root, "demo/icons/a.png", "src/App.tsx", "a.png") {
		t.Fatal("exact filename should match via path boundary")
	}
	if !referenceMayPointTo(root, "apps/web/src/assets/images/banner.png", "apps/web/src/views/Home.vue", "@/assets/images/banner.png") {
		t.Fatal("@/ alias stripped suffix should match monorepo asset path")
	}
	if !referenceMayPointTo(root, "packages/ui/src/assets/icon.svg", "packages/ui/src/components/Card.tsx", "~/assets/icon.svg") {
		t.Fatal("~/ alias stripped suffix should match monorepo asset path")
	}
	if cleanRepoPath("../escape.png") != "" || cleanRepoPath("./src/a.png") != "src/a.png" {
		t.Fatal("cleanRepoPath did not normalize safely")
	}
	if stripQuery(" icon.png?raw ") != "icon.png" {
		t.Fatalf("stripQuery = %q", stripQuery(" icon.png?raw "))
	}
}

func TestBuildMapHonorsContextCancellation(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./logo.png"`)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := BuildMap(ctx, []Project{{ID: "p", Path: root}}, []Asset{{ProjectID: "p", RepoPath: "src/logo.png"}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("BuildMap canceled err = %v", err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

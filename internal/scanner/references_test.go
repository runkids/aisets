package scanner

import (
	"context"
	"path/filepath"
	"testing"
)

// Auto-detected tsconfig aliases must flow into reference resolution so an
// import using an aliased path resolves to the real asset.
func TestBuildReferenceMapAutoDetectsTSConfigAliases(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "tsconfig.json"),
		`{"compilerOptions":{"baseUrl":".","paths":{"@ui/*":["packages/ui/src/*"]}}}`)
	mustWrite(t, filepath.Join(root, "packages", "ui", "src", "icon.svg"), "image")
	mustWrite(t, filepath.Join(root, "apps", "web", "src", "App.tsx"),
		`import Icon from '@ui/icon.svg'`)

	refs, err := buildReferenceMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]AssetItem{{ProjectID: "p", RepoPath: "packages/ui/src/icon.svg"}},
		ScanOptions{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := refs[assetKey("p", "packages/ui/src/icon.svg")]
	if len(got) != 1 || got[0].File != "apps/web/src/App.tsx" {
		t.Fatalf("auto-detected alias refs = %#v, want 1 ref from App.tsx", got)
	}
}

// A baseUrl-only alias (paths "@/*": ["*"]) must resolve against the
// project's declared baseUrl, taking precedence over the native @/ → src
// heuristic.
func TestBuildReferenceMapAutoDetectsBaseURLOnlyAlias(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "tsconfig.json"),
		`{"compilerOptions":{"baseUrl":"app","paths":{"@/*":["*"]}}}`)
	mustWrite(t, filepath.Join(root, "app", "logo.png"), "image")
	mustWrite(t, filepath.Join(root, "App.tsx"), `import logo from "@/logo.png"`)

	refs, err := buildReferenceMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]AssetItem{{ProjectID: "p", RepoPath: "app/logo.png"}},
		ScanOptions{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := refs[assetKey("p", "app/logo.png")]
	if len(got) != 1 || got[0].File != "App.tsx" {
		t.Fatalf("baseUrl-only alias refs = %#v, want App.tsx", got)
	}
}

// Manual importAliases override an auto-detected alias on key collision.
func TestBuildReferenceMapManualAliasOverridesDetected(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "tsconfig.json"),
		`{"compilerOptions":{"paths":{"@ui/*":["wrong/path/*"]}}}`)
	mustWrite(t, filepath.Join(root, "packages", "ui", "icon.svg"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import Icon from '@ui/icon.svg'`)

	refs, err := buildReferenceMap(context.Background(),
		[]Project{{ID: "p", Path: root}},
		[]AssetItem{{ProjectID: "p", RepoPath: "packages/ui/icon.svg"}},
		ScanOptions{ImportAliases: map[string]string{"@ui": "packages/ui"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := refs[assetKey("p", "packages/ui/icon.svg")]
	if len(got) != 1 || got[0].File != "src/App.tsx" {
		t.Fatalf("manual override refs = %#v, want manual @ui->packages/ui to win", got)
	}
}

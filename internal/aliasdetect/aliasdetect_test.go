package aliasdetect

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectTSConfigPaths(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{
  // JSONC: comments and trailing commas are allowed
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["./src/components/*"],
      "@ui": ["packages/ui/src"],
      "ignored/*": ["../outside/*"],
    },
  },
}`)

	got := Detect(root)
	want := map[string]string{
		"@":           "src",
		"@components": "src/components",
		"@ui":         "packages/ui/src",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Detect = %#v, want %#v", got, want)
	}
}

func TestDetectTSConfigDefaultBaseURL(t *testing.T) {
	root := t.TempDir()
	// No baseUrl: paths resolve relative to the tsconfig directory.
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{
  "compilerOptions": { "paths": { "@/*": ["src/*"] } }
}`)
	got := Detect(root)
	if got["@"] != "src" {
		t.Fatalf("Detect[@] = %q, want src (got %#v)", got["@"], got)
	}
}

func TestDetectJSConfigFallback(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "jsconfig.json"), `{
  "compilerOptions": { "baseUrl": "src", "paths": { "@lib/*": ["lib/*"] } }
}`)
	got := Detect(root)
	if got["@lib"] != "src/lib" {
		t.Fatalf("Detect[@lib] = %q, want src/lib (got %#v)", got["@lib"], got)
	}
}

func TestDetectTSConfigExtendsChain(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "tsconfig.base.json"), `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"], "@shared/*": ["packages/shared/*"] }
  }
}`)
	// Child overrides @ and inherits @shared.
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["app/*"] } }
}`)

	got := Detect(root)
	if got["@"] != "app" {
		t.Fatalf("child should override @: got %q", got["@"])
	}
	if got["@shared"] != "packages/shared" {
		t.Fatalf("inherited @shared = %q, want packages/shared", got["@shared"])
	}
}

func TestDetectTSConfigExtendsCycleGuard(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{ "extends": "./tsconfig.b.json" }`)
	writeFile(t, filepath.Join(root, "tsconfig.b.json"), `{ "extends": "./tsconfig.json",
  "compilerOptions": { "paths": { "@/*": ["src/*"] } } }`)
	// Must terminate and still pick up the reachable paths.
	got := Detect(root)
	if got["@"] != "src" {
		t.Fatalf("cycle-guarded detect = %#v", got)
	}
}

func TestDetectTSConfigBaseURLOnlyAlias(t *testing.T) {
	root := t.TempDir()
	// Common pattern: alias target is just "*", aimed at a non-root baseUrl.
	writeFile(t, filepath.Join(root, "tsconfig.json"),
		`{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}`)
	got := Detect(root)
	if got["@"] != "src" {
		t.Fatalf("Detect[@] = %q, want src (got %#v)", got["@"], got)
	}
}

func TestDetectTSConfigArrayExtends(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "base.a.json"),
		`{ "compilerOptions": { "paths": { "@a/*": ["a/*"] } } }`)
	writeFile(t, filepath.Join(root, "base.b.json"),
		`{ "compilerOptions": { "paths": { "@b/*": ["b/*"] } } }`)
	// TS 5 array extends: both bases contribute.
	writeFile(t, filepath.Join(root, "tsconfig.json"),
		`{ "extends": ["./base.a.json", "./base.b.json"] }`)

	got := Detect(root)
	if got["@a"] != "a" || got["@b"] != "b" {
		t.Fatalf("array extends detect = %#v, want @a->a and @b->b", got)
	}
}

func TestDetectViteObjectForm(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "vite.config.ts"), `
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
      '@public': '/public',
    },
  },
})
`)
	got := Detect(root)
	want := map[string]string{
		"@":       "src",
		"@assets": "src/assets",
		"@public": "public",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Detect = %#v, want %#v", got, want)
	}
}

func TestDetectViteArrayForm(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "vite.config.js"), `
export default {
  resolve: {
    alias: [
      { find: '@', replacement: '/src' },
      { find: '@comp', replacement: 'src/components' },
    ],
  },
}
`)
	got := Detect(root)
	if got["@"] != "src" || got["@comp"] != "src/components" {
		t.Fatalf("array-form detect = %#v", got)
	}
}

func TestDetectViteOverridesTSConfig(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "tsconfig.json"),
		`{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }`)
	writeFile(t, filepath.Join(root, "vite.config.ts"),
		`export default { resolve: { alias: { '@': 'app' } } }`)
	got := Detect(root)
	if got["@"] != "app" {
		t.Fatalf("vite should override tsconfig: got %#v", got)
	}
}

func TestDetectMissingOrMalformed(t *testing.T) {
	if got := Detect(t.TempDir()); got != nil {
		t.Fatalf("no config files should yield nil, got %#v", got)
	}
	if got := Detect(""); got != nil {
		t.Fatalf("empty root should yield nil, got %#v", got)
	}
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{ this is not json `)
	if got := Detect(root); got != nil {
		t.Fatalf("malformed tsconfig should be skipped, got %#v", got)
	}
}

func TestMerge(t *testing.T) {
	auto := map[string]string{"@": "src", "@ui": "packages/ui"}
	manual := map[string]string{"@ui": "custom/ui", "@x": "x"}
	got := Merge(auto, manual)
	want := map[string]string{"@": "src", "@ui": "custom/ui", "@x": "x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Merge = %#v, want %#v", got, want)
	}
	if Merge(nil, nil) != nil {
		t.Fatal("Merge(nil, nil) should be nil")
	}
	if got := Merge(auto, nil); !reflect.DeepEqual(got, auto) {
		t.Fatalf("Merge(auto, nil) = %#v", got)
	}
}

package cache

import (
	"os"
	"path/filepath"
	"testing"

	"asset-studio/internal/imageproc"
)

func TestStoreHitMissInvalidationAndRestart(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if store.Path() != filepath.Join(dir, "catalog-cache.json") {
		t.Fatalf("Path() = %q", store.Path())
	}
	key := "project:asset"
	record := Record{
		ProjectID:     "project",
		RepoPath:      "src/a.png",
		Size:          10,
		MTimeUnix:     20,
		ContentHash:   "hash",
		HashAlgorithm: "blake3",
		Metadata:      imageproc.Metadata{Format: "png", Width: 1, Height: 1, Pages: 1},
	}
	if err := store.Set(key, record); err != nil {
		t.Fatal(err)
	}
	got, ok := store.Get(key, 10, 20)
	if !ok || got.ContentHash != "hash" {
		t.Fatalf("cache hit = %#v, %v", got, ok)
	}
	if _, ok := store.Get(key, 11, 20); ok {
		t.Fatal("size change should invalidate cache")
	}
	if _, ok := store.Get(key, 10, 21); ok {
		t.Fatal("mtime change should invalidate cache")
	}
	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, ok = reopened.Get(key, 10, 20)
	if !ok || got.Metadata.Width != 1 {
		t.Fatalf("reopened cache miss = %#v, %v", got, ok)
	}
}

func TestStoreIgnoresCorruptCache(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "catalog-cache.json"), []byte("{bad json"), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get("missing", 1, 1); ok {
		t.Fatal("corrupt cache should reopen empty")
	}
}

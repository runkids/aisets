package config

import (
	"path/filepath"
	"testing"
)

func seedMinimalScan(t *testing.T, store *Store) {
	t.Helper()
	_, err := store.db.Exec(`INSERT INTO scans (started_at, completed_at, status, project_count, total_files, duplicate_groups, duplicate_files, unused_files, near_duplicates, cache_hits, scan_profile, references_state, near_duplicates_state, optimization_state) VALUES (datetime('now'), datetime('now'), 'completed', 1, 0, 0, 0, 0, 0, 0, 'fast', 'none', 'none', 'none')`)
	if err != nil {
		t.Fatal(err)
	}
}

func TestResolveScanID_PositivePassthrough(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	id, err := store.resolveScanID(42)
	if err != nil {
		t.Fatal(err)
	}
	if id != 42 {
		t.Fatalf("expected 42, got %d", id)
	}
}

func TestResolveScanID_CachesLatestScan(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// Seed a completed scan so LatestScan() returns something.
	seedMinimalScan(t, store)

	id1, err := store.resolveScanID(0)
	if err != nil {
		t.Fatal(err)
	}
	if id1 <= 0 {
		t.Fatalf("expected positive scan ID, got %d", id1)
	}

	// Second call should return cached value (same ID).
	id2, err := store.resolveScanID(0)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatalf("expected cached ID %d, got %d", id1, id2)
	}
}

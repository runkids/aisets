package actions

import (
	"os"
	"path/filepath"
	"testing"

	"asset-studio/internal/scanner"
)

func TestBatchDelete(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "img", "a.png"), "aaa")
	mustWrite(t, filepath.Join(root, "img", "b.png"), "bbb")
	mustWrite(t, filepath.Join(root, "img", "keep.png"), "keep")

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{ID: "id-a", ProjectID: root, RepoPath: "img/a.png"},
		{ID: "id-b", ProjectID: root, RepoPath: "img/b.png"},
	}

	result := BatchDelete(project, items)

	if len(result.Succeeded) != 2 {
		t.Fatalf("expected 2 succeeded, got %d: %v", len(result.Succeeded), result.Succeeded)
	}
	if len(result.Failed) != 0 {
		t.Fatalf("expected 0 failed, got %d: %v", len(result.Failed), result.Failed)
	}
	if len(result.Skipped) != 0 {
		t.Fatalf("expected 0 skipped, got %d: %v", len(result.Skipped), result.Skipped)
	}
	if result.AppliedAt == "" {
		t.Fatal("AppliedAt must be set")
	}

	// Deleted files must be gone.
	for _, name := range []string{"a.png", "b.png"} {
		if _, err := os.Stat(filepath.Join(root, "img", name)); !os.IsNotExist(err) {
			t.Fatalf("%s should have been deleted, err = %v", name, err)
		}
	}

	// Unselected file must survive.
	if _, err := os.Stat(filepath.Join(root, "img", "keep.png")); err != nil {
		t.Fatalf("keep.png should still exist: %v", err)
	}
}

func TestBatchDelete_PartialFailure(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "img", "exists.png"), "data")

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{ID: "id-exists", ProjectID: root, RepoPath: "img/exists.png"},
		{ID: "id-missing", ProjectID: root, RepoPath: "img/missing.png"},
	}

	result := BatchDelete(project, items)

	if len(result.Succeeded) != 1 || result.Succeeded[0] != "id-exists" {
		t.Fatalf("expected succeeded=[id-exists], got %v", result.Succeeded)
	}
	if len(result.Skipped) != 1 || result.Skipped[0] != "id-missing" {
		t.Fatalf("expected skipped=[id-missing], got %v", result.Skipped)
	}
	if len(result.Failed) != 0 {
		t.Fatalf("expected 0 failed, got %v", result.Failed)
	}
}

func TestBatchDelete_PathEscape(t *testing.T) {
	root := t.TempDir()

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{ID: "id-evil", ProjectID: root, RepoPath: "../../../etc/passwd"},
	}

	result := BatchDelete(project, items)

	if len(result.Failed) != 1 {
		t.Fatalf("expected 1 failed, got %d: %v", len(result.Failed), result.Failed)
	}
	if result.Failed[0].ID != "id-evil" {
		t.Fatalf("failed item ID = %q, want id-evil", result.Failed[0].ID)
	}
	if len(result.Succeeded) != 0 {
		t.Fatalf("expected 0 succeeded, got %v", result.Succeeded)
	}
	if len(result.Skipped) != 0 {
		t.Fatalf("expected 0 skipped, got %v", result.Skipped)
	}
}

package actions

import (
	"os"
	"path/filepath"
	"strings"
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

func TestBatchMovePreview(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "old", "a.png"), "aaa")
	mustWrite(t, filepath.Join(root, "old", "b.png"), "bbb")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import a from "../old/a.png"; import b from "../old/b.png"`)

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{
			ID:        "id-a",
			ProjectID: root,
			RepoPath:  "old/a.png",
			References: []scanner.AssetReference{{
				File: "src/App.tsx", Line: 1, Specifier: "../old/a.png", Kind: "string",
			}},
		},
		{
			ID:        "id-b",
			ProjectID: root,
			RepoPath:  "old/b.png",
			References: []scanner.AssetReference{{
				File: "src/App.tsx", Line: 1, Specifier: "../old/b.png", Kind: "string",
			}},
		},
	}

	preview := BatchMovePreview(project, items, "assets")

	if preview.Type != "batch-move" {
		t.Fatalf("type = %q, want batch-move", preview.Type)
	}
	if len(preview.Moves) != 2 {
		t.Fatalf("expected 2 moves, got %d", len(preview.Moves))
	}
	if preview.Moves[0].From != "old/a.png" || preview.Moves[0].To != "assets/a.png" {
		t.Fatalf("move[0] = %+v", preview.Moves[0])
	}
	if preview.Moves[1].From != "old/b.png" || preview.Moves[1].To != "assets/b.png" {
		t.Fatalf("move[1] = %+v", preview.Moves[1])
	}
	if len(preview.Changes) != 2 {
		t.Fatalf("expected 2 changes, got %d", len(preview.Changes))
	}
	if !preview.CanApply {
		t.Fatal("expected CanApply=true")
	}
	if len(preview.Blockers) != 0 {
		t.Fatalf("expected 0 blockers, got %v", preview.Blockers)
	}
}

func TestBatchMovePreview_TargetConflict(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "old", "a.png"), "aaa")
	// Pre-existing file at target location.
	mustWrite(t, filepath.Join(root, "assets", "a.png"), "conflict")

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{ID: "id-a", ProjectID: root, RepoPath: "old/a.png"},
	}

	preview := BatchMovePreview(project, items, "assets")

	if preview.CanApply {
		t.Fatal("expected CanApply=false due to target conflict")
	}
	if len(preview.Blockers) != 1 {
		t.Fatalf("expected 1 blocker, got %d: %v", len(preview.Blockers), preview.Blockers)
	}
	if preview.Blockers[0].Code != "target_already_exists" {
		t.Fatalf("blocker code = %q, want target_already_exists", preview.Blockers[0].Code)
	}
	if len(preview.Moves) != 0 {
		t.Fatalf("expected 0 moves when blocked, got %d", len(preview.Moves))
	}
}

func TestBatchApply_Move(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "old", "a.png"), "image-a")
	mustWrite(t, filepath.Join(root, "old", "b.png"), "image-b")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import a from "../old/a.png"; import b from "../old/b.png"`)

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{
			ID:        "id-a",
			ProjectID: root,
			RepoPath:  "old/a.png",
			References: []scanner.AssetReference{{
				File: "src/App.tsx", Line: 1, Specifier: "../old/a.png", Kind: "string",
			}},
		},
		{
			ID:        "id-b",
			ProjectID: root,
			RepoPath:  "old/b.png",
			References: []scanner.AssetReference{{
				File: "src/App.tsx", Line: 1, Specifier: "../old/b.png", Kind: "string",
			}},
		},
	}

	preview := BatchMovePreview(project, items, "assets")
	if !preview.CanApply {
		t.Fatalf("preview not applyable: blockers=%v", preview.Blockers)
	}

	result, err := BatchApply(project, preview)
	if err != nil {
		t.Fatal(err)
	}
	if result.MovedFiles != 2 {
		t.Fatalf("expected 2 moved files, got %d", result.MovedFiles)
	}
	if result.ChangedReferences != 2 {
		t.Fatalf("expected 2 changed references, got %d", result.ChangedReferences)
	}

	// Verify files moved.
	for _, name := range []string{"a.png", "b.png"} {
		if _, err := os.Stat(filepath.Join(root, "assets", name)); err != nil {
			t.Fatalf("assets/%s should exist: %v", name, err)
		}
		if _, err := os.Stat(filepath.Join(root, "old", name)); !os.IsNotExist(err) {
			t.Fatalf("old/%s should be gone, err=%v", name, err)
		}
	}

	// Verify references updated.
	content, _ := os.ReadFile(filepath.Join(root, "src", "App.tsx"))
	if !strings.Contains(string(content), "../assets/a.png") {
		t.Fatalf("expected reference to ../assets/a.png in content: %s", content)
	}
	if !strings.Contains(string(content), "../assets/b.png") {
		t.Fatalf("expected reference to ../assets/b.png in content: %s", content)
	}
}

func TestApplyRenameRules(t *testing.T) {
	tests := []struct {
		name  string
		input string
		rules RenameRules
		want  string
	}{
		{
			name:  "lowercase",
			input: "HERO.PNG",
			rules: RenameRules{Lowercase: true},
			want:  "hero.png",
		},
		{
			name:  "prefix",
			input: "icon.png",
			rules: RenameRules{Prefix: "app-"},
			want:  "app-icon.png",
		},
		{
			name:  "suffix before extension",
			input: "icon.png",
			rules: RenameRules{Suffix: "-v2"},
			want:  "icon-v2.png",
		},
		{
			name:  "replace chars",
			input: "my file (1).png",
			rules: RenameRules{ReplaceChars: map[string]string{" ": "_", "(": "", ")": ""}},
			want:  "my_file_1.png",
		},
		{
			name:  "all rules combined",
			input: "My Icon.PNG",
			rules: RenameRules{Lowercase: true, Prefix: "ic-", Suffix: "-24"},
			want:  "ic-my icon-24.png",
		},
		{
			name:  "no-op empty rules",
			input: "already-good.png",
			rules: RenameRules{},
			want:  "already-good.png",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := applyRenameRules(tc.input, tc.rules)
			if got != tc.want {
				t.Fatalf("applyRenameRules(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestBatchRenamePreview(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "img", "My Icon (1).png"), "icon1")
	mustWrite(t, filepath.Join(root, "img", "BANNER.PNG"), "banner")

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	items := []scanner.AssetItem{
		{ID: "id-icon", ProjectID: root, RepoPath: "img/My Icon (1).png"},
		{ID: "id-banner", ProjectID: root, RepoPath: "img/BANNER.PNG"},
	}
	rules := RenameRules{
		Lowercase:    true,
		ReplaceChars: map[string]string{" ": "_", "(": "", ")": ""},
		Prefix:       "icon-",
	}

	preview := BatchRenamePreview(project, items, rules)

	if preview.Type != "batch-rename" {
		t.Fatalf("type = %q, want batch-rename", preview.Type)
	}
	if len(preview.Moves) != 2 {
		t.Fatalf("expected 2 moves, got %d", len(preview.Moves))
	}

	// Verify the first move: "My Icon (1).png" → "icon-my_icon_1.png"
	if preview.Moves[0].From != "img/My Icon (1).png" {
		t.Fatalf("move[0].From = %q, want %q", preview.Moves[0].From, "img/My Icon (1).png")
	}
	if preview.Moves[0].To != "img/icon-my_icon_1.png" {
		t.Fatalf("move[0].To = %q, want %q", preview.Moves[0].To, "img/icon-my_icon_1.png")
	}

	// Verify the second move: "BANNER.PNG" → "icon-banner.png"
	if preview.Moves[1].From != "img/BANNER.PNG" {
		t.Fatalf("move[1].From = %q, want %q", preview.Moves[1].From, "img/BANNER.PNG")
	}
	if preview.Moves[1].To != "img/icon-banner.png" {
		t.Fatalf("move[1].To = %q, want %q", preview.Moves[1].To, "img/icon-banner.png")
	}

	if !preview.CanApply {
		t.Fatal("expected CanApply=true")
	}
	if len(preview.Blockers) != 0 {
		t.Fatalf("expected 0 blockers, got %v", preview.Blockers)
	}
}

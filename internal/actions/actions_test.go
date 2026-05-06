package actions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"asset-studio/internal/scanner"
)

func TestRenamePreviewApply(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "old.png"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import icon from "./old.png"`)

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	item := scanner.AssetItem{
		ProjectID: root,
		RepoPath:  "src/old.png",
		References: []scanner.AssetReference{{
			File:      "src/App.tsx",
			Line:      1,
			Specifier: "./old.png",
			Kind:      "string",
		}},
	}
	preview, err := RenamePreview(project, item, "src/new.png")
	if err != nil {
		t.Fatal(err)
	}
	if !preview.CanApply || len(preview.Changes) != 1 {
		t.Fatalf("preview = %#v", preview)
	}
	result, err := Apply(project, preview)
	if err != nil {
		t.Fatal(err)
	}
	if result.MovedFiles != 1 || result.ChangedReferences != 1 {
		t.Fatalf("result = %#v", result)
	}
	if _, err := os.Stat(filepath.Join(root, "src", "new.png")); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(filepath.Join(root, "src", "App.tsx"))
	if !strings.Contains(string(content), "./new.png") {
		t.Fatalf("updated content = %s", content)
	}
}

func TestApplyRejectsStalePreview(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "old.png"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import icon from "./old.png"`)

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	item := scanner.AssetItem{
		ProjectID: root,
		RepoPath:  "src/old.png",
		References: []scanner.AssetReference{{
			File:      "src/App.tsx",
			Line:      1,
			Specifier: "./old.png",
			Kind:      "string",
		}},
	}
	preview, err := RenamePreview(project, item, "src/new.png")
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import icon from "./changed.png"`)
	if _, err := Apply(project, preview); err == nil {
		t.Fatal("expected stale preview error")
	}
}

func TestPatternReferencesBlockApply(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "old.png"), "image")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), "const icon = `./${name}.png`")

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	item := scanner.AssetItem{
		ProjectID: root,
		RepoPath:  "src/old.png",
		References: []scanner.AssetReference{{
			File:      "src/App.tsx",
			Line:      1,
			Specifier: "./${name}.png",
			Kind:      "pattern",
		}},
	}
	preview, err := RenamePreview(project, item, "src/new.png")
	if err != nil {
		t.Fatal(err)
	}
	if preview.CanApply || len(preview.Blockers) != 1 {
		t.Fatalf("preview = %#v", preview)
	}
	if preview.Blockers[0].Code != "pattern_reference" {
		t.Fatalf("blocker code = %s", preview.Blockers[0].Code)
	}
	if _, err := Apply(project, preview); err == nil {
		t.Fatal("expected blocker apply error")
	}
}

func TestPathEscapeAttemptsFail(t *testing.T) {
	root := t.TempDir()
	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	item := scanner.AssetItem{ProjectID: root, RepoPath: "src/old.png"}
	preview, err := RenamePreview(project, item, "../escape.png")
	if err == nil {
		t.Fatal("expected invalid target error")
	}
	if preview.CanApply {
		t.Fatalf("preview = %#v", preview)
	}
}

func TestMergeAndDeleteApply(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "a.png"), "same")
	mustWrite(t, filepath.Join(root, "src", "b.png"), "same")
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import icon from "./b.png"`)

	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	duplicate := scanner.AssetItem{
		ProjectID: root,
		RepoPath:  "src/b.png",
		References: []scanner.AssetReference{{
			File:      "src/App.tsx",
			Line:      1,
			Specifier: "./b.png",
			Kind:      "string",
		}},
	}
	preview, err := MergePreview(project, duplicate, "src/a.png")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Apply(project, preview)
	if err != nil {
		t.Fatal(err)
	}
	if result.DeletedFiles != 1 || result.ChangedReferences != 1 {
		t.Fatalf("merge result = %#v", result)
	}
	if _, err := os.Stat(filepath.Join(root, "src", "b.png")); !os.IsNotExist(err) {
		t.Fatalf("duplicate still exists: %v", err)
	}
	content, _ := os.ReadFile(filepath.Join(root, "src", "App.tsx"))
	if !strings.Contains(string(content), "./a.png") {
		t.Fatalf("updated content = %s", content)
	}

	unused := scanner.AssetItem{ProjectID: root, RepoPath: "src/a.png"}
	deletePreview := DeleteUnusedPreview(unused)
	result, err = Apply(project, deletePreview)
	if err != nil {
		t.Fatal(err)
	}
	if result.DeletedFiles != 1 {
		t.Fatalf("delete result = %#v", result)
	}
}

func TestDeleteUnusedPreviewKeepsUsedAssetsBlocked(t *testing.T) {
	preview := DeleteUnusedPreview(scanner.AssetItem{ProjectID: "p", RepoPath: "src/a.png", UsedBy: []string{"src/App.tsx"}})
	if preview.CanApply || len(preview.Deletes) != 1 || preview.Type != "delete-unused" {
		t.Fatalf("delete preview = %#v", preview)
	}
}

func TestApplyRejectsExistingRenameTarget(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "old.png"), "old")
	mustWrite(t, filepath.Join(root, "src", "new.png"), "new")
	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	preview := Preview{
		Type:      "rename",
		ProjectID: root,
		CanApply:  true,
		Payload: map[string]any{
			"sourcePath": "src/old.png",
			"targetPath": "src/new.png",
		},
	}
	_, err := Apply(project, preview)
	if err == nil || !strings.Contains(err.Error(), "target already exists") {
		t.Fatalf("Apply existing target err = %v", err)
	}
}

func TestReferenceChangesBlockUnreadableAndEscapingReferences(t *testing.T) {
	root := t.TempDir()
	project := scanner.Project{ID: root, Name: "fixture", Path: root}
	item := scanner.AssetItem{References: []scanner.AssetReference{
		{File: "src/missing.tsx", Line: 1, Specifier: "./old.png", Kind: "string"},
		{File: "../escape.tsx", Line: 2, Specifier: "./old.png", Kind: "string"},
	}}

	changes, blockers := referenceChanges(project, item, "src/new.png")
	if len(changes) != 0 || len(blockers) != 2 {
		t.Fatalf("changes=%#v blockers=%#v", changes, blockers)
	}
	if blockers[0].Code != "reference_file_unreadable" || blockers[1].Code != "empty_path" {
		t.Fatalf("blockers = %#v", blockers)
	}
}

func TestPathAndSpecifierHelpers(t *testing.T) {
	if got := relativeSpecifier("src/components/App.tsx", "src/assets/icon.png"); got != "../assets/icon.png" {
		t.Fatalf("relativeSpecifier nested = %q", got)
	}
	for _, invalid := range []string{"", "../escape.png", "/absolute.png", "."} {
		if got := cleanRepoPath(invalid); got != "" {
			t.Fatalf("cleanRepoPath(%q) = %q", invalid, got)
		}
	}
	if got := actionErrorCode(os.ErrNotExist); got != "action_error" {
		t.Fatalf("actionErrorCode generic = %q", got)
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

//go:build darwin || linux || freebsd || openbsd || netbsd

package optimize

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"aisets/internal/actions"
	"aisets/internal/scanner"
)

func TestApplyOptimizationNormalizesOutputModeUnderRestrictiveUmask(t *testing.T) {
	root := t.TempDir()
	imagePath := filepath.Join(root, "src", "photo.png")
	if err := os.MkdirAll(filepath.Dir(imagePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	candidatePath := filepath.Join(root, "candidate.avif")
	if err := os.WriteFile(candidatePath, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(root, "src", "app.tsx")
	if err := os.WriteFile(sourcePath, []byte(`import photo from "./photo.png";`), 0o644); err != nil {
		t.Fatal(err)
	}

	oldUmask := syscall.Umask(0o077)
	t.Cleanup(func() { syscall.Umask(oldUmask) })

	project := scanner.Project{ID: "p", Name: "web", Path: root, ScanIntent: scanner.ProjectScanIntentCode}
	preview := actions.Preview{
		ID:        "optimization-permissions-test",
		Type:      "optimization",
		ProjectID: "p",
		Changes: []actions.Change{{
			File:         "src/app.tsx",
			Line:         1,
			OldSpecifier: "./photo.png",
			NewSpecifier: "./photo.avif",
		}},
		Deletes:  []string{"src/photo.png"},
		CanApply: true,
		Payload: map[string]any{"optimization": PreviewResult{Operations: []Operation{{
			AssetID:       "a",
			RepoPath:      "src/photo.png",
			TargetPath:    "src/photo.avif",
			CandidatePath: candidatePath,
			CanApply:      true,
		}}}},
	}
	if _, err := Apply(project, preview); err != nil {
		t.Fatal(err)
	}

	targetPath := filepath.Join(root, "src", "photo.avif")
	info, err := os.Stat(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o644 {
		t.Fatalf("mode = %04o, want 0644", got)
	}
	bytes, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(bytes), `import photo from "./photo.avif";`) {
		t.Fatalf("source was not updated: %s", string(bytes))
	}
}

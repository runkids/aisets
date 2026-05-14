package agentchat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStageSkillCopiesFilesWithoutSymlinkWriteThrough(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "skills", "aisets-assistant")
	if err := os.MkdirAll(filepath.Join(source, "references"), 0o755); err != nil {
		t.Fatal(err)
	}
	sourceSkill := filepath.Join(source, "SKILL.md")
	if err := os.WriteFile(sourceSkill, []byte("source skill"), 0o644); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(source, "references", "duplicate-policy.md")
	if err := os.WriteFile(target, []byte("duplicate policy"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(source, "references", "policy-link.md")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	runDir := filepath.Join(root, "runs", "run-1")
	staged, err := StageSkill(runDir, "aisets-assistant", source)
	if err != nil {
		t.Fatalf("StageSkill error: %v", err)
	}
	stagedSkill := filepath.Join(staged, "SKILL.md")
	if data, err := os.ReadFile(stagedSkill); err != nil || string(data) != "source skill" {
		t.Fatalf("staged skill = %q, err=%v", data, err)
	}
	linkInfo, err := os.Lstat(filepath.Join(staged, "references", "policy-link.md"))
	if err != nil {
		t.Fatal(err)
	}
	if linkInfo.Mode()&os.ModeSymlink != 0 {
		t.Fatal("staged symlink should be copied as a regular file")
	}
	if err := os.WriteFile(stagedSkill, []byte("mutated staged copy"), 0o644); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(sourceSkill); err != nil || string(data) != "source skill" {
		t.Fatalf("source skill was mutated through staged copy: %q err=%v", data, err)
	}
}

func TestValidateRunDirRejectsProjectRoot(t *testing.T) {
	root := t.TempDir()
	if err := ValidateRunDir(root, root); err == nil {
		t.Fatal("expected project root to be rejected as run dir")
	}
	if err := ValidateRunDir(root, filepath.Join(root, ".aisets", "agent-runs", "run-1")); err != nil {
		t.Fatalf("nested run dir should be accepted: %v", err)
	}
}

func TestBuildThinPromptReferencesSkillFilesWithoutInliningPolicies(t *testing.T) {
	prompt := BuildThinPrompt("rank risky unused assets")
	for _, want := range []string{
		".aisets-skills/aisets-assistant/SKILL.md",
		"context.md",
		"catalog-summary.json",
		".aisets-skills/aisets-assistant/references/",
		"rank risky unused assets",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("thin prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "duplicate-policy") || strings.Contains(prompt, "unused-policy") {
		t.Fatalf("thin prompt should not inline reference policy names:\n%s", prompt)
	}
}

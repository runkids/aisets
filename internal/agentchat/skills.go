package agentchat

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const SkillAliasRoot = ".aisets-skills"

func ValidateRunDir(projectRoot, runDir string) error {
	projectRoot = filepath.Clean(projectRoot)
	runDir = filepath.Clean(runDir)
	if projectRoot == "" || runDir == "" {
		return errors.New("project root and run dir are required")
	}
	projectAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		return err
	}
	runAbs, err := filepath.Abs(runDir)
	if err != nil {
		return err
	}
	if projectAbs == runAbs {
		return fmt.Errorf("agent run dir must not be the project root: %s", runAbs)
	}
	return nil
}

func StageSkill(runDir, skillID, sourceDir string) (string, error) {
	if !safeSkillID(skillID) {
		return "", fmt.Errorf("unsafe skill id: %q", skillID)
	}
	sourceInfo, err := os.Stat(sourceDir)
	if err != nil {
		return "", err
	}
	if !sourceInfo.IsDir() {
		return "", fmt.Errorf("skill source is not a directory: %s", sourceDir)
	}
	dest := filepath.Join(runDir, SkillAliasRoot, skillID)
	if err := os.RemoveAll(dest); err != nil {
		return "", err
	}
	if err := copySkillDir(sourceDir, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func BuildThinPrompt(userRequest string) string {
	userRequest = strings.TrimSpace(userRequest)
	if userRequest == "" {
		userRequest = "(No extra typed instruction.)"
	}
	return fmt.Sprintf(`# Aisets Assistant Run

You are helping audit image assets safely.

Before answering, read:
- %s/aisets-assistant/SKILL.md
- context.md
- catalog-summary.json

Safety:
- Do not modify original project files.
- Do not claim an unused asset is safe to delete without risk caveats.
- Destructive changes must go through Aisets preview/apply flow.
- If you need more policy detail, read the referenced files under %s/aisets-assistant/references/.

# User request

%s`, SkillAliasRoot, SkillAliasRoot, userRequest)
}

func safeSkillID(id string) bool {
	if id == "" || id == "." || id == ".." {
		return false
	}
	return !strings.ContainsAny(id, `/\`+"\x00")
}

func copySkillDir(sourceDir, destDir string) error {
	return filepath.WalkDir(sourceDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(destDir, 0o755)
		}
		dest := filepath.Join(destDir, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return copySkillSymlinkTarget(path, dest)
		}
		if info.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copySkillFile(path, dest, info.Mode().Perm())
	})
}

func copySkillSymlinkTarget(path, dest string) error {
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	info, err := os.Stat(target)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return filepath.WalkDir(target, func(child string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel, err := filepath.Rel(target, child)
			if err != nil {
				return err
			}
			childDest := filepath.Join(dest, rel)
			childInfo, err := entry.Info()
			if err != nil {
				return err
			}
			if childInfo.IsDir() {
				return os.MkdirAll(childDest, 0o755)
			}
			if !childInfo.Mode().IsRegular() {
				return nil
			}
			return copySkillFile(child, childDest, childInfo.Mode().Perm())
		})
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	return copySkillFile(target, dest, info.Mode().Perm())
}

func copySkillFile(source, dest string, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

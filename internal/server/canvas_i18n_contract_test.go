package server

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

var productionCJKTextRe = regexp.MustCompile(`[一-龯ぁ-ゟァ-ヿ가-힣]`)

func TestProductionCodeAvoidsHardcodedCJKDisplayText(t *testing.T) {
	root := repoRootForCJKContractTest(t)
	var violations []string

	for _, dir := range []string{"internal", "ui/src"} {
		start := filepath.Join(root, dir)
		err := filepath.WalkDir(start, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			if entry.IsDir() {
				if rel == "ui/src/i18n/locales" {
					return filepath.SkipDir
				}
				return nil
			}
			if !shouldScanProductionCodeForCJK(rel) {
				return nil
			}
			fileViolations, err := hardcodedCJKViolations(path, rel)
			if err != nil {
				return err
			}
			violations = append(violations, fileViolations...)
			return nil
		})
		if err != nil {
			t.Fatalf("scan production code: %v", err)
		}
	}

	if len(violations) > 0 {
		t.Fatalf("production code contains hardcoded CJK display text; use i18n/display data or add a narrow intentional-data exception:\n%s", strings.Join(violations, "\n"))
	}
}

func repoRootForCJKContractTest(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		next := filepath.Dir(dir)
		if next == dir {
			t.Fatal("could not find repo root from working directory")
		}
		dir = next
	}
}

func shouldScanProductionCodeForCJK(rel string) bool {
	if strings.HasSuffix(rel, "_test.go") ||
		strings.HasSuffix(rel, ".test.ts") ||
		strings.HasSuffix(rel, ".test.tsx") {
		return false
	}
	switch filepath.Ext(rel) {
	case ".go", ".ts", ".tsx":
		return true
	default:
		return false
	}
}

func hardcodedCJKViolations(path string, rel string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(data), "\n")
	var violations []string
	inSemanticPhases := false
	for idx, line := range lines {
		if strings.Contains(line, "SEMANTIC_PHASES") {
			inSemanticPhases = true
		}
		if productionCJKTextRe.MatchString(line) && !allowedProductionCJKLine(rel, line, inSemanticPhases) {
			violations = append(violations, rel+":"+strconv.Itoa(idx+1)+": "+strings.TrimSpace(line))
		}
		if inSemanticPhases && strings.Contains(line, "] as const") {
			inSemanticPhases = false
		}
	}
	return violations, nil
}

func allowedProductionCJKLine(rel string, line string, inSemanticPhases bool) bool {
	if inSemanticPhases {
		return true
	}
	switch rel {
	case "internal/aitag/types.go",
		"internal/llm/sanitize.go":
		return strings.Contains(line, `"zh-`) ||
			strings.Contains(line, `"ja"`) ||
			strings.Contains(line, `"ko"`)
	case "internal/config/catalog_filters.go":
		return strings.Contains(line, "case ") || strings.Contains(line, "add(")
	case "ui/src/features/settings/aiSectionUtils.ts",
		"ui/src/features/tags/tagViewLocale.ts",
		"ui/src/i18n/languageOptions.ts":
		return strings.Contains(line, "label:")
	case "internal/server/canvas_chat_handler.go":
		return strings.Contains(line, "regexp.MustCompile")
	case "internal/server/canvas_chat_types.go":
		return strings.Contains(line, "TextRe = regexp.MustCompile")
	case "ui/src/features/ai-canvas/useCanvasCapture.ts":
		return strings.Contains(line, "paragraph.split(")
	default:
		return false
	}
}

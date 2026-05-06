package actions

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
)

type Preview struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	ProjectID string         `json:"projectId"`
	Changes   []Change       `json:"changes"`
	Deletes   []string       `json:"deletes"`
	Blockers  []Blocker      `json:"blockers"`
	CanApply  bool           `json:"canApply"`
	CreatedAt string         `json:"createdAt"`
	Payload   map[string]any `json:"payload"`
}

type Change struct {
	File         string `json:"file"`
	Line         int    `json:"line"`
	OldSpecifier string `json:"oldSpecifier"`
	NewSpecifier string `json:"newSpecifier"`
}

type Blocker struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

type ApplyResult struct {
	AppliedAt         string `json:"appliedAt"`
	ChangedReferences int    `json:"changedReferences"`
	DeletedFiles      int    `json:"deletedFiles"`
	MovedFiles        int    `json:"movedFiles"`
}

func RenamePreview(project scanner.Project, item scanner.AssetItem, targetPath string) (Preview, error) {
	targetPath = cleanRepoPath(targetPath)
	if targetPath == "" {
		return Preview{}, apierr.New("target_path_required", "target path is required")
	}
	changes, blockers := referenceChanges(project, item, targetPath)
	preview := Preview{
		ID:        newID("rename:" + item.ProjectID + ":" + item.RepoPath + ":" + targetPath),
		Type:      "rename",
		ProjectID: item.ProjectID,
		Changes:   changes,
		Blockers:  blockers,
		CanApply:  len(blockers) == 0,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{
			"sourcePath": item.RepoPath,
			"targetPath": targetPath,
		},
	}
	return preview, nil
}

func MergePreview(project scanner.Project, item scanner.AssetItem, preferredPath string) (Preview, error) {
	preferredPath = cleanRepoPath(preferredPath)
	changes, blockers := referenceChanges(project, item, preferredPath)
	preview := Preview{
		ID:        newID("merge:" + item.ProjectID + ":" + item.RepoPath + ":" + preferredPath),
		Type:      "merge",
		ProjectID: item.ProjectID,
		Changes:   changes,
		Deletes:   []string{item.RepoPath},
		Blockers:  blockers,
		CanApply:  len(blockers) == 0,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{
			"sourcePath":    item.RepoPath,
			"preferredPath": preferredPath,
		},
	}
	return preview, nil
}

func DeleteUnusedPreview(item scanner.AssetItem) Preview {
	return Preview{
		ID:        newID("delete:" + item.ProjectID + ":" + item.RepoPath),
		Type:      "delete-unused",
		ProjectID: item.ProjectID,
		Deletes:   []string{item.RepoPath},
		CanApply:  len(item.UsedBy) == 0,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{
			"sourcePath": item.RepoPath,
		},
	}
}

func Apply(project scanner.Project, preview Preview) (ApplyResult, error) {
	if !preview.CanApply {
		return ApplyResult{}, apierr.New("preview_has_blockers", "preview has blockers")
	}
	for _, change := range preview.Changes {
		abs, err := safeAbs(project.Path, change.File)
		if err != nil {
			return ApplyResult{}, err
		}
		bytes, err := os.ReadFile(abs)
		if err != nil {
			return ApplyResult{}, err
		}
		content := string(bytes)
		if !strings.Contains(content, change.OldSpecifier) {
			return ApplyResult{}, apierr.WithParams("preview_stale_missing_specifier", "preview is stale: missing old specifier", map[string]any{"file": change.File})
		}
	}

	for _, change := range preview.Changes {
		abs, err := safeAbs(project.Path, change.File)
		if err != nil {
			return ApplyResult{}, err
		}
		bytes, err := os.ReadFile(abs)
		if err != nil {
			return ApplyResult{}, err
		}
		next := strings.ReplaceAll(string(bytes), change.OldSpecifier, change.NewSpecifier)
		if err := os.WriteFile(abs, []byte(next), 0o644); err != nil {
			return ApplyResult{}, err
		}
	}

	result := ApplyResult{AppliedAt: time.Now().UTC().Format(time.RFC3339), ChangedReferences: len(preview.Changes)}
	if preview.Type == "rename" {
		source, _ := preview.Payload["sourcePath"].(string)
		target, _ := preview.Payload["targetPath"].(string)
		sourceAbs, err := safeAbs(project.Path, source)
		if err != nil {
			return ApplyResult{}, err
		}
		targetAbs, err := safeAbs(project.Path, target)
		if err != nil {
			return ApplyResult{}, err
		}
		if _, err := os.Stat(targetAbs); err == nil {
			return ApplyResult{}, apierr.WithParams("target_already_exists", "target already exists", map[string]any{"targetPath": target})
		}
		if err := os.MkdirAll(filepath.Dir(targetAbs), 0o755); err != nil {
			return ApplyResult{}, err
		}
		if err := os.Rename(sourceAbs, targetAbs); err != nil {
			return ApplyResult{}, err
		}
		result.MovedFiles = 1
		return result, nil
	}
	for _, deletePath := range preview.Deletes {
		abs, err := safeAbs(project.Path, deletePath)
		if err != nil {
			return ApplyResult{}, err
		}
		if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
			return ApplyResult{}, err
		}
		result.DeletedFiles++
	}
	return result, nil
}

func referenceChanges(project scanner.Project, item scanner.AssetItem, targetPath string) ([]Change, []Blocker) {
	var changes []Change
	var blockers []Blocker
	for _, ref := range item.References {
		if ref.Kind == "pattern" {
			blockers = append(blockers, blocker(ref.File, ref.Line, "pattern_reference", "Pattern reference cannot be safely rewritten."))
			continue
		}
		abs, err := safeAbs(project.Path, ref.File)
		if err != nil {
			blockers = append(blockers, blocker(ref.File, ref.Line, actionErrorCode(err), err.Error()))
			continue
		}
		bytes, err := os.ReadFile(abs)
		if err != nil {
			blockers = append(blockers, blocker(ref.File, ref.Line, "reference_file_unreadable", err.Error()))
			continue
		}
		if !strings.Contains(string(bytes), ref.Specifier) {
			blockers = append(blockers, blocker(ref.File, ref.Line, "reference_specifier_missing", "Referenced specifier was not found."))
			continue
		}
		changes = append(changes, Change{
			File:         ref.File,
			Line:         ref.Line,
			OldSpecifier: ref.Specifier,
			NewSpecifier: relativeSpecifier(ref.File, targetPath),
		})
	}
	return changes, blockers
}

func relativeSpecifier(importerRepoPath, targetRepoPath string) string {
	from := filepath.Dir(filepath.FromSlash(importerRepoPath))
	rel, err := filepath.Rel(from, filepath.FromSlash(targetRepoPath))
	if err != nil {
		return filepath.ToSlash(targetRepoPath)
	}
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, ".") {
		rel = "./" + rel
	}
	return rel
}

func safeAbs(root, repoPath string) (string, error) {
	repoPath = cleanRepoPath(repoPath)
	if repoPath == "" {
		return "", apierr.New("empty_path", "empty path")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	abs := filepath.Join(absRoot, filepath.FromSlash(repoPath))
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	if abs != absRoot && !strings.HasPrefix(abs, absRoot+string(filepath.Separator)) {
		return "", apierr.New("path_escapes_project_root", "path escapes project root")
	}
	return abs, nil
}

func blocker(file string, line int, code, reason string) Blocker {
	return Blocker{File: file, Line: line, Code: code, Reason: reason}
}

func actionErrorCode(err error) string {
	if coded, ok := err.(apierr.Error); ok {
		return coded.Code
	}
	return "action_error"
}

func cleanRepoPath(path string) string {
	path = filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
	path = strings.TrimPrefix(path, "./")
	if path == "." || strings.HasPrefix(path, "../") || strings.HasPrefix(path, "/") {
		return ""
	}
	return path
}

func newID(seed string) string {
	return scannerID(seed + ":" + time.Now().UTC().Format(time.RFC3339Nano))
}

func scannerID(seed string) string {
	const hex = "0123456789abcdef"
	var h uint64 = 1469598103934665603
	for i := 0; i < len(seed); i++ {
		h ^= uint64(seed[i])
		h *= 1099511628211
	}
	out := make([]byte, 12)
	for i := range out {
		out[i] = hex[(h>>uint((i%8)*8))&0xf]
	}
	return string(out)
}

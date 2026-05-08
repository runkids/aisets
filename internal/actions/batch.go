package actions

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"asset-studio/internal/apierr"
	"asset-studio/internal/scanner"
)

// RenameRules defines how to transform file names in a batch rename.
type RenameRules struct {
	Lowercase    bool              `json:"lowercase,omitempty"`
	ReplaceChars map[string]string `json:"replaceChars,omitempty"`
	Prefix       string            `json:"prefix,omitempty"`
	Suffix       string            `json:"suffix,omitempty"`
}

// BatchDeleteResult holds the outcome of a batch delete operation.
type BatchDeleteResult struct {
	Succeeded []string          `json:"succeeded"`
	Failed    []BatchFailedItem `json:"failed"`
	Skipped   []string          `json:"skipped"`
	AppliedAt string            `json:"appliedAt"`
}

// BatchFailedItem records an item that could not be deleted.
type BatchFailedItem struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

// BatchMoveEntry records a single source→target file move.
type BatchMoveEntry struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// BatchPreview holds the preview for a batch move/merge operation.
type BatchPreview struct {
	ID        string           `json:"id"`
	Type      string           `json:"type"`
	ProjectID string           `json:"projectId"`
	Moves     []BatchMoveEntry `json:"moves"`
	Changes   []Change         `json:"changes"`
	Deletes   []string         `json:"deletes,omitempty"`
	Blockers  []Blocker        `json:"blockers"`
	CanApply  bool             `json:"canApply"`
	CreatedAt string           `json:"createdAt"`
}

// BatchMovePreview generates a preview for moving multiple assets into targetDir.
func BatchMovePreview(project scanner.Project, items []scanner.AssetItem, targetDir string) BatchPreview {
	preview := BatchPreview{
		ID:        newID("batch-move:" + project.ID + ":" + targetDir),
		Type:      "batch-move",
		ProjectID: project.ID,
		Moves:     []BatchMoveEntry{},
		Changes:   []Change{},
		Blockers:  []Blocker{},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	for _, item := range items {
		newPath := filepath.ToSlash(filepath.Join(targetDir, filepath.Base(item.RepoPath)))
		targetAbs, err := safeAbs(project.Path, newPath)
		if err != nil {
			preview.Blockers = append(preview.Blockers, blocker(item.RepoPath, 0, actionErrorCode(err), err.Error()))
			continue
		}
		if _, err := os.Stat(targetAbs); err == nil {
			preview.Blockers = append(preview.Blockers, blocker(item.RepoPath, 0, "target_already_exists", "target file already exists: "+newPath))
			continue
		}
		changes, blockers := referenceChanges(project, item, newPath)
		preview.Moves = append(preview.Moves, BatchMoveEntry{From: item.RepoPath, To: newPath})
		preview.Changes = append(preview.Changes, changes...)
		preview.Blockers = append(preview.Blockers, blockers...)
	}
	preview.CanApply = len(preview.Blockers) == 0 && len(preview.Moves) > 0
	return preview
}

// BatchMergePreview generates a preview for merging multiple duplicate assets.
// Each item's references are rewritten to its group's preferred path, and the
// item itself is marked for deletion.
func BatchMergePreview(project scanner.Project, items []scanner.AssetItem, preferredPaths map[string]string) BatchPreview {
	preview := BatchPreview{
		ID:        newID("batch-merge:" + project.ID),
		Type:      "batch-merge",
		ProjectID: project.ID,
		Moves:     []BatchMoveEntry{},
		Changes:   []Change{},
		Blockers:  []Blocker{},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	for _, item := range items {
		groupID := ""
		if item.DuplicateGroupID != nil {
			groupID = *item.DuplicateGroupID
		}
		preferred, ok := preferredPaths[groupID]
		if !ok || preferred == "" {
			preview.Blockers = append(preview.Blockers, blocker(item.RepoPath, 0, "missing_preferred_path", "no preferred path for duplicate group"))
			continue
		}
		preferred = cleanRepoPath(preferred)
		if preferred == item.RepoPath {
			continue
		}
		changes, blockers := referenceChanges(project, item, preferred)
		preview.Changes = append(preview.Changes, changes...)
		preview.Blockers = append(preview.Blockers, blockers...)
		preview.Deletes = append(preview.Deletes, item.RepoPath)
	}
	preview.CanApply = len(preview.Blockers) == 0 && (len(preview.Deletes) > 0 || len(preview.Changes) > 0)
	return preview
}

// BatchApply applies a batch move preview: updates references then moves files.
func BatchApply(project scanner.Project, preview BatchPreview) (ApplyResult, error) {
	if !preview.CanApply {
		return ApplyResult{}, apierr.New("preview_has_blockers", "preview has blockers")
	}

	// Staleness check: verify all old specifiers still exist in source files.
	for _, change := range preview.Changes {
		abs, err := safeAbs(project.Path, change.File)
		if err != nil {
			return ApplyResult{}, err
		}
		bytes, err := os.ReadFile(abs)
		if err != nil {
			return ApplyResult{}, err
		}
		if !strings.Contains(string(bytes), change.OldSpecifier) {
			return ApplyResult{}, apierr.WithParams("preview_stale_missing_specifier", "preview is stale: missing old specifier", map[string]any{"file": change.File})
		}
	}

	// Apply reference changes.
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

	// Move files.
	for _, move := range preview.Moves {
		srcAbs, err := safeAbs(project.Path, move.From)
		if err != nil {
			return ApplyResult{}, err
		}
		dstAbs, err := safeAbs(project.Path, move.To)
		if err != nil {
			return ApplyResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(dstAbs), 0o755); err != nil {
			return ApplyResult{}, err
		}
		if err := os.Rename(srcAbs, dstAbs); err != nil {
			return ApplyResult{}, err
		}
	}

	// Delete files (for batch merge).
	for _, del := range preview.Deletes {
		abs, err := safeAbs(project.Path, del)
		if err != nil {
			return ApplyResult{}, err
		}
		if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
			return ApplyResult{}, err
		}
	}

	return ApplyResult{
		AppliedAt:         time.Now().UTC().Format(time.RFC3339),
		ChangedReferences: len(preview.Changes),
		DeletedFiles:      len(preview.Deletes),
		MovedFiles:        len(preview.Moves),
	}, nil
}

// applyRenameRules transforms a filename according to the rules.
// Order: replaceChars → lowercase → prefix → suffix. Suffix is inserted before extension.
func applyRenameRules(name string, rules RenameRules) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)

	for old, repl := range rules.ReplaceChars {
		base = strings.ReplaceAll(base, old, repl)
	}
	if rules.Lowercase {
		base = strings.ToLower(base)
		ext = strings.ToLower(ext)
	}
	base = rules.Prefix + base + rules.Suffix
	return base + ext
}

// BatchRenamePreview generates a preview for renaming multiple assets by rules.
func BatchRenamePreview(project scanner.Project, items []scanner.AssetItem, rules RenameRules) BatchPreview {
	preview := BatchPreview{
		ID:        newID("batch-rename:" + project.ID),
		Type:      "batch-rename",
		ProjectID: project.ID,
		Moves:     []BatchMoveEntry{},
		Changes:   []Change{},
		Blockers:  []Blocker{},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	for _, item := range items {
		dir := filepath.Dir(item.RepoPath)
		oldName := filepath.Base(item.RepoPath)
		newName := applyRenameRules(oldName, rules)
		if newName == oldName {
			continue
		}

		newPath := filepath.Join(dir, newName)
		if dir == "." {
			newPath = newName
		}

		targetAbs, err := safeAbs(project.Path, newPath)
		if err != nil {
			preview.Blockers = append(preview.Blockers, blocker(item.RepoPath, 0, actionErrorCode(err), err.Error()))
			continue
		}
		if _, err := os.Stat(targetAbs); err == nil && newPath != item.RepoPath {
			preview.Blockers = append(preview.Blockers, blocker(item.RepoPath, 0, "target_already_exists", "Target file already exists: "+newPath))
			continue
		}

		preview.Moves = append(preview.Moves, BatchMoveEntry{From: item.RepoPath, To: newPath})

		changes, blockers := referenceChanges(project, item, newPath)
		preview.Changes = append(preview.Changes, changes...)
		preview.Blockers = append(preview.Blockers, blockers...)
	}

	preview.CanApply = len(preview.Blockers) == 0 && len(preview.Moves) > 0
	return preview
}

// BatchCopyResult holds the outcome of a batch copy operation.
type BatchCopyResult struct {
	Succeeded []string          `json:"succeeded"`
	Failed    []BatchFailedItem `json:"failed"`
	Skipped   []string          `json:"skipped"`
	AppliedAt string            `json:"appliedAt"`
}

// BatchCopy copies the given asset files into targetDir, preserving original filenames.
func BatchCopy(project scanner.Project, items []scanner.AssetItem, targetDir string) BatchCopyResult {
	result := BatchCopyResult{AppliedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, item := range items {
		newPath := filepath.ToSlash(filepath.Join(targetDir, filepath.Base(item.RepoPath)))
		srcAbs, err := safeAbs(project.Path, item.RepoPath)
		if err != nil {
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		dstAbs, err := safeAbs(project.Path, newPath)
		if err != nil {
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		if _, err := os.Stat(dstAbs); err == nil {
			result.Skipped = append(result.Skipped, item.ID)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dstAbs), 0o755); err != nil {
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		if err := copyFile(srcAbs, dstAbs); err != nil {
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		result.Succeeded = append(result.Succeeded, item.ID)
	}
	return result
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

// BatchDelete removes the given asset files from disk, classifying each
// outcome as succeeded, skipped (already absent), or failed (path escape,
// permission error, etc.).
func BatchDelete(project scanner.Project, items []scanner.AssetItem) BatchDeleteResult {
	result := BatchDeleteResult{AppliedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, item := range items {
		abs, err := safeAbs(project.Path, item.RepoPath)
		if err != nil {
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		if err := os.Remove(abs); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				result.Skipped = append(result.Skipped, item.ID)
				continue
			}
			result.Failed = append(result.Failed, BatchFailedItem{ID: item.ID, Error: err.Error()})
			continue
		}
		result.Succeeded = append(result.Succeeded, item.ID)
	}
	return result
}

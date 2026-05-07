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

// BatchPreview holds the preview for a batch move operation.
type BatchPreview struct {
	ID        string           `json:"id"`
	Type      string           `json:"type"`
	ProjectID string           `json:"projectId"`
	Moves     []BatchMoveEntry `json:"moves"`
	Changes   []Change         `json:"changes"`
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

	return ApplyResult{
		AppliedAt:         time.Now().UTC().Format(time.RFC3339),
		ChangedReferences: len(preview.Changes),
		MovedFiles:        len(preview.Moves),
	}, nil
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

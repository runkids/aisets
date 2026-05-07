package actions

import (
	"errors"
	"os"
	"time"

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

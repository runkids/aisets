package config

import (
	"strconv"

	"aisets/internal/scanner"
)

const catalogAssetSelectColumns = `
	a.scan_id, a.asset_id, a.project_id, a.project_name, a.repo_path, a.local_path, a.ext,
	a.bytes, COALESCE(a.modified_unix, 0), COALESCE(a.content_hash, ''), COALESCE(a.hash_algorithm, ''), COALESCE(a.format, ''),
	a.width, a.height, a.animated, a.alpha, a.pages, COALESCE(a.dhash, ''), COALESCE(a.dhash_flipped, ''),
	a.used_count, COALESCE(a.scan_intent, 'code'), COALESCE(a.usage_classification, 'notApplicable'),
	COALESCE(a.delete_unused_allowed, 0), COALESCE(a.lint_applicability, 'advisory'),
	COALESCE(a.optimize_applicability, 'applicable'),
	COALESCE(d.group_id, ''), COALESCE(g.preferred_path, '')
`

type assetRowScanner interface {
	Scan(dest ...any) error
}

func scanAssetFromRow(row assetRowScanner) (scanner.AssetItem, error) {
	var item scanner.AssetItem
	var scanID int64
	var animated, alpha int
	var usedCount int
	var deleteUnusedAllowed int
	var groupID, preferredPath string
	err := row.Scan(&scanID, &item.ID, &item.ProjectID, &item.ProjectName, &item.RepoPath, &item.LocalPath, &item.Ext,
		&item.Bytes, &item.ModifiedUnix, &item.ContentHash, &item.HashAlgorithm, &item.Image.Format, &item.Image.Width, &item.Image.Height,
		&animated, &alpha, &item.Image.Pages, &item.DHash, &item.DHashFlipped, &usedCount, &item.ScanIntent,
		&item.UsageClassification, &deleteUnusedAllowed, &item.LintApplicability, &item.OptimizeApplicability,
		&groupID, &preferredPath)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	item.Image.Animated = animated != 0
	item.Image.Alpha = alpha != 0
	item.URL = catalogAssetURL("assets", item.ID, scanID, item.ContentHash)
	item.ThumbnailURL = catalogAssetURL("thumbs", item.ID, scanID, item.ContentHash)
	item.DeleteUnusedAllowed = deleteUnusedAllowed != 0
	item.UsedBy = make([]string, usedCount)
	item.References = []scanner.AssetReference{}
	item.Duplicates = []string{}
	item.Similar = []string{}
	item.Optimization = []scanner.OptimizationSuggestion{}
	if groupID != "" {
		item.DuplicateGroupID = &groupID
	}
	if preferredPath != "" {
		item.PreferredDuplicatePath = &preferredPath
	}
	return item, nil
}

func catalogAssetURL(kind, id string, scanID int64, contentHash string) string {
	base := "/api/" + kind + "/" + id
	version := contentHash
	if version == "" && scanID > 0 {
		version = strconv.FormatInt(scanID, 10)
	}
	if version == "" {
		return base
	}
	return base + "?v=" + version
}

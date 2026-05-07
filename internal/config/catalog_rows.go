package config

import "asset-studio/internal/scanner"

type assetRowScanner interface {
	Scan(dest ...any) error
}

func scanAssetFromRow(row assetRowScanner) (scanner.AssetItem, error) {
	var item scanner.AssetItem
	var animated, alpha int
	var usedCount, optCount int
	var groupID, preferredPath string
	err := row.Scan(&item.ID, &item.ProjectID, &item.ProjectName, &item.RepoPath, &item.LocalPath, &item.Ext,
		&item.Bytes, &item.ModifiedUnix, &item.ContentHash, &item.HashAlgorithm, &item.Image.Format, &item.Image.Width, &item.Image.Height,
		&animated, &alpha, &item.Image.Pages, &item.DHash, &item.DHashFlipped, &usedCount, &groupID, &preferredPath, &optCount)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	item.Image.Animated = animated != 0
	item.Image.Alpha = alpha != 0
	item.URL = "/api/assets/" + item.ID
	item.ThumbnailURL = "/api/thumbs/" + item.ID
	item.UsedBy = make([]string, usedCount)
	item.References = []scanner.AssetReference{}
	item.Duplicates = []string{}
	item.Similar = []string{}
	item.Optimization = make([]scanner.OptimizationSuggestion, optCount)
	if groupID != "" {
		item.DuplicateGroupID = &groupID
	}
	if preferredPath != "" {
		item.PreferredDuplicatePath = &preferredPath
	}
	return item, nil
}

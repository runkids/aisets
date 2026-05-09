package main

import (
	"context"
	"flag"
	"io"
	"strings"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/scanner"
)

func newFlagSet(name string, jsonOut bool) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	if jsonOut {
		fs.SetOutput(io.Discard)
	}
	return fs
}

func parseFlagSet(fs *flag.FlagSet, args []string) error {
	if err := fs.Parse(args); err != nil {
		code := strings.NewReplacer(" ", "_", "-", "_").Replace(fs.Name()) + "_invalid_flags"
		return apierr.New(code, err.Error())
	}
	return nil
}

func scanCatalog(ctx context.Context, store *config.Store) (scanner.Catalog, error) {
	catalog, _, err := scanCatalogWithID(ctx, store)
	return catalog, err
}

func scanCatalogWithID(ctx context.Context, store *config.Store) (scanner.Catalog, int64, error) {
	settings, err := store.Settings()
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	options := scanner.NormalizeScanOptions(scanner.ScanOptions{
		Profile:                 settings.ScanProfile,
		Analyses:                settings.ScanAnalyses,
		ExcludePatterns:         settings.ExcludePatterns,
		ExcludePatternsByIntent: settings.ExcludePatternsByIntent,
	})
	catalog, err := scanner.NewWithCacheDir(config.CacheDir()).ScanWithOptions(ctx, toScannerProjects(store.Projects()), options, nil)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	scanID, err := store.RecordScan(catalog)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	catalog.ScanID = scanID
	return catalog, scanID, nil
}

func ensureScanExists(ctx context.Context, store *config.Store) error {
	if _, err := store.LatestScan(); err != nil {
		if _, _, scanErr := scanCatalogWithID(ctx, store); scanErr != nil {
			return scanErr
		}
	}
	return nil
}

func projectAndItem(ctx context.Context, store *config.Store, assetID string) (scanner.Project, scanner.AssetItem, error) {
	if err := ensureScanExists(ctx, store); err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	detail, err := store.CatalogItemDetail(0, assetID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	project, err := projectByID(store, detail.Item.ProjectID)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	return project, detail.Item, nil
}

func projectByID(store *config.Store, id string) (scanner.Project, error) {
	for _, project := range toScannerProjects(store.Projects()) {
		if project.ID == id {
			return project, nil
		}
	}
	return scanner.Project{}, apierr.WithParams("project_not_found", "project not found", map[string]any{"projectId": id})
}

func selectedOptimizationItems(ctx context.Context, store *config.Store, ids []string) ([]scanner.AssetItem, error) {
	if err := ensureScanExists(ctx, store); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return store.AllOptimizableItems(0)
	}
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	out, err := store.CatalogItemsWithOptimizationByIDs(0, ids)
	if err != nil {
		return nil, err
	}
	for _, item := range out {
		delete(idSet, item.ID)
	}
	if len(idSet) > 0 {
		missing := make([]string, 0, len(idSet))
		for id := range idSet {
			missing = append(missing, id)
		}
		return nil, apierr.WithParams("asset_not_found", "one or more assets were not found", map[string]any{"assetIds": missing})
	}
	return out, nil
}

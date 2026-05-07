package main

import (
	"context"
	"flag"
	"io"
	"strings"

	"asset-studio/internal/apierr"
	"asset-studio/internal/config"
	"asset-studio/internal/scanner"
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
	catalog, err := scanner.New().ScanWithProgress(ctx, toScannerProjects(store.Projects()), settings.ExcludePatterns, nil)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	scanID, err := store.RecordScan(catalog)
	if err != nil {
		return scanner.Catalog{}, 0, err
	}
	return catalog, scanID, nil
}

func projectAndItem(ctx context.Context, store *config.Store, assetID string) (scanner.Project, scanner.AssetItem, error) {
	catalog, err := scanCatalog(ctx, store)
	if err != nil {
		return scanner.Project{}, scanner.AssetItem{}, err
	}
	for _, item := range catalog.Items {
		if item.ID != assetID {
			continue
		}
		project, err := projectByID(store, item.ProjectID)
		if err != nil {
			return scanner.Project{}, scanner.AssetItem{}, err
		}
		return project, item, nil
	}
	return scanner.Project{}, scanner.AssetItem{}, apierr.WithParams("asset_not_found", "asset not found", map[string]any{"assetId": assetID})
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
	catalog, err := scanCatalog(ctx, store)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		out := make([]scanner.AssetItem, 0, len(catalog.Items))
		for _, item := range catalog.Items {
			if len(item.Optimization) > 0 {
				out = append(out, item)
			}
		}
		return out, nil
	}
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	out := make([]scanner.AssetItem, 0, len(ids))
	for _, item := range catalog.Items {
		if _, ok := idSet[item.ID]; ok {
			out = append(out, item)
			delete(idSet, item.ID)
		}
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

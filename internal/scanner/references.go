package scanner

import (
	"context"
	"sort"

	"aisets/internal/references"
)

func buildReferenceMap(ctx context.Context, projects []Project, items []AssetItem, options ScanOptions, progress func(current, total int)) (map[string][]AssetReference, error) {
	refProjects := make([]references.Project, 0, len(projects))
	for _, project := range projects {
		refProjects = append(refProjects, references.Project{
			ID:              project.ID,
			Path:            project.Path,
			ExcludePatterns: EffectiveExcludePatterns(project, options),
			ImportAliases:   options.ImportAliases,
		})
	}
	assets := make([]references.Asset, 0, len(items))
	for _, item := range items {
		assets = append(assets, references.Asset{ProjectID: item.ProjectID, RepoPath: item.RepoPath})
	}
	refMap, err := references.BuildMapWithProgress(ctx, refProjects, assets, nil, progress)
	if err != nil {
		return nil, err
	}
	out := map[string][]AssetReference{}
	for key, refs := range refMap {
		converted := make([]AssetReference, 0, len(refs))
		for _, ref := range refs {
			converted = append(converted, AssetReference{
				File:      ref.File,
				Line:      ref.Line,
				Specifier: ref.Specifier,
				Kind:      ref.Kind,
				Snippet:   ref.Snippet,
			})
		}
		out[key] = converted
	}
	return out, nil
}

func uniqueReferenceFiles(refs []AssetReference) []string {
	seen := map[string]bool{}
	for _, ref := range refs {
		seen[ref.File] = true
	}
	out := make([]string, 0, len(seen))
	for file := range seen {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}

func assetKey(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

package scanner

import (
	"context"
	"sort"

	"asset-studio/internal/imageproc"
)

func markDuplicates(items []AssetItem) []DuplicateGroup {
	byHash := map[string][]int{}
	for i := range items {
		if items[i].ContentHash == "" {
			continue
		}
		byHash[items[i].ContentHash] = append(byHash[items[i].ContentHash], i)
	}
	var groups []DuplicateGroup
	for hash, indexes := range byHash {
		if len(indexes) < 2 {
			continue
		}
		paths := make([]string, 0, len(indexes))
		for _, index := range indexes {
			paths = append(paths, items[index].RepoPath)
		}
		sort.Strings(paths)
		preferred := paths[0]
		id := "dup-" + hash[:10]
		for _, index := range indexes {
			items[index].DuplicateGroupID = &id
			items[index].Duplicates = append([]string(nil), paths...)
			items[index].PreferredDuplicatePath = &preferred
		}
		groups = append(groups, DuplicateGroup{ID: id, ContentHash: hash, HashAlgorithm: contentHashAlgorithm, Paths: paths, PreferredPath: preferred})
	}
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].PreferredPath < groups[j].PreferredPath
	})
	return groups
}

func markNearDuplicates(ctx context.Context, items []AssetItem, progress ProgressFunc) ([]NearDuplicate, error) {
	const threshold = 5
	var out []NearDuplicate
	for i := 0; i < len(items); i++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if items[i].DHash == "" {
			notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, Current: i + 1, Total: len(items)})
			continue
		}
		for j := i + 1; j < len(items); j++ {
			if items[j].DHash == "" || items[i].ContentHash != "" && items[i].ContentHash == items[j].ContentHash {
				continue
			}
			distance, ok := imageproc.DistanceHex(items[i].DHash, items[j].DHash)
			flipped := false
			if items[j].DHashFlipped != "" {
				if flipDistance, flipOK := imageproc.DistanceHex(items[i].DHash, items[j].DHashFlipped); flipOK && (!ok || flipDistance < distance) {
					distance = flipDistance
					ok = true
					flipped = true
				}
			}
			if !ok || distance > threshold {
				continue
			}
			items[i].Similar = append(items[i].Similar, items[j].ID)
			items[j].Similar = append(items[j].Similar, items[i].ID)
			out = append(out, NearDuplicate{
				ID:        "near-" + stableID(items[i].ID+":"+items[j].ID),
				LeftID:    items[i].ID,
				RightID:   items[j].ID,
				LeftPath:  items[i].RepoPath,
				RightPath: items[j].RepoPath,
				Distance:  distance,
				Flipped:   flipped,
			})
		}
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, Current: i + 1, Total: len(items)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LeftPath != out[j].LeftPath {
			return out[i].LeftPath < out[j].LeftPath
		}
		return out[i].RightPath < out[j].RightPath
	})
	for i := range items {
		sort.Strings(items[i].Similar)
	}
	return out, nil
}

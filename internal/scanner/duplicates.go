package scanner

import (
	"context"
	"math/bits"
	"sort"
	"strconv"
	"strings"

	"aisets/internal/imageproc"
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
		preferred := selectPreferred(items, indexes)
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

// selectPreferred picks the best file to keep from a duplicate group.
// Scoring: most references > shallowest path > shortest path > alphabetical.
func selectPreferred(items []AssetItem, indexes []int) string {
	best := indexes[0]
	bestScore := preferredScore(items[best])
	for _, idx := range indexes[1:] {
		s := preferredScore(items[idx])
		if s > bestScore || (s == bestScore && items[idx].RepoPath < items[best].RepoPath) {
			best, bestScore = idx, s
		}
	}
	return items[best].RepoPath
}

func preferredScore(item AssetItem) int {
	refs := len(item.UsedBy) * 1000
	depth := strings.Count(item.RepoPath, "/")
	length := len(item.RepoPath)
	return refs - depth*10 - length
}

type nearDuplicateCandidate struct {
	distance int
	flipped  bool
}

type nearHashIndex struct {
	root *nearHashNode
}

type nearHashNode struct {
	hash     uint64
	index    int
	children map[int]*nearHashNode
}

func (idx *nearHashIndex) insert(hash uint64, itemIndex int) {
	if idx.root == nil {
		idx.root = &nearHashNode{hash: hash, index: itemIndex}
		return
	}
	node := idx.root
	for {
		distance := hammingDistance(hash, node.hash)
		if node.children == nil {
			node.children = map[int]*nearHashNode{}
		}
		child := node.children[distance]
		if child == nil {
			node.children[distance] = &nearHashNode{hash: hash, index: itemIndex}
			return
		}
		node = child
	}
}

func (idx nearHashIndex) query(hash uint64, threshold int, visit func(index int, distance int)) {
	queryNearHashNode(idx.root, hash, threshold, visit)
}

func queryNearHashNode(node *nearHashNode, hash uint64, threshold int, visit func(index int, distance int)) {
	if node == nil {
		return
	}
	distance := hammingDistance(hash, node.hash)
	if distance <= threshold {
		visit(node.index, distance)
	}
	low := distance - threshold
	if low < 0 {
		low = 0
	}
	high := distance + threshold
	for childDistance, child := range node.children {
		if childDistance >= low && childDistance <= high {
			queryNearHashNode(child, hash, threshold, visit)
		}
	}
}

func parseDHash(hash string) (uint64, bool) {
	value, err := strconv.ParseUint(hash, 16, 64)
	return value, err == nil
}

func hammingDistance(a, b uint64) int {
	return bits.OnesCount64(a ^ b)
}

func markNearDuplicates(ctx context.Context, items []AssetItem, progress ProgressFunc) ([]NearDuplicate, error) {
	const threshold = 5
	var out []NearDuplicate
	index := nearHashIndex{}
	for current := 0; current < len(items); current++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		currentHash, hasCurrentHash := parseDHash(items[current].DHash)
		flippedHash, hasFlippedHash := parseDHash(items[current].DHashFlipped)
		if !hasCurrentHash && !hasFlippedHash {
			notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, Current: current + 1, Total: len(items)})
			continue
		}

		candidates := map[int]nearDuplicateCandidate{}
		if hasCurrentHash {
			index.query(currentHash, threshold, func(index int, distance int) {
				candidates[index] = nearDuplicateCandidate{distance: distance}
			})
		}
		if hasFlippedHash {
			index.query(flippedHash, threshold, func(index int, distance int) {
				candidate, exists := candidates[index]
				if !exists || distance < candidate.distance {
					candidates[index] = nearDuplicateCandidate{distance: distance, flipped: true}
				}
			})
		}

		for previous, candidate := range candidates {
			if items[previous].ContentHash != "" && items[previous].ContentHash == items[current].ContentHash {
				continue
			}
			if !imageproc.IsVisualMatch(items[previous].LocalPath, items[current].LocalPath, candidate.flipped) {
				continue
			}
			items[previous].Similar = append(items[previous].Similar, items[current].ID)
			items[current].Similar = append(items[current].Similar, items[previous].ID)
			out = append(out, NearDuplicate{
				ID:        "near-" + stableID(items[previous].ID+":"+items[current].ID),
				LeftID:    items[previous].ID,
				RightID:   items[current].ID,
				LeftPath:  items[previous].RepoPath,
				RightPath: items[current].RepoPath,
				Distance:  candidate.distance,
				Flipped:   candidate.flipped,
			})
		}
		if hasCurrentHash {
			index.insert(currentHash, current)
		}
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, Current: current + 1, Total: len(items)})
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

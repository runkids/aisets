package scanner

import (
	"context"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"bufio"

	catalogcache "asset-studio/internal/cache"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/lint"
	"asset-studio/internal/references"
	"github.com/zeebo/blake3"
)

const contentHashAlgorithm = "blake3"

var imageExts = map[string]bool{
	".avif": true,
	".gif":  true,
	".jpeg": true,
	".jpg":  true,
	".png":  true,
	".svg":  true,
	".webp": true,
}

var skipDirs = map[string]bool{
	".git": true, ".next": true, ".nuxt": true, ".turbo": true, "build": true,
	"coverage": true, "dist": true, "node_modules": true, "storybook-static": true,
}

type Scanner struct {
	mu       sync.Mutex
	cache    *catalogcache.Store
	cacheDir string
}

type fileCandidate struct {
	project Project
	path    string
	repo    string
	info    os.FileInfo
}

type scanResult struct {
	index    int
	item     AssetItem
	cacheHit bool
	err      error
}

func New() *Scanner {
	cacheDir := ""
	if userCache, err := os.UserCacheDir(); err == nil {
		cacheDir = filepath.Join(userCache, "asset-studio")
	}
	return NewWithCacheDir(cacheDir)
}

func NewWithCacheDir(cacheDir string) *Scanner {
	var store *catalogcache.Store
	var err error
	storeDir := ""
	if cacheDir != "" {
		storeDir = filepath.Join(cacheDir, "catalog")
	}
	store, err = catalogcache.Open(storeDir)
	if err != nil {
		store, _ = catalogcache.Open(filepath.Join(os.TempDir(), "asset-studio", "catalog"))
	}
	return &Scanner{cache: store, cacheDir: cacheDir}
}

func (s *Scanner) Scan(ctx context.Context, projects []Project) (Catalog, error) {
	candidates, err := collectCandidates(ctx, projects)
	if err != nil {
		return Catalog{}, err
	}
	sizeCounts := map[int64]int{}
	for _, candidate := range candidates {
		sizeCounts[candidate.info.Size()]++
	}

	items := make([]AssetItem, len(candidates))
	cacheHits := 0
	jobs := make(chan struct {
		index     int
		candidate fileCandidate
	})
	results := make(chan scanResult)
	workers := max(1, min(runtime.NumCPU(), 8))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				item, hit, err := s.buildItem(ctx, job.candidate, sizeCounts[job.candidate.info.Size()] > 1)
				results <- scanResult{index: job.index, item: item, cacheHit: hit, err: err}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for index, candidate := range candidates {
			if ctx.Err() != nil {
				return
			}
			jobs <- struct {
				index     int
				candidate fileCandidate
			}{index: index, candidate: candidate}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()
	for result := range results {
		if result.err != nil {
			return Catalog{}, result.err
		}
		if result.cacheHit {
			cacheHits++
		}
		items[result.index] = result.item
	}
	if ctx.Err() != nil {
		return Catalog{}, ctx.Err()
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProjectID != items[j].ProjectID {
			return items[i].ProjectID < items[j].ProjectID
		}
		return items[i].RepoPath < items[j].RepoPath
	})

	refs, err := buildReferenceMap(ctx, projects, items)
	if err != nil {
		return Catalog{}, err
	}
	for i := range items {
		items[i].References = refs[assetKey(items[i].ProjectID, items[i].RepoPath)]
		items[i].UsedBy = uniqueReferenceFiles(items[i].References)
	}
	dups := markDuplicates(items)
	near := markNearDuplicates(items)
	lintFindings := runLint(projects, items)

	unused := 0
	dupFiles := 0
	for i := range items {
		if len(items[i].UsedBy) == 0 {
			unused++
		}
		if items[i].DuplicateGroupID != nil {
			dupFiles++
		}
	}
	catalog := Catalog{
		GeneratedAt:     time.Now().UTC().Format(time.RFC3339),
		Projects:        projects,
		Items:           items,
		DuplicateGroups: dups,
		NearDuplicates:  near,
		LintFindings:    lintFindings,
		Stats: CatalogStats{
			TotalFiles:      len(items),
			DuplicateGroups: len(dups),
			DuplicateFiles:  dupFiles,
			UnusedFiles:     unused,
			NearDuplicates:  len(near),
			LintFindings:    len(lintFindings),
			CacheHits:       cacheHits,
		},
	}
	return normalizeCatalogSlices(catalog), nil
}

func (s *Scanner) Thumbnail(ctx context.Context, catalog Catalog, id string, size int) (imageproc.ThumbnailResult, error) {
	for _, item := range catalog.Items {
		if item.ID != id {
			continue
		}
		if ctx.Err() != nil {
			return imageproc.ThumbnailResult{}, ctx.Err()
		}
		cacheDir := filepath.Join(s.cacheDir, "thumbs")
		if cacheDir == "thumbs" {
			cacheDir = filepath.Join(os.TempDir(), "asset-studio", "thumbs")
		}
		key := item.ThumbnailURL
		if key == "" {
			key = imageproc.CacheKey(item.ProjectID, item.RepoPath, item.Bytes, 0)
		}
		return imageproc.Thumbnail(item.LocalPath, cacheDir, key, size)
	}
	return imageproc.ThumbnailResult{}, os.ErrNotExist
}

func (s *Scanner) buildItem(ctx context.Context, candidate fileCandidate, needsSHA bool) (AssetItem, bool, error) {
	if ctx.Err() != nil {
		return AssetItem{}, false, ctx.Err()
	}
	info := candidate.info
	cacheKey := imageproc.CacheKey(candidate.project.ID, candidate.repo, info.Size(), info.ModTime().UnixNano())
	item := AssetItem{
		ID:            stableID(candidate.project.ID + ":" + candidate.repo),
		ProjectID:     candidate.project.ID,
		ProjectName:   candidate.project.Name,
		RepoPath:      candidate.repo,
		LocalPath:     candidate.path,
		Ext:           strings.ToLower(filepath.Ext(candidate.path)),
		Bytes:         info.Size(),
		URL:           "/api/assets/" + stableID(candidate.project.ID+":"+candidate.repo),
		ThumbnailURL:  "/api/thumbs/" + stableID(candidate.project.ID+":"+candidate.repo),
		HashAlgorithm: contentHashAlgorithm,
	}
	if record, ok := s.cache.Get(cacheKey, info.Size(), info.ModTime().UnixNano()); ok {
		item.ContentHash = record.ContentHash
		if record.HashAlgorithm != "" {
			item.HashAlgorithm = record.HashAlgorithm
		}
		item.Image = record.Metadata
		item.DHash = record.Hashes.DHash
		item.DHashFlipped = record.Hashes.DHashFlipped
		item.Optimization = toScannerOptimization(record.Optimization)
		if needsSHA && item.ContentHash == "" {
			sum, err := contentHashFile(ctx, candidate.path)
			if err != nil {
				return AssetItem{}, false, err
			}
			item.ContentHash = sum
			record.ContentHash = sum
			record.HashAlgorithm = contentHashAlgorithm
			_ = s.cache.Set(cacheKey, record)
		}
		return item, true, nil
	}

	meta, _ := imageproc.Probe(candidate.path)
	hashes, _ := imageproc.DHash(candidate.path)
	optimization := imageproc.EstimateOptimization(candidate.path, meta, info.Size())
	item.Image = meta
	item.DHash = hashes.DHash
	item.DHashFlipped = hashes.DHashFlipped
	item.Optimization = toScannerOptimization(optimization)
	if needsSHA {
		sum, err := contentHashFile(ctx, candidate.path)
		if err != nil {
			return AssetItem{}, false, err
		}
		item.ContentHash = sum
	}
	_ = s.cache.Set(cacheKey, catalogcache.Record{
		ProjectID:     candidate.project.ID,
		RepoPath:      candidate.repo,
		Size:          info.Size(),
		MTimeUnix:     info.ModTime().UnixNano(),
		ContentHash:   item.ContentHash,
		HashAlgorithm: contentHashAlgorithm,
		Metadata:      meta,
		Hashes:        hashes,
		Optimization:  optimization,
		ThumbKey:      cacheKey,
	})
	return item, false, nil
}

func collectCandidates(ctx context.Context, projects []Project) ([]fileCandidate, error) {
	var candidates []fileCandidate
	for _, project := range projects {
		err := filepath.WalkDir(project.Path, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if entry.IsDir() {
				if skipDirs[entry.Name()] {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if !imageExts[ext] {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return nil
			}
			repoPath, err := filepath.Rel(project.Path, path)
			if err != nil {
				return nil
			}
			candidates = append(candidates, fileCandidate{
				project: project,
				path:    path,
				repo:    filepath.ToSlash(repoPath),
				info:    info,
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return candidates, nil
}

func buildReferenceMap(ctx context.Context, projects []Project, items []AssetItem) (map[string][]AssetReference, error) {
	refProjects := make([]references.Project, 0, len(projects))
	for _, project := range projects {
		refProjects = append(refProjects, references.Project{ID: project.ID, Path: project.Path})
	}
	assets := make([]references.Asset, 0, len(items))
	for _, item := range items {
		assets = append(assets, references.Asset{ProjectID: item.ProjectID, RepoPath: item.RepoPath})
	}
	refMap, err := references.BuildMap(ctx, refProjects, assets)
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
			})
		}
		out[key] = converted
	}
	return out, nil
}

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

func markNearDuplicates(items []AssetItem) []NearDuplicate {
	const threshold = 5
	var out []NearDuplicate
	for i := 0; i < len(items); i++ {
		if items[i].DHash == "" {
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
	return out
}

func toScannerOptimization(in []imageproc.Optimization) []OptimizationSuggestion {
	if len(in) == 0 {
		return nil
	}
	out := make([]OptimizationSuggestion, 0, len(in))
	for _, opt := range in {
		out = append(out, OptimizationSuggestion{
			Category:       opt.Category,
			ReasonCode:     opt.ReasonCode,
			Reason:         opt.Reason,
			Severity:       opt.Severity,
			SuggestionCode: opt.SuggestionCode,
			Suggestion:     opt.Suggestion,
			EstimatedBytes: opt.EstimatedBytes,
			SavingsBytes:   opt.SavingsBytes,
		})
	}
	return out
}

func contentHashFile(ctx context.Context, path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := blake3.New()
	buf := make([]byte, 128*1024)
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		n, err := file.Read(buf)
		if n > 0 {
			if _, writeErr := hash.Write(buf[:n]); writeErr != nil {
				return "", writeErr
			}
		}
		if err == io.EOF {
			return hex.EncodeToString(hash.Sum(nil)), nil
		}
		if err != nil {
			return "", err
		}
	}
}

func normalizeCatalogSlices(catalog Catalog) Catalog {
	if catalog.Projects == nil {
		catalog.Projects = []Project{}
	}
	if catalog.Items == nil {
		catalog.Items = []AssetItem{}
	}
	if catalog.DuplicateGroups == nil {
		catalog.DuplicateGroups = []DuplicateGroup{}
	}
	if catalog.NearDuplicates == nil {
		catalog.NearDuplicates = []NearDuplicate{}
	}
	if catalog.LintFindings == nil {
		catalog.LintFindings = []lint.Finding{}
	}
	for i := range catalog.Items {
		if catalog.Items[i].UsedBy == nil {
			catalog.Items[i].UsedBy = []string{}
		}
		if catalog.Items[i].References == nil {
			catalog.Items[i].References = []AssetReference{}
		}
		if catalog.Items[i].Duplicates == nil {
			catalog.Items[i].Duplicates = []string{}
		}
		if catalog.Items[i].Similar == nil {
			catalog.Items[i].Similar = []string{}
		}
		if catalog.Items[i].Optimization == nil {
			catalog.Items[i].Optimization = []OptimizationSuggestion{}
		}
	}
	return catalog
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

func stableID(value string) string {
	sum := blake3.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}

func assetKey(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

func runLint(projects []Project, items []AssetItem) []lint.Finding {
	type refWithAsset struct {
		ref   AssetReference
		item  AssetItem
		pPath string
	}

	byFile := map[string][]refWithAsset{}
	projectPath := map[string]string{}
	for _, p := range projects {
		projectPath[p.ID] = p.Path
	}
	for _, item := range items {
		pPath := projectPath[item.ProjectID]
		for _, ref := range item.References {
			key := pPath + "/" + ref.File
			byFile[key] = append(byFile[key], refWithAsset{ref: ref, item: item, pPath: pPath})
		}
	}

	var findings []lint.Finding
	for filePath, refs := range byFile {
		lines := readFileLines(filePath)
		if lines == nil {
			continue
		}
		for _, r := range refs {
			lineContent := ""
			if r.ref.Line > 0 && r.ref.Line <= len(lines) {
				lineContent = lines[r.ref.Line-1]
			}
			ctx := lint.Context{
				File:       r.ref.File,
				Line:       r.ref.Line,
				Content:    lineContent,
				Kind:       r.ref.Kind,
				Specifier:  r.ref.Specifier,
				AssetBytes: r.item.Bytes,
				AssetExt:   r.item.Ext,
				AssetID:    r.item.ID,
			}
			findings = append(findings, lint.Run(ctx)...)
		}
	}
	return findings
}

func readFileLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines
}

package scanner

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	catalogcache "asset-studio/internal/cache"
	"asset-studio/internal/imageproc"
	"asset-studio/internal/lint"
)

type Scanner struct {
	mu       sync.Mutex
	cache    *catalogcache.Store
	cacheDir string
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
	return s.ScanWithProgress(ctx, projects, nil, nil)
}

func (s *Scanner) ScanWithProgress(ctx context.Context, projects []Project, excludePatterns []string, progress ProgressFunc) (Catalog, error) {
	options := FullScanOptions()
	options.ExcludePatterns = excludePatterns
	return s.ScanWithOptions(ctx, projects, options, progress)
}

func (s *Scanner) ScanWithOptions(ctx context.Context, projects []Project, options ScanOptions, progress ProgressFunc) (Catalog, error) {
	projects = normalizeScanProjects(projects)
	options = IntentAdjustedOptions(projects, options)
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseCollecting})
	candidates, err := collectCandidates(ctx, projects, options)
	if err != nil {
		return Catalog{}, err
	}
	defer func() {
		if s.cache != nil {
			_ = s.cache.Flush()
		}
	}()
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseCollecting, Current: len(candidates), Total: len(candidates)})
	const nearDupThreshold = 10_000
	if options.Profile != ScanProfileCustom && len(candidates) >= nearDupThreshold && options.Analyses.NearDuplicates {
		options.Analyses.NearDuplicates = false
		options.Profile = ScanProfileCustom
	}
	sizeCounts := map[int64]int{}
	for _, candidate := range candidates {
		sizeCounts[candidate.info.Size()]++
	}

	thresholds := options.OptimizationThresholds
	thresholdsHash := thresholds.Hash()

	items := make([]AssetItem, len(candidates))
	cacheHits := 0
	jobs := make(chan struct {
		index     int
		candidate fileCandidate
	})
	results := make(chan scanResult)
	workers := max(1, min(runtime.NumCPU(), 8))
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseMetadata, Current: 0, Total: len(candidates)})
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				item, hit, err := s.buildItem(ctx, job.candidate, sizeCounts[job.candidate.info.Size()] > 1, options.Analyses.NearDuplicates, options.Analyses.Optimization, thresholds, thresholdsHash)
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
	processed := 0
	for result := range results {
		processed++
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseMetadata, Current: processed, Total: len(candidates)})
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

	referencesComputed := options.Analyses.References && !ReferencesNotApplicable(projects)
	if referencesComputed {
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseReferences})
		refProjects := referenceProjects(projects)
		refItems := referenceItems(items)
		refs, err := buildReferenceMap(ctx, refProjects, refItems, options, func(current, total int) {
			notifyProgress(progress, ScanProgress{Phase: ScanPhaseReferences, Current: current, Total: total})
		})
		if err != nil {
			return Catalog{}, err
		}
		for i := range items {
			items[i].References = refs[assetKey(items[i].ProjectID, items[i].RepoPath)]
			items[i].UsedBy = uniqueReferenceFiles(items[i].References)
		}
	} else {
		reason := AnalysisSkipByUser
		message := ""
		if ReferencesNotApplicable(projects) {
			reason = AnalysisSkipNotApplicable
			message = "Skipped references — project marked as asset pack."
		}
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseReferences, State: AnalysisNotComputed, Reason: reason, Message: message})
	}
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseDuplicates})
	dups := markDuplicates(items)
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseDuplicates, Current: len(items), Total: len(items)})
	near := []NearDuplicate{}
	if options.Analyses.NearDuplicates {
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, Current: 0, Total: len(items)})
		var err error
		near, err = markNearDuplicates(ctx, items, progress)
		if err != nil {
			return Catalog{}, err
		}
	} else {
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseNearDuplicates, State: AnalysisNotComputed})
	}
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseLint})
	lintFindings := []lint.Finding{}
	if referencesComputed {
		lintFindings = runLint(referenceProjects(projects), referenceItems(items))
	} else {
		reason := AnalysisSkipByUser
		message := ""
		if ReferencesNotApplicable(projects) {
			reason = AnalysisSkipNotApplicable
			message = "Skipped lint — project marked as asset pack."
		}
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseLint, State: AnalysisNotComputed, Reason: reason, Message: message})
	}
	notifyProgress(progress, ScanProgress{Phase: ScanPhaseLint, Current: len(lintFindings), Total: len(lintFindings)})

	classifyUsage(ctx, projects, items, options, referencesComputed)
	stats := usageStats(items)
	dupFiles := 0
	for i := range items {
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
			TotalFiles:              len(items),
			DuplicateGroups:         len(dups),
			DuplicateFiles:          dupFiles,
			UnusedFiles:             stats.unused,
			PossiblyUnusedFiles:     stats.possiblyUnused,
			UsageNotApplicableFiles: stats.notApplicable,
			ReferencedFiles:         stats.referenced,
			NearDuplicates:          len(near),
			LintFindings:            len(lintFindings),
			CacheHits:               cacheHits,
		},
		Analysis: AnalysisFromOptions(options),
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

func (s *Scanner) buildItem(ctx context.Context, candidate fileCandidate, needsSHA, needsDHash, needsOptimization bool, thresholds imageproc.OptimizationThresholds, thresholdsHash string) (AssetItem, bool, error) {
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
		ModifiedUnix:  info.ModTime().Unix(),
		URL:           "/api/assets/" + stableID(candidate.project.ID+":"+candidate.repo),
		ThumbnailURL:  "/api/thumbs/" + stableID(candidate.project.ID+":"+candidate.repo),
		HashAlgorithm: contentHashAlgorithm,
		ScanIntent:    NormalizeProjectScanIntent(candidate.project.ScanIntent),
	}
	if record, ok := s.cache.Get(cacheKey, info.Size(), info.ModTime().UnixNano()); ok {
		item.ContentHash = record.ContentHash
		if record.HashAlgorithm != "" {
			item.HashAlgorithm = record.HashAlgorithm
		}
		item.Image = record.Metadata
		if needsDHash {
			item.DHash = record.Hashes.DHash
			item.DHashFlipped = record.Hashes.DHashFlipped
		}
		if needsOptimization && record.ThresholdsHash == thresholdsHash {
			item.Optimization = toScannerOptimization(record.Optimization)
		}
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
		if needsDHash && item.DHash == "" {
			hashes, _ := imageproc.DHash(candidate.path)
			item.DHash = hashes.DHash
			item.DHashFlipped = hashes.DHashFlipped
			record.Hashes = hashes
			_ = s.cache.Set(cacheKey, record)
		}
		if needsOptimization && len(item.Optimization) == 0 {
			optimization := imageproc.EstimateOptimization(candidate.path, item.Image, info.Size(), thresholds)
			item.Optimization = toScannerOptimization(optimization)
			record.Optimization = optimization
			record.ThresholdsHash = thresholdsHash
			_ = s.cache.Set(cacheKey, record)
		}
		return item, true, nil
	}

	meta, _ := imageproc.Probe(candidate.path)
	item.Image = meta
	var hashes imageproc.Hashes
	if needsDHash {
		hashes, _ = imageproc.DHash(candidate.path)
		item.DHash = hashes.DHash
		item.DHashFlipped = hashes.DHashFlipped
	}
	var optimization []imageproc.Optimization
	if needsOptimization {
		optimization = imageproc.EstimateOptimization(candidate.path, meta, info.Size(), thresholds)
		item.Optimization = toScannerOptimization(optimization)
	}
	if needsSHA {
		sum, err := contentHashFile(ctx, candidate.path)
		if err != nil {
			return AssetItem{}, false, err
		}
		item.ContentHash = sum
	}
	_ = s.cache.Set(cacheKey, catalogcache.Record{
		ProjectID:      candidate.project.ID,
		RepoPath:       candidate.repo,
		Size:           info.Size(),
		MTimeUnix:      info.ModTime().UnixNano(),
		ContentHash:    item.ContentHash,
		HashAlgorithm:  contentHashAlgorithm,
		Metadata:       meta,
		Hashes:         hashes,
		Optimization:   optimization,
		ThresholdsHash: thresholdsHash,
		ThumbKey:       cacheKey,
	})
	return item, false, nil
}

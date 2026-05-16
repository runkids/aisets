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

	catalogcache "aisets/internal/cache"
	"aisets/internal/imageproc"
	"aisets/internal/lint"
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
		cacheDir = filepath.Join(userCache, "aisets")
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
		store, _ = catalogcache.Open(filepath.Join(os.TempDir(), "aisets", "catalog"))
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
	startedAt := time.Now().UTC().Format(time.RFC3339)
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
				item, hit, err := s.buildItem(ctx, job.candidate, options.Analyses.NearDuplicates, options.Analyses.Optimization, thresholds, thresholdsHash)
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
		message := ""
		if result.index >= 0 && result.index < len(candidates) {
			message = candidates[result.index].repo
		}
		notifyProgress(progress, ScanProgress{Phase: ScanPhaseMetadata, Current: processed, Total: len(candidates), Message: message})
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
		lintFindings = runLint(referenceProjects(projects), referenceItems(items), options.LintSettings)
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
		StartedAt:       startedAt,
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
			cacheDir = filepath.Join(os.TempDir(), "aisets", "thumbs")
		}
		contentHash := item.ContentHash
		if contentHash == "" {
			sum, err := contentHashFile(ctx, item.LocalPath)
			if err != nil {
				return imageproc.ThumbnailResult{}, err
			}
			contentHash = sum
		}
		key := item.ProjectID + "\x00" + item.RepoPath + "\x00" + contentHash
		if strings.EqualFold(item.Ext, ".webp") && item.Image.Animated {
			info, err := os.Stat(item.LocalPath)
			if err != nil {
				return imageproc.ThumbnailResult{}, err
			}
			return imageproc.ThumbnailResult{Path: item.LocalPath, MimeType: "image/webp", CacheKey: key, SizeBytes: info.Size()}, nil
		}
		return imageproc.Thumbnail(item.LocalPath, cacheDir, key, size)
	}
	return imageproc.ThumbnailResult{}, os.ErrNotExist
}

func (s *Scanner) buildItem(ctx context.Context, candidate fileCandidate, needsDHash, needsOptimization bool, thresholds imageproc.OptimizationThresholds, thresholdsHash string) (AssetItem, bool, error) {
	if ctx.Err() != nil {
		return AssetItem{}, false, ctx.Err()
	}
	info := candidate.info
	cacheKey := imageproc.CacheKey(candidate.project.ID, candidate.repo, info.Size(), info.ModTime().UnixNano())
	assetID := stableID(candidate.project.ID + ":" + candidate.repo)

	contentHash, err := contentHashFile(ctx, candidate.path)
	if err != nil {
		return AssetItem{}, false, err
	}

	if record, ok := s.cache.Get(cacheKey, info.Size(), info.ModTime().UnixNano()); ok && record.ContentHash == contentHash {
		meta := record.Metadata
		if meta.Width <= 0 || meta.Height <= 0 {
			if fresh, err := imageproc.Probe(candidate.path); err == nil && fresh.Width > 0 {
				meta = fresh
			}
		}
		// Cache hit: skip Probe, DHash, and Optimization re-computation
		item := AssetItem{
			ID:            assetID,
			ProjectID:     candidate.project.ID,
			ProjectName:   candidate.project.Name,
			RepoPath:      candidate.repo,
			LocalPath:     candidate.path,
			Ext:           strings.ToLower(filepath.Ext(candidate.path)),
			Bytes:         info.Size(),
			ModifiedUnix:  info.ModTime().Unix(),
			ContentHash:   contentHash,
			URL:           "/api/assets/" + assetID + "?v=" + contentHash,
			ThumbnailURL:  "/api/thumbs/" + assetID + "?v=" + contentHash,
			HashAlgorithm: contentHashAlgorithm,
			ScanIntent:    NormalizeProjectScanIntent(candidate.project.ScanIntent),
			Image:         meta,
		}
		if record.HashAlgorithm != "" {
			item.HashAlgorithm = record.HashAlgorithm
		}
		item.EXIF = record.EXIF
		if needsDHash {
			item.DHash = record.Hashes.DHash
			item.DHashFlipped = record.Hashes.DHashFlipped
		}
		if needsOptimization && record.ThresholdsHash == thresholdsHash {
			item.Optimization = toScannerOptimization(record.Optimization)
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
		markExistingVariants(&item)
		return item, true, nil
	}

	item := AssetItem{
		ID:            assetID,
		ProjectID:     candidate.project.ID,
		ProjectName:   candidate.project.Name,
		RepoPath:      candidate.repo,
		LocalPath:     candidate.path,
		Ext:           strings.ToLower(filepath.Ext(candidate.path)),
		Bytes:         info.Size(),
		ModifiedUnix:  info.ModTime().Unix(),
		ContentHash:   contentHash,
		URL:           "/api/assets/" + assetID + "?v=" + contentHash,
		ThumbnailURL:  "/api/thumbs/" + assetID + "?v=" + contentHash,
		HashAlgorithm: contentHashAlgorithm,
		ScanIntent:    NormalizeProjectScanIntent(candidate.project.ScanIntent),
	}
	meta, _ := imageproc.Probe(candidate.path)
	item.Image = meta
	if item.Ext == ".jpg" || item.Ext == ".jpeg" || item.Ext == ".tiff" || item.Ext == ".tif" || item.Ext == ".heic" || item.Ext == ".heif" {
		if exifData, err := imageproc.ExtractEXIF(candidate.path); err == nil && exifData.HasEXIF {
			item.EXIF = &exifData
		}
	}
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
	_ = s.cache.Set(cacheKey, catalogcache.Record{
		ProjectID:      candidate.project.ID,
		RepoPath:       candidate.repo,
		Size:           info.Size(),
		MTimeUnix:      info.ModTime().UnixNano(),
		ContentHash:    contentHash,
		HashAlgorithm:  contentHashAlgorithm,
		Metadata:       meta,
		Hashes:         hashes,
		Optimization:   optimization,
		ThresholdsHash: thresholdsHash,
		ThumbKey:       cacheKey,
		EXIF:           item.EXIF,
	})
	markExistingVariants(&item)
	return item, false, nil
}

func markExistingVariants(item *AssetItem) {
	if len(item.Optimization) == 0 || item.LocalPath == "" {
		return
	}
	for i := range item.Optimization {
		target := variantTargetExt(item.Optimization[i].SuggestionCode, item.Ext)
		if target == "" || target == item.Ext {
			continue
		}
		ext := filepath.Ext(item.LocalPath)
		variantPath := item.LocalPath[:len(item.LocalPath)-len(ext)] + target
		if fi, err := os.Stat(variantPath); err == nil {
			item.Optimization[i].HasExistingVariant = true
			item.Optimization[i].VariantBytes = fi.Size()
		}
	}
}

// variantTargetExt mirrors optimize.operationRules — kept local to avoid an import cycle.
func variantTargetExt(suggestionCode, sourceExt string) string {
	switch suggestionCode {
	case "try_alpha_preserving_format":
		if sourceExt == ".png" {
			return ".webp"
		}
		return ""
	case "try_modern_photographic_format":
		switch sourceExt {
		case ".png", ".jpg", ".jpeg":
			return ".avif"
		}
		return ""
	case "review_compression_or_modern_format":
		switch sourceExt {
		case ".png", ".jpg", ".jpeg":
			return ".avif"
		case ".gif":
			return ".webp"
		}
		return ""
	default:
		return ""
	}
}

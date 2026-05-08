package scanner

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

func NormalizeProjectScanIntent(intent ProjectScanIntent) ProjectScanIntent {
	switch intent {
	case ProjectScanIntentAssetPack, ProjectScanIntentLibrary, ProjectScanIntentMixed:
		return intent
	case ProjectScanIntentCode, "":
		return ProjectScanIntentCode
	default:
		return ProjectScanIntentCode
	}
}

func ValidProjectScanIntent(intent ProjectScanIntent) bool {
	switch intent {
	case ProjectScanIntentCode, ProjectScanIntentAssetPack, ProjectScanIntentLibrary, ProjectScanIntentMixed:
		return true
	default:
		return false
	}
}

func ReferencesNotApplicable(projects []Project) bool {
	if len(projects) == 0 {
		return false
	}
	for _, project := range projects {
		if NormalizeProjectScanIntent(project.ScanIntent) != ProjectScanIntentAssetPack {
			return false
		}
	}
	return true
}

func IntentAdjustedOptions(projects []Project, options ScanOptions) ScanOptions {
	options = NormalizeScanOptions(options)
	if ReferencesNotApplicable(projects) {
		options.Analyses.References = false
		options.Profile = ScanProfileCustom
	}
	return options
}

func ProjectReferenceCoverage(ctx context.Context, project Project, excludePatterns []string) ReferenceCoverage {
	switch NormalizeProjectScanIntent(project.ScanIntent) {
	case ProjectScanIntentAssetPack:
		return ReferenceCoverageNotApplicable
	case ProjectScanIntentLibrary, ProjectScanIntentMixed:
		return ReferenceCoveragePartial
	}
	if hasSupportedReferenceSignals(ctx, project.Path, excludePatterns) {
		return ReferenceCoverageSupported
	}
	return ReferenceCoveragePartial
}

func projectLintApplicability(coverage ReferenceCoverage, intent ProjectScanIntent) LintApplicability {
	switch NormalizeProjectScanIntent(intent) {
	case ProjectScanIntentAssetPack:
		return LintNotApplicable
	case ProjectScanIntentLibrary, ProjectScanIntentMixed:
		return LintAdvisory
	}
	if coverage == ReferenceCoverageSupported {
		return LintApplicable
	}
	return LintAdvisory
}

var supportedReferenceExts = map[string]bool{
	".css": true, ".html": true, ".js": true, ".jsx": true, ".mjs": true,
	".scss": true, ".ts": true, ".tsx": true, ".vue": true,
}

func hasSupportedReferenceSignals(ctx context.Context, root string, excludePatterns []string) bool {
	seen := 0
	found := false
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
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
		if seen >= 2000 {
			return filepath.SkipAll
		}
		seen++
		repoPath, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		repoPath = filepath.ToSlash(repoPath)
		if matchesAnyExcludePattern(excludePatterns, repoPath) {
			return nil
		}
		if supportedReferenceExts[strings.ToLower(filepath.Ext(path))] {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

func matchesAnyExcludePattern(patterns []string, repoPath string) bool {
	for _, pattern := range patterns {
		if pattern == "" {
			continue
		}
		if ok, _ := filepath.Match(pattern, repoPath); ok {
			return true
		}
		if strings.HasPrefix(pattern, "**/") {
			if ok, _ := filepath.Match(strings.TrimPrefix(pattern, "**/"), filepath.Base(repoPath)); ok {
				return true
			}
		}
		prefix := strings.TrimSuffix(pattern, "/**")
		if prefix != pattern && strings.HasPrefix(repoPath, prefix+"/") {
			return true
		}
	}
	return false
}

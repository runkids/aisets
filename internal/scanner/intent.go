package scanner

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"asset-studio/internal/references"
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

func EffectiveExcludePatterns(project Project, options ScanOptions) []string {
	intent := NormalizeProjectScanIntent(project.ScanIntent)
	patterns := make([]string, 0, len(options.ExcludePatterns)+len(options.ExcludePatternsByIntent[intent]))
	patterns = append(patterns, options.ExcludePatterns...)
	patterns = append(patterns, options.ExcludePatternsByIntent[intent]...)
	return patterns
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

var frontendReferenceManifestNames = map[string]bool{
	"angular.json": true, "astro.config.js": true, "astro.config.mjs": true, "astro.config.ts": true,
	"next.config.js": true, "next.config.ts": true, "nuxt.config.js": true, "nuxt.config.ts": true,
	"remix.config.js": true, "remix.config.ts": true, "svelte.config.js": true, "svelte.config.ts": true,
	"vite.config.js": true, "vite.config.ts": true, "vue.config.js": true,
}

var frontendReferenceExts = map[string]bool{
	".css": true, ".html": true, ".js": true, ".jsx": true, ".mjs": true,
	".scss": true, ".ts": true, ".tsx": true, ".vue": true,
}

var frontendComponentExts = map[string]bool{
	".jsx": true, ".tsx": true, ".vue": true, ".svelte": true,
}

func hasSupportedReferenceSignals(ctx context.Context, root string, excludePatterns []string) bool {
	seen := 0
	frontendManifest := false
	frontendSource := false
	frontendComponent := false
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
		if references.MatchesAnyExcludePattern(excludePatterns, repoPath) {
			return nil
		}
		name := strings.ToLower(entry.Name())
		if frontendReferenceManifestNames[name] {
			frontendManifest = true
		}
		ext := strings.ToLower(filepath.Ext(path))
		if frontendReferenceExts[ext] {
			frontendSource = true
		}
		if frontendComponentExts[ext] {
			frontendComponent = true
		}
		if frontendComponent || (frontendManifest && frontendSource) {
			return filepath.SkipAll
		}
		return nil
	})
	return frontendComponent || (frontendManifest && frontendSource)
}

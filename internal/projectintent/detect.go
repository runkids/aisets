package projectintent

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"asset-studio/internal/scanner"
)

const maxSampleFiles = 2000

type Confidence string

const (
	ConfidenceLow    Confidence = "low"
	ConfidenceMedium Confidence = "medium"
	ConfidenceHigh   Confidence = "high"
)

type SuggestedScanIntent string

const (
	SuggestedScanIntentCode      SuggestedScanIntent = "code"
	SuggestedScanIntentAssetPack SuggestedScanIntent = "assetPack"
	SuggestedScanIntentLibrary   SuggestedScanIntent = "library"
	SuggestedScanIntentMixed     SuggestedScanIntent = "mixed"
	SuggestedScanIntentUnknown   SuggestedScanIntent = "unknown"
)

type FileCounts struct {
	AssetFiles    int  `json:"assetFiles"`
	CodeFiles     int  `json:"codeFiles"`
	ManifestFiles int  `json:"manifestFiles"`
	DocFiles      int  `json:"docFiles"`
	TotalFiles    int  `json:"totalFiles"`
	SampledFiles  int  `json:"sampledFiles"`
	SampleLimited bool `json:"sampleLimited"`
}

type Detection struct {
	SuggestedScanIntent SuggestedScanIntent       `json:"suggestedScanIntent"`
	Confidence          Confidence                `json:"confidence"`
	ReferenceCoverage   scanner.ReferenceCoverage `json:"referenceCoverage"`
	Evidence            []string                  `json:"evidence"`
	Counts              FileCounts                `json:"counts"`
}

type signals struct {
	counts             FileCounts
	assetFolder        bool
	frontendManifest   bool
	backendManifest    bool
	libraryManifest    bool
	sourceDir          bool
	docsDir            bool
	manifestAssetFiles bool
}

var skipDirs = map[string]bool{
	".git": true, ".next": true, ".cache": true, "build": true, "coverage": true,
	"dist": true, "node_modules": true, "target": true, "tmp": true,
}

var assetExts = map[string]bool{
	".ai": true, ".avif": true, ".fig": true, ".gif": true, ".ico": true,
	".jpeg": true, ".jpg": true, ".m4v": true, ".mkv": true, ".mov": true,
	".mp4": true, ".png": true, ".psd": true, ".sketch": true, ".svg": true,
	".webm": true, ".webp": true,
}

var codeExts = map[string]bool{
	".css": true, ".go": true, ".html": true, ".js": true, ".jsx": true,
	".mjs": true, ".py": true, ".rb": true, ".rs": true, ".scss": true,
	".ts": true, ".tsx": true, ".vue": true,
}

var docExts = map[string]bool{".md": true, ".mdx": true, ".txt": true}

var manifestNames = map[string]string{
	"package.json":   "frontend",
	"vite.config.js": "frontend",
	"vite.config.ts": "frontend",
	"next.config.js": "frontend",
	"next.config.ts": "frontend",
	"go.mod":         "backend",
	"pyproject.toml": "backend",
	"Gemfile":        "backend",
	"composer.json":  "backend",
	"pom.xml":        "backend",
	"build.gradle":   "backend",
	"Cargo.toml":     "library",
}

func Detect(ctx context.Context, root string, excludePatterns []string) (Detection, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return Detection{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Detection{}, err
	}
	if !info.IsDir() {
		return Detection{}, os.ErrInvalid
	}
	sig := signals{}
	err = filepath.WalkDir(abs, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		name := entry.Name()
		if entry.IsDir() {
			lower := strings.ToLower(name)
			if skipDirs[lower] {
				return filepath.SkipDir
			}
			switch lower {
			case "assets", "images", "icons", "sprites", "videos", "media":
				sig.assetFolder = true
			case "src", "app", "pages", "components", "cmd", "internal":
				sig.sourceDir = true
			case "docs", "documentation", "content":
				sig.docsDir = true
			}
			return nil
		}
		if sig.counts.SampledFiles >= maxSampleFiles {
			sig.counts.SampleLimited = true
			return filepath.SkipAll
		}
		repoPath, err := filepath.Rel(abs, path)
		if err != nil {
			return nil
		}
		repoPath = filepath.ToSlash(repoPath)
		if matchesAnyExcludePattern(excludePatterns, repoPath) {
			return nil
		}
		sig.counts.TotalFiles++
		sig.counts.SampledFiles++
		ext := strings.ToLower(filepath.Ext(path))
		if assetExts[ext] {
			sig.counts.AssetFiles++
		}
		if codeExts[ext] {
			sig.counts.CodeFiles++
		}
		if docExts[ext] {
			sig.counts.DocFiles++
		}
		if ext == ".atlas" || ext == ".plist" || ext == ".unity" || ext == ".godot" {
			sig.manifestAssetFiles = true
		}
		if kind, ok := manifestNames[name]; ok {
			sig.counts.ManifestFiles++
			switch kind {
			case "frontend":
				sig.frontendManifest = true
			case "backend":
				sig.backendManifest = true
			case "library":
				sig.libraryManifest = true
			}
		}
		return nil
	})
	if err != nil {
		return Detection{}, err
	}
	return classify(sig), nil
}

func classify(sig signals) Detection {
	total := max(1, sig.counts.SampledFiles)
	assetRatio := percent(sig.counts.AssetFiles, total)
	codeRatio := percent(sig.counts.CodeFiles, total)
	evidence := []string{
		"Sampled " + itoa(sig.counts.SampledFiles) + " files",
		itoa(assetRatio) + "% of sampled files are media or source asset files",
	}
	if sig.counts.ManifestFiles > 0 {
		evidence = append(evidence, "Found "+itoa(sig.counts.ManifestFiles)+" project manifest files")
	} else {
		evidence = append(evidence, "No code manifests found")
	}
	if sig.counts.SampleLimited {
		evidence = append(evidence, "Sample limit reached; suggestion is advisory")
	}

	out := Detection{
		SuggestedScanIntent: SuggestedScanIntentUnknown,
		Confidence:          ConfidenceLow,
		ReferenceCoverage:   scanner.ReferenceCoveragePartial,
		Evidence:            evidence,
		Counts:              sig.counts,
	}
	if sig.counts.SampledFiles == 0 {
		out.Evidence = append(out.Evidence, "Folder is empty")
		return out
	}
	if sig.frontendManifest && sig.sourceDir && codeRatio >= 20 {
		out.SuggestedScanIntent = SuggestedScanIntentCode
		out.Confidence = ConfidenceHigh
		out.ReferenceCoverage = scanner.ReferenceCoverageSupported
		out.Evidence = append(out.Evidence, "Found frontend manifest and source files")
		return out
	}
	if sig.libraryManifest && (sig.docsDir || sig.sourceDir) && assetRatio < 70 {
		out.SuggestedScanIntent = SuggestedScanIntentLibrary
		out.Confidence = ConfidenceMedium
		out.Evidence = append(out.Evidence, "Found reusable library signals")
		return out
	}
	if (sig.backendManifest || sig.sourceDir) && assetRatio >= 30 {
		out.SuggestedScanIntent = SuggestedScanIntentMixed
		out.Confidence = ConfidenceMedium
		out.Evidence = append(out.Evidence, "Found both assets and code/project structure")
		return out
	}
	if sig.backendManifest || (sig.sourceDir && codeRatio >= 20) {
		out.SuggestedScanIntent = SuggestedScanIntentCode
		out.Confidence = ConfidenceMedium
		out.ReferenceCoverage = scanner.ReferenceCoveragePartial
		out.Evidence = append(out.Evidence, "Reference coverage may be partial for this project type")
		return out
	}
	if assetRatio >= 80 && sig.counts.ManifestFiles == 0 && codeRatio <= 5 {
		out.SuggestedScanIntent = SuggestedScanIntentAssetPack
		out.Confidence = ConfidenceHigh
		out.ReferenceCoverage = scanner.ReferenceCoverageNotApplicable
		out.Evidence = append(out.Evidence, "Mostly asset files with no code manifest")
		return out
	}
	if assetRatio >= 60 && sig.assetFolder && sig.counts.ManifestFiles == 0 {
		out.SuggestedScanIntent = SuggestedScanIntentAssetPack
		out.Confidence = ConfidenceMedium
		out.ReferenceCoverage = scanner.ReferenceCoverageNotApplicable
		out.Evidence = append(out.Evidence, "Asset-like folder names dominate")
		return out
	}
	if sig.docsDir && sig.counts.AssetFiles > 0 {
		out.SuggestedScanIntent = SuggestedScanIntentMixed
		out.Confidence = ConfidenceMedium
		out.Evidence = append(out.Evidence, "Found documentation/content and media files")
		return out
	}
	if sig.manifestAssetFiles && assetRatio >= 40 {
		out.SuggestedScanIntent = SuggestedScanIntentAssetPack
		out.Confidence = ConfidenceMedium
		out.ReferenceCoverage = scanner.ReferenceCoverageNotApplicable
		out.Evidence = append(out.Evidence, "Found asset-pack manifest files")
		return out
	}
	return out
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

func percent(value, total int) int {
	if total <= 0 {
		return 0
	}
	return value * 100 / total
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for value > 0 {
		i--
		digits[i] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[i:])
}

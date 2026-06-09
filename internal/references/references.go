package references

import (
	"context"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Project struct {
	ID              string
	Path            string
	ExcludePatterns []string
	ImportAliases   map[string]string
}

type Asset struct {
	ProjectID string
	RepoPath  string
}

type Reference struct {
	ProjectID string `json:"projectId,omitempty"`
	AssetPath string `json:"assetPath,omitempty"`
	File      string `json:"file"`
	Line      int    `json:"line"`
	Specifier string `json:"specifier"`
	Kind      string `json:"kind"`
	Snippet   string `json:"snippet,omitempty"`
}

type ProgressFunc func(current, total int)

type codeCandidate struct {
	project Project
	path    string
	repo    string
}

var imageExts = map[string]bool{
	".avif": true, ".gif": true, ".heic": true, ".heif": true,
	".jpeg": true, ".jpg": true, ".png": true, ".svg": true, ".webp": true,
}

var codeExts = map[string]bool{
	".css": true, ".html": true, ".js": true, ".jsx": true, ".mjs": true,
	".scss": true, ".ts": true, ".tsx": true, ".vue": true,
	".json": true, ".webmanifest": true,
	".md": true, ".mdx": true,
	".yaml": true, ".yml": true, ".toml": true,
}

var quotedSpecRe = regexp.MustCompile(`(?i)['"\x60]([^'"\x60]*(?:\$\{[^'"\x60]*\}|[*{}])?[^'"\x60]*\.(?:avif|gif|heic|heif|jpe?g|png|svg|webp)(?:\?[^'"\x60]*)?)['"\x60]`)
var cssSpecRe = regexp.MustCompile(`(?i)url\(\s*['"]?([^'")\s]+\.(?:avif|gif|heic|heif|jpe?g|png|svg|webp)(?:\?[^'")\s]*)?)['"]?\s*\)`)

func BuildMap(ctx context.Context, projects []Project, assets []Asset) (map[string][]Reference, error) {
	return BuildMapWithProgress(ctx, projects, assets, nil, nil)
}

func BuildMapWithProgress(ctx context.Context, projects []Project, assets []Asset, excludePatterns []string, progress ProgressFunc) (map[string][]Reference, error) {
	assetSets := map[string]map[string]bool{}
	for _, asset := range assets {
		if assetSets[asset.ProjectID] == nil {
			assetSets[asset.ProjectID] = map[string]bool{}
		}
		assetSets[asset.ProjectID][asset.RepoPath] = true
	}
	files, err := collectCodeCandidates(ctx, projects, excludePatterns)
	if err != nil {
		return nil, err
	}
	if progress != nil && len(files) == 0 {
		progress(0, 0)
	}
	out := map[string][]Reference{}
	for i, file := range files {
		bytes, err := os.ReadFile(file.path)
		if err != nil {
			if progress != nil {
				progress(i+1, len(files))
			}
			continue
		}
		for _, ref := range Extract(string(bytes)) {
			ref.File = file.repo
			resolved := ResolveWithAliases(file.project.Path, file.repo, ref.Specifier, file.project.ImportAliases)
			if ref.Kind == "pattern" {
				globPattern := resolvePattern(file.repo, ref.Specifier, file.project.ImportAliases)
				for candidate := range assetSets[file.project.ID] {
					matched := false
					if globPattern != "" {
						matched = globMatchRepoPath(globPattern, candidate)
					}
					if !matched {
						matched = referenceMayPointToWithAliases(file.project.Path, candidate, file.repo, ref.Specifier, file.project.ImportAliases)
					}
					if matched {
						ref.ProjectID = file.project.ID
						ref.AssetPath = candidate
						out[key(file.project.ID, candidate)] = append(out[key(file.project.ID, candidate)], ref)
					}
				}
				continue
			}
			if resolved != "" && assetSets[file.project.ID][resolved] {
				ref.ProjectID = file.project.ID
				ref.AssetPath = resolved
				out[key(file.project.ID, resolved)] = append(out[key(file.project.ID, resolved)], ref)
				continue
			}
			for candidate := range assetSets[file.project.ID] {
				if referenceMayPointToWithAliases(file.project.Path, candidate, file.repo, ref.Specifier, file.project.ImportAliases) {
					ref.ProjectID = file.project.ID
					ref.AssetPath = candidate
					out[key(file.project.ID, candidate)] = append(out[key(file.project.ID, candidate)], ref)
				}
			}
		}
		if progress != nil {
			progress(i+1, len(files))
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	for k := range out {
		sort.Slice(out[k], func(i, j int) bool {
			if out[k][i].File != out[k][j].File {
				return out[k][i].File < out[k][j].File
			}
			if out[k][i].Line != out[k][j].Line {
				return out[k][i].Line < out[k][j].Line
			}
			return out[k][i].Specifier < out[k][j].Specifier
		})
	}
	return out, nil
}

func collectCodeCandidates(ctx context.Context, projects []Project, excludePatterns []string) ([]codeCandidate, error) {
	var files []codeCandidate
	for _, project := range projects {
		projectExcludePatterns := append([]string{}, excludePatterns...)
		projectExcludePatterns = append(projectExcludePatterns, project.ExcludePatterns...)
		err := filepath.WalkDir(project.Path, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if entry.IsDir() {
				if path != project.Path {
					repoDir, err := filepath.Rel(project.Path, path)
					if err == nil && MatchesAnyExcludeDirectory(projectExcludePatterns, filepath.ToSlash(repoDir)) {
						return filepath.SkipDir
					}
				}
				return nil
			}
			if !codeExts[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			repoFile, err := filepath.Rel(project.Path, path)
			if err != nil {
				return nil
			}
			repoFile = filepath.ToSlash(repoFile)
			if MatchesAnyExcludePattern(projectExcludePatterns, repoFile) {
				return nil
			}
			files = append(files, codeCandidate{project: project, path: path, repo: repoFile})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return files, nil
}

func MatchesAnyExcludePattern(patterns []string, repoPath string) bool {
	for _, pattern := range patterns {
		if MatchExcludePattern(pattern, repoPath) {
			return true
		}
	}
	return false
}

func MatchesAnyExcludeDirectory(patterns []string, repoPath string) bool {
	repoPath = strings.Trim(strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(repoPath)), "./"), "/")
	if repoPath == "" || repoPath == "." {
		return false
	}
	for _, pattern := range patterns {
		if MatchExcludePattern(pattern, repoPath) || MatchExcludePattern(pattern, repoPath+"/__aisets_dir_probe__") {
			return true
		}
	}
	return false
}

func MatchExcludePattern(pattern, repoPath string) bool {
	pattern = filepath.ToSlash(strings.TrimSpace(pattern))
	repoPath = strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(repoPath)), "./")
	if pattern == "" || repoPath == "" {
		return false
	}
	pattern = strings.Trim(pattern, "/")
	if pattern == "" {
		return false
	}
	if !strings.Contains(pattern, "/") {
		if ok, _ := filepath.Match(pattern, pathpkg.Base(repoPath)); ok {
			return true
		}
		for _, part := range strings.Split(repoPath, "/") {
			if part == pattern {
				return true
			}
		}
	}
	patternParts := splitPathPattern(pattern)
	pathParts := splitPathPattern(repoPath)
	return matchPathParts(patternParts, pathParts)
}

func splitPathPattern(value string) []string {
	value = strings.Trim(value, "/")
	if value == "" {
		return nil
	}
	return strings.Split(value, "/")
}

func matchPathParts(patternParts, pathParts []string) bool {
	if len(patternParts) == 0 {
		return len(pathParts) == 0
	}
	if patternParts[0] == "**" {
		if matchPathParts(patternParts[1:], pathParts) {
			return true
		}
		for len(pathParts) > 0 {
			pathParts = pathParts[1:]
			if matchPathParts(patternParts[1:], pathParts) {
				return true
			}
		}
		return false
	}
	if len(pathParts) == 0 {
		return false
	}
	matched, err := pathpkg.Match(patternParts[0], pathParts[0])
	if err != nil || !matched {
		return false
	}
	return matchPathParts(patternParts[1:], pathParts[1:])
}

func Extract(content string) []Reference {
	quoted := quotedSpecRe.FindAllStringSubmatchIndex(content, -1)
	css := cssSpecRe.FindAllStringSubmatchIndex(content, -1)
	out := make([]Reference, 0, len(quoted)+len(css))
	cssSpans := make([][2]int, 0, len(css))
	for _, match := range css {
		cssSpans = append(cssSpans, [2]int{match[2], match[3]})
	}
	for _, match := range quoted {
		start, end := match[2], match[3]
		if spanCovered(start, end, cssSpans) {
			continue
		}
		spec := content[start:end]
		if isBareImageExtension(spec) {
			continue
		}
		kind := "string"
		if isPattern(spec) {
			kind = "pattern"
		}
		out = append(out, Reference{Line: lineNumberAt(content, start), Specifier: spec, Kind: kind, Snippet: lineContentAt(content, start)})
	}
	for _, match := range css {
		start, end := match[2], match[3]
		spec := content[start:end]
		if isBareImageExtension(spec) {
			continue
		}
		kind := "css-url"
		if isPattern(spec) {
			kind = "pattern"
		}
		out = append(out, Reference{Line: lineNumberAt(content, start), Specifier: spec, Kind: kind, Snippet: lineContentAt(content, start)})
	}
	return out
}

func spanCovered(start, end int, spans [][2]int) bool {
	for _, span := range spans {
		if start == span[0] && end == span[1] {
			return true
		}
	}
	return false
}

func Resolve(projectRoot, importerRepoPath, specifier string) string {
	return ResolveWithAliases(projectRoot, importerRepoPath, specifier, nil)
}

func ResolveWithAliases(projectRoot, importerRepoPath, specifier string, aliases map[string]string) string {
	spec := stripQuery(filepath.ToSlash(strings.TrimSpace(specifier)))
	if spec == "" || strings.Contains(spec, "${") || strings.ContainsAny(spec, "*{}") {
		return ""
	}
	if resolved := resolveAlias(spec, aliases); resolved != "" {
		return cleanRepoPath(resolved)
	}
	if strings.HasPrefix(spec, "@/") || strings.HasPrefix(spec, "~/") {
		srcBase := findSrcAncestor(importerRepoPath)
		return cleanRepoPath(filepath.ToSlash(filepath.Join(srcBase, spec[2:])))
	}
	if strings.HasPrefix(spec, "/") {
		assetPath := strings.TrimPrefix(spec, "/")
		if publicPath := resolvePublicAsset(projectRoot, importerRepoPath, assetPath); publicPath != "" {
			return publicPath
		}
		if projectPath := resolveProjectAbsoluteAsset(projectRoot, importerRepoPath, assetPath); projectPath != "" {
			return projectPath
		}
		return cleanRepoPath(assetPath)
	}
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../") {
		base := filepath.Dir(filepath.FromSlash(importerRepoPath))
		return cleanRepoPath(filepath.ToSlash(filepath.Join(base, filepath.FromSlash(spec))))
	}
	return cleanRepoPath(spec)
}

func resolvePattern(importerRepoPath, specifier string, aliases map[string]string) string {
	spec := stripQuery(filepath.ToSlash(strings.TrimSpace(specifier)))
	if spec == "" {
		return ""
	}
	if resolved := resolveAlias(spec, aliases); resolved != "" {
		return resolved
	}
	if strings.HasPrefix(spec, "@/") || strings.HasPrefix(spec, "~/") {
		srcBase := findSrcAncestor(importerRepoPath)
		return filepath.ToSlash(filepath.Join(srcBase, spec[2:]))
	}
	if strings.HasPrefix(spec, "/") {
		return strings.TrimPrefix(spec, "/")
	}
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../") {
		base := filepath.Dir(filepath.FromSlash(importerRepoPath))
		return filepath.ToSlash(filepath.Join(base, filepath.FromSlash(spec)))
	}
	return spec
}

func globMatchRepoPath(pattern, repoPath string) bool {
	return matchPathParts(splitPathPattern(pattern), splitPathPattern(repoPath))
}

func resolveAlias(spec string, aliases map[string]string) string {
	if len(aliases) == 0 {
		return ""
	}
	bestKey := ""
	for key := range aliases {
		if (spec == key || strings.HasPrefix(spec, key+"/")) && len(key) > len(bestKey) {
			bestKey = key
		}
	}
	if bestKey == "" {
		return ""
	}
	return aliases[bestKey] + strings.TrimPrefix(spec, bestKey)
}

func findSrcAncestor(importerRepoPath string) string {
	dir := pathpkg.Dir(importerRepoPath)
	for dir != "." && dir != "/" {
		if pathpkg.Base(dir) == "src" {
			return dir
		}
		dir = pathpkg.Dir(dir)
	}
	return "src"
}

func resolvePublicAsset(projectRoot, importerRepoPath, assetPath string) string {
	assetPath = cleanRepoPath(assetPath)
	if assetPath == "" {
		return ""
	}
	for dir := filepath.ToSlash(filepath.Dir(importerRepoPath)); ; dir = parentRepoDir(dir) {
		candidate := cleanRepoPath(filepath.ToSlash(filepath.Join(filepath.FromSlash(dir), "public", filepath.FromSlash(assetPath))))
		if candidate != "" {
			info, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(candidate)))
			if err == nil && !info.IsDir() {
				return candidate
			}
		}
		if dir == "." || dir == "" {
			break
		}
	}
	return ""
}

func resolveProjectAbsoluteAsset(projectRoot, importerRepoPath, assetPath string) string {
	assetPath = cleanRepoPath(assetPath)
	if assetPath == "" {
		return ""
	}
	for dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(importerRepoPath))); ; dir = parentRepoDir(dir) {
		candidate := cleanRepoPath(filepath.ToSlash(filepath.Join(filepath.FromSlash(dir), filepath.FromSlash(assetPath))))
		if candidate != "" {
			info, err := os.Stat(filepath.Join(projectRoot, filepath.FromSlash(candidate)))
			if err == nil && !info.IsDir() {
				return candidate
			}
		}
		if dir == "." || dir == "" {
			break
		}
	}
	return ""
}

func parentRepoDir(dir string) string {
	parent := filepath.ToSlash(filepath.Dir(filepath.FromSlash(dir)))
	if parent == dir {
		return "."
	}
	return parent
}

func CodeExtensions() map[string]bool {
	out := map[string]bool{}
	for k, v := range codeExts {
		out[k] = v
	}
	return out
}

func key(projectID, repoPath string) string {
	return projectID + "\x00" + repoPath
}

func referenceMayPointTo(projectRoot, repoPath, importerRepoPath, specifier string) bool {
	clean := stripQuery(filepath.ToSlash(specifier))
	clean = strings.TrimPrefix(clean, "./")
	if strings.HasPrefix(clean, "@/") || strings.HasPrefix(clean, "~/") {
		expected := cleanRepoPath(filepath.ToSlash(filepath.Join(findSrcAncestor(importerRepoPath), clean[2:])))
		return expected != "" && repoPath == expected
	}
	if strings.HasPrefix(clean, "/") {
		assetPath := strings.TrimPrefix(clean, "/")
		if scoped := resolveProjectAbsoluteAsset(projectRoot, importerRepoPath, assetPath); scoped != "" {
			return repoPath == scoped
		}
		clean = assetPath
	}
	if clean == repoPath || strings.HasSuffix(clean, "/"+repoPath) || strings.HasSuffix(repoPath, "/"+clean) {
		return true
	}
	return false
}

func referenceMayPointToWithAliases(projectRoot, repoPath, importerRepoPath, specifier string, aliases map[string]string) bool {
	if referenceMayPointTo(projectRoot, repoPath, importerRepoPath, specifier) {
		return true
	}
	resolved := resolveAlias(stripQuery(filepath.ToSlash(specifier)), aliases)
	if resolved != "" {
		resolved = cleanRepoPath(resolved)
		if resolved == repoPath || strings.HasSuffix(resolved, "/"+repoPath) || strings.HasSuffix(repoPath, "/"+resolved) {
			return true
		}
	}
	return false
}

func isPattern(spec string) bool {
	return strings.Contains(spec, "${") || strings.ContainsAny(spec, "*{}")
}

func stripQuery(path string) string {
	return strings.Split(strings.TrimSpace(path), "?")[0]
}

func isBareImageExtension(spec string) bool {
	return imageExts[strings.ToLower(stripQuery(spec))]
}

func cleanRepoPath(path string) string {
	path = filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
	path = strings.TrimPrefix(path, "./")
	if path == "." || strings.HasPrefix(path, "../") || strings.HasPrefix(path, "/") {
		return ""
	}
	return path
}

func lineContentAt(content string, index int) string {
	start := index
	for start > 0 && content[start-1] != '\n' {
		start--
	}
	end := index
	for end < len(content) && content[end] != '\n' {
		end++
	}
	return strings.TrimSpace(content[start:end])
}

func lineNumberAt(content string, index int) int {
	line := 1
	for i := 0; i < index && i < len(content); i++ {
		if content[i] == '\n' {
			line++
		}
	}
	return line
}

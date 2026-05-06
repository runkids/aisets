package references

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Project struct {
	ID   string
	Path string
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
}

var imageExts = map[string]bool{
	".avif": true, ".gif": true, ".jpeg": true, ".jpg": true,
	".png": true, ".svg": true, ".webp": true,
}

var codeExts = map[string]bool{
	".css": true, ".html": true, ".js": true, ".jsx": true, ".mjs": true,
	".scss": true, ".ts": true, ".tsx": true, ".vue": true,
}

var skipDirs = map[string]bool{
	".git": true, ".next": true, ".nuxt": true, ".turbo": true, "build": true,
	"coverage": true, "dist": true, "node_modules": true, "storybook-static": true,
}

var quotedSpecRe = regexp.MustCompile(`(?i)['"\x60]([^'"\x60]*(?:\$\{[^'"\x60]*\}|[*{}])?[^'"\x60]*\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^'"\x60]*)?)['"\x60]`)
var cssSpecRe = regexp.MustCompile(`(?i)url\(\s*['"]?([^'")\s]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^'")\s]*)?)['"]?\s*\)`)

func BuildMap(ctx context.Context, projects []Project, assets []Asset) (map[string][]Reference, error) {
	assetSets := map[string]map[string]bool{}
	for _, asset := range assets {
		if assetSets[asset.ProjectID] == nil {
			assetSets[asset.ProjectID] = map[string]bool{}
		}
		assetSets[asset.ProjectID][asset.RepoPath] = true
	}
	out := map[string][]Reference{}
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
			if !codeExts[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			bytes, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			repoFile, err := filepath.Rel(project.Path, path)
			if err != nil {
				return nil
			}
			repoFile = filepath.ToSlash(repoFile)
			for _, ref := range Extract(string(bytes)) {
				ref.File = repoFile
				resolved := Resolve(project.Path, repoFile, ref.Specifier)
				if ref.Kind == "pattern" {
					for candidate := range assetSets[project.ID] {
						if referenceMayPointTo(candidate, ref.Specifier) {
							ref.ProjectID = project.ID
							ref.AssetPath = candidate
							out[key(project.ID, candidate)] = append(out[key(project.ID, candidate)], ref)
						}
					}
					continue
				}
				if resolved != "" && assetSets[project.ID][resolved] {
					ref.ProjectID = project.ID
					ref.AssetPath = resolved
					out[key(project.ID, resolved)] = append(out[key(project.ID, resolved)], ref)
					continue
				}
				for candidate := range assetSets[project.ID] {
					if referenceMayPointTo(candidate, ref.Specifier) {
						ref.ProjectID = project.ID
						ref.AssetPath = candidate
						out[key(project.ID, candidate)] = append(out[key(project.ID, candidate)], ref)
					}
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
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
		kind := "string"
		if isPattern(spec) {
			kind = "pattern"
		}
		out = append(out, Reference{Line: lineNumberAt(content, start), Specifier: spec, Kind: kind})
	}
	for _, match := range css {
		start, end := match[2], match[3]
		spec := content[start:end]
		kind := "css-url"
		if isPattern(spec) {
			kind = "pattern"
		}
		out = append(out, Reference{Line: lineNumberAt(content, start), Specifier: spec, Kind: kind})
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
	spec := stripQuery(filepath.ToSlash(strings.TrimSpace(specifier)))
	if spec == "" || strings.Contains(spec, "${") || strings.ContainsAny(spec, "*{}") {
		return ""
	}
	if strings.HasPrefix(spec, "@/") {
		return cleanRepoPath(filepath.ToSlash(filepath.Join("src", strings.TrimPrefix(spec, "@/"))))
	}
	if strings.HasPrefix(spec, "/") {
		return cleanRepoPath(strings.TrimPrefix(spec, "/"))
	}
	if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../") {
		base := filepath.Dir(filepath.FromSlash(importerRepoPath))
		return cleanRepoPath(filepath.ToSlash(filepath.Join(base, filepath.FromSlash(spec))))
	}
	return cleanRepoPath(spec)
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

func referenceMayPointTo(repoPath, specifier string) bool {
	clean := stripQuery(filepath.ToSlash(specifier))
	clean = strings.TrimPrefix(clean, "./")
	return clean == repoPath || strings.HasSuffix(clean, "/"+repoPath) || strings.HasSuffix(repoPath, clean)
}

func isPattern(spec string) bool {
	return strings.Contains(spec, "${") || strings.ContainsAny(spec, "*{}")
}

func stripQuery(path string) string {
	return strings.Split(strings.TrimSpace(path), "?")[0]
}

func cleanRepoPath(path string) string {
	path = filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
	path = strings.TrimPrefix(path, "./")
	if path == "." || strings.HasPrefix(path, "../") || strings.HasPrefix(path, "/") {
		return ""
	}
	return path
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

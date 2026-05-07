package scanner

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"asset-studio/internal/references"
)

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

type fileCandidate struct {
	project Project
	path    string
	repo    string
	info    os.FileInfo
}

func collectCandidates(ctx context.Context, projects []Project, excludePatterns []string) ([]fileCandidate, error) {
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
			repoPath, err := filepath.Rel(project.Path, path)
			if err != nil {
				return nil
			}
			repoPath = filepath.ToSlash(repoPath)
			if references.MatchesAnyExcludePattern(excludePatterns, repoPath) {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return nil
			}
			candidates = append(candidates, fileCandidate{
				project: project,
				path:    path,
				repo:    repoPath,
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

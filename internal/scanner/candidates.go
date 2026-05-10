package scanner

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"aisets/internal/references"
)

var imageExts = map[string]bool{
	".avif": true,
	".gif":  true,
	".heic": true,
	".heif": true,
	".jpeg": true,
	".jpg":  true,
	".png":  true,
	".svg":  true,
	".webp": true,
}

type fileCandidate struct {
	project Project
	path    string
	repo    string
	info    os.FileInfo
}

func collectCandidates(ctx context.Context, projects []Project, options ScanOptions) ([]fileCandidate, error) {
	var candidates []fileCandidate
	for _, project := range projects {
		excludePatterns := EffectiveExcludePatterns(project, options)
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
					if err == nil && references.MatchesAnyExcludeDirectory(excludePatterns, filepath.ToSlash(repoDir)) {
						return filepath.SkipDir
					}
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

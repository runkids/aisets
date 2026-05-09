package config

import (
	"sort"
	"strings"
)

func (s *Store) CatalogFolders(query CatalogFolderQuery) (CatalogFoldersPage, error) {
	scanID, err := s.resolveScanID(query.ScanID)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	parent := normalizeCatalogFolder(query.Folder)
	whereQuery := CatalogItemQuery{
		ScanID:         scanID,
		ProjectID:      query.ProjectID,
		ProjectName:    query.ProjectName,
		Ext:            query.Ext,
		Folder:         parent,
		Query:          query.Query,
		Status:         query.Status,
		CustomFilterID: query.CustomFilterID,
	}
	where, args, err := s.catalogItemWhere(scanID, whereQuery)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	rows, err := s.rdb.Query(`
		SELECT a.repo_path
		FROM asset_snapshots a
		`+where+`
		ORDER BY a.repo_path COLLATE NOCASE ASC, a.repo_path ASC
	`, args...)
	if err != nil {
		return CatalogFoldersPage{}, err
	}
	defer rows.Close()

	type folderAccumulator struct {
		name        string
		count       int
		hasChildren bool
	}
	total := 0
	folders := map[string]*folderAccumulator{}
	for rows.Next() {
		var repoPath string
		if err := rows.Scan(&repoPath); err != nil {
			return CatalogFoldersPage{}, err
		}
		total++
		childPath, childName, hasNestedChild := immediateChildFolder(parent, repoPath)
		if childPath == "" {
			continue
		}
		acc := folders[childPath]
		if acc == nil {
			acc = &folderAccumulator{name: childName}
			folders[childPath] = acc
		}
		acc.count++
		if hasNestedChild {
			acc.hasChildren = true
		}
	}
	if err := rows.Err(); err != nil {
		return CatalogFoldersPage{}, err
	}
	paths := make([]string, 0, len(folders))
	for path := range folders {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool {
		left := strings.ToLower(paths[i])
		right := strings.ToLower(paths[j])
		if left == right {
			return paths[i] < paths[j]
		}
		return left < right
	})
	out := make([]CatalogFolderNode, 0, len(paths))
	for _, path := range paths {
		acc := folders[path]
		out = append(out, CatalogFolderNode{
			ID:          path,
			Name:        acc.name,
			Path:        path,
			Count:       acc.count,
			HasChildren: acc.hasChildren,
		})
	}
	return CatalogFoldersPage{Folders: out, Total: total}, nil
}

func immediateChildFolder(parent, repoPath string) (string, string, bool) {
	parent = normalizeCatalogFolder(parent)
	repoPath = strings.Trim(repoPath, "/")
	rest := repoPath
	if parent != "" {
		prefix := parent + "/"
		if !strings.HasPrefix(repoPath, prefix) {
			return "", "", false
		}
		rest = strings.TrimPrefix(repoPath, prefix)
	}
	slash := strings.Index(rest, "/")
	if slash < 0 {
		return "", "", false
	}
	name := rest[:slash]
	if name == "" {
		return "", "", false
	}
	childPath := name
	if parent != "" {
		childPath = parent + "/" + name
	}
	return childPath, name, strings.Contains(rest[slash+1:], "/")
}

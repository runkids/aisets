package config

import (
	"database/sql"
	"errors"
	"strings"

	"aisets/internal/scanner"
)

func (s *Store) SetAssetFavorite(scanID int64, assetID string, favorite bool) (scanner.AssetItem, error) {
	item, err := s.CatalogItem(scanID, assetID)
	if err != nil {
		return scanner.AssetItem{}, err
	}
	if err := s.setAssetFavorites([]scanner.AssetItem{item}, favorite); err != nil {
		return scanner.AssetItem{}, err
	}
	item.Favorite = favorite
	return item, nil
}

func (s *Store) SetAssetFavorites(scanID int64, assetIDs []string, favorite bool) ([]scanner.AssetItem, error) {
	items, err := s.CatalogItemsByIDs(scanID, assetIDs)
	if err != nil {
		return nil, err
	}
	if err := s.setAssetFavorites(items, favorite); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Favorite = favorite
	}
	return items, nil
}

func (s *Store) MoveAssetFavorite(projectID, sourcePath, targetPath string) error {
	projectID = strings.TrimSpace(projectID)
	sourcePath = strings.TrimSpace(sourcePath)
	targetPath = strings.TrimSpace(targetPath)
	if projectID == "" || sourcePath == "" || targetPath == "" || sourcePath == targetPath {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var createdAt string
	err = tx.QueryRow(`
		SELECT created_at
		FROM asset_favorites
		WHERE project_id = ? AND repo_path = ?
	`, projectID, sourcePath).Scan(&createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO asset_favorites (project_id, repo_path, created_at)
		VALUES (?, ?, ?)
	`, projectID, targetPath, createdAt); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		DELETE FROM asset_favorites
		WHERE project_id = ? AND repo_path = ?
	`, projectID, sourcePath); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteAssetFavorite(projectID, repoPath string) error {
	projectID = strings.TrimSpace(projectID)
	repoPath = strings.TrimSpace(repoPath)
	if projectID == "" || repoPath == "" {
		return nil
	}
	_, err := s.db.Exec(`
		DELETE FROM asset_favorites
		WHERE project_id = ? AND repo_path = ?
	`, projectID, repoPath)
	return err
}

func (s *Store) hydrateAssetFavorites(items []scanner.AssetItem) error {
	if len(items) == 0 {
		return nil
	}
	clauses := make([]string, 0, len(items))
	args := make([]any, 0, len(items)*2)
	seen := map[string]bool{}
	for _, item := range items {
		key := item.ProjectID + "\x00" + item.RepoPath
		if item.ProjectID == "" || item.RepoPath == "" || seen[key] {
			continue
		}
		seen[key] = true
		clauses = append(clauses, "(project_id = ? AND repo_path = ?)")
		args = append(args, item.ProjectID, item.RepoPath)
	}
	if len(clauses) == 0 {
		return nil
	}
	rows, err := s.rdb.Query(`
		SELECT project_id, repo_path
		FROM asset_favorites
		WHERE `+strings.Join(clauses, " OR "), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	favorites := map[string]bool{}
	for rows.Next() {
		var projectID, repoPath string
		if err := rows.Scan(&projectID, &repoPath); err != nil {
			return err
		}
		favorites[projectID+"\x00"+repoPath] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		items[index].Favorite = favorites[items[index].ProjectID+"\x00"+items[index].RepoPath]
	}
	return nil
}

func (s *Store) setAssetFavorites(items []scanner.AssetItem, favorite bool) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var stmt *sql.Stmt
	if favorite {
		stmt, err = tx.Prepare(`
			INSERT OR IGNORE INTO asset_favorites (project_id, repo_path, created_at)
			VALUES (?, ?, ?)
		`)
	} else {
		stmt, err = tx.Prepare(`
			DELETE FROM asset_favorites
			WHERE project_id = ? AND repo_path = ?
		`)
	}
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, item := range items {
		if item.ProjectID == "" || item.RepoPath == "" {
			continue
		}
		if favorite {
			if _, err := stmt.Exec(item.ProjectID, item.RepoPath, nowUTC()); err != nil {
				return err
			}
		} else {
			if _, err := stmt.Exec(item.ProjectID, item.RepoPath); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

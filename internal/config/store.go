package config

import (
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct {
	path string
	db   *sql.DB
}

func DataDir() string {
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		return filepath.Join(xdg, "asset-studio")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".asset-studio-data"
	}
	return filepath.Join(home, ".local", "share", "asset-studio")
}

func CacheDir() string {
	if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
		return filepath.Join(xdg, "asset-studio")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".asset-studio-cache"
	}
	return filepath.Join(home, ".cache", "asset-studio")
}

func OpenStore() (*Store, error) {
	if err := os.MkdirAll(DataDir(), 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(DataDir(), "asset-studio.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{path: path, db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

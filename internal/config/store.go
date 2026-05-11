package config

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	path string
	db   *sql.DB // write connection (MaxOpenConns=1)
	rdb  *sql.DB // read pool (MaxOpenConns=4), WAL concurrent reads

	latestScanID   int64
	latestScanMu   sync.RWMutex
	latestScanTime time.Time
}

func DataDir() string {
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		return filepath.Join(xdg, "aisets")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".aisets-data"
	}
	return filepath.Join(home, ".local", "share", "aisets")
}

func CacheDir() string {
	if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
		return filepath.Join(xdg, "aisets")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".aisets-cache"
	}
	return filepath.Join(home, ".cache", "aisets")
}

func OpenStore() (*Store, error) {
	if err := os.MkdirAll(DataDir(), 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(DataDir(), "aisets.db")
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	rdb, err := sql.Open("sqlite", dsn)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	rdb.SetMaxOpenConns(4)

	store := &Store{path: path, db: db, rdb: rdb}
	if err := store.init(); err != nil {
		_ = db.Close()
		_ = rdb.Close()
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
	var rdbErr error
	if s.rdb != nil {
		rdbErr = s.rdb.Close()
	}
	return errors.Join(rdbErr, s.db.Close())
}

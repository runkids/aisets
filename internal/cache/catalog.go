package cache

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"aisets/internal/imageproc"
)

type Store struct {
	path  string
	mu    sync.Mutex
	data  fileData
	dirty bool
}

type fileData struct {
	Version int               `json:"version"`
	Items   map[string]Record `json:"items"`
}

type Record struct {
	ProjectID      string                   `json:"projectId"`
	RepoPath       string                   `json:"repoPath"`
	Size           int64                    `json:"size"`
	MTimeUnix      int64                    `json:"mtimeUnix"`
	ContentHash    string                   `json:"contentHash,omitempty"`
	HashAlgorithm  string                   `json:"hashAlgorithm,omitempty"`
	Metadata       imageproc.Metadata       `json:"metadata"`
	Hashes         imageproc.Hashes         `json:"hashes"`
	Optimization   []imageproc.Optimization `json:"optimization,omitempty"`
	ThresholdsHash string                   `json:"thresholdsHash,omitempty"`
	ThumbKey       string                   `json:"thumbKey,omitempty"`
	UpdatedAt      string                   `json:"updatedAt"`
}

func Open(dir string) (*Store, error) {
	if dir == "" {
		cacheDir, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(cacheDir, "aisets", "catalog")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		path: filepath.Join(dir, "catalog-cache.json"),
		data: fileData{Version: 1, Items: map[string]Record{}},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Get(key string, size, mtimeUnix int64) (Record, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.data.Items[key]
	if !ok || record.Size != size || record.MTimeUnix != mtimeUnix {
		return Record{}, false
	}
	return record, true
}

func (s *Store) Set(key string, record Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Items == nil {
		s.data.Items = map[string]Record{}
	}
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.data.Items[key] = record
	s.dirty = true
	return nil
}

func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	if err := s.saveLocked(); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) load() error {
	bytes, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var data fileData
	if err := json.Unmarshal(bytes, &data); err != nil {
		s.data = fileData{Version: 1, Items: map[string]Record{}}
		return nil
	}
	if data.Items == nil {
		data.Items = map[string]Record{}
	}
	if data.Version == 0 {
		data.Version = 1
	}
	s.data = data
	return nil
}

func (s *Store) saveLocked() error {
	tmp := s.path + ".tmp"
	bytes, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, bytes, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

package uidist

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"aisets/internal/config"
	"aisets/internal/version"
)

const AssetName = "aisets-ui-dist.tar.gz"

func CacheDir(ver string) string {
	return filepath.Join(config.CacheDir(), "ui", ver)
}

func IsCached(ver string) bool {
	_, err := os.Stat(filepath.Join(CacheDir(ver), "index.html"))
	return err == nil
}

func ClearCache() error {
	return os.RemoveAll(filepath.Join(config.CacheDir(), "ui"))
}

func Download(ver string) error {
	expected, err := fetchChecksum(ver)
	if err != nil {
		return err
	}
	resp, err := http.Get(version.BuildUIDistURL(ver))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download UI dist: %s", resp.Status)
	}
	tmp, err := os.CreateTemp("", "aisets-ui-*.tar.gz")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hash), io.LimitReader(resp.Body, 100<<20)); err != nil {
		return err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != expected {
		return fmt.Errorf("checksum mismatch for %s", AssetName)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return err
	}
	dest := CacheDir(ver)
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	return extractTarGz(tmp, dest)
}

func fetchChecksum(ver string) (string, error) {
	resp, err := http.Get(version.BuildChecksumsURL(ver))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download checksums: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.TrimPrefix(fields[1], "*") == AssetName {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("checksum for %s not found", AssetName)
}

func extractTarGz(r io.Reader, dest string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	root, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(header.Name)
		if name == "." && header.Typeflag == tar.TypeDir {
			continue
		}
		if name == "." || strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("unsafe archive path: %s", header.Name)
		}
		target := filepath.Join(root, name)
		absTarget, err := filepath.Abs(target)
		if err != nil {
			return err
		}
		if absTarget != root && !strings.HasPrefix(absTarget, root+string(os.PathSeparator)) {
			return fmt.Errorf("archive path escapes destination: %s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(absTarget, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if header.Size > 50<<20 {
				return fmt.Errorf("archive file too large: %s", header.Name)
			}
			if err := os.MkdirAll(filepath.Dir(absTarget), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(absTarget, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(out, io.LimitReader(tr, header.Size))
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			return fmt.Errorf("unsupported archive entry: %s", header.Name)
		}
	}
}

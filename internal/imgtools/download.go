package imgtools

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"aisets/internal/version"
)

const cacheDownloadLimit = 200 << 20

var (
	httpClient      = http.DefaultClient
	cacheRoot       = defaultCacheRoot
	downloadTimeout = 30 * time.Second
)

func cachedBinary() (string, error) {
	ver := normalizeAppVersion(appVersion)
	if isDevVersion(ver) {
		return "", fmt.Errorf("skip versioned %s cache in dev version", binaryName)
	}
	name := platformBinaryName()
	target := filepath.Join(cacheRoot(), "imgtools", ver, name)
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
	defer cancel()
	return downloadCachedBinary(ctx, ver)
}

func downloadCachedBinary(ctx context.Context, ver string) (string, error) {
	ver = normalizeAppVersion(ver)
	assetName := version.BuildBinaryAssetName(ver, runtime.GOOS, runtime.GOARCH)
	expected, err := fetchChecksumForAsset(ctx, ver, assetName)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, version.BuildBinaryDownloadURL(ver, runtime.GOOS, runtime.GOARCH), nil)
	if err != nil {
		return "", err
	}
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %s", binaryName, resp.Status)
	}
	tmpArchive, err := os.CreateTemp("", "aisets-imgtools-*.archive")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpArchive.Name())
	defer tmpArchive.Close()
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpArchive, hash), io.LimitReader(resp.Body, cacheDownloadLimit)); err != nil {
		return "", err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != expected {
		return "", fmt.Errorf("checksum mismatch for %s", assetName)
	}
	if _, err := tmpArchive.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	extracted, err := extractImgtools(tmpArchive.Name(), tmpArchive, runtime.GOOS)
	if err != nil {
		return "", err
	}
	defer os.Remove(extracted)

	targetDir := filepath.Join(cacheRoot(), "imgtools", ver)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(targetDir, platformBinaryName())
	if err := os.Chmod(extracted, 0o755); err != nil {
		return "", err
	}
	_ = os.Remove(target)
	if err := os.Rename(extracted, target); err != nil {
		return "", fmt.Errorf("cache %s: %w", binaryName, err)
	}
	return target, nil
}

func fetchChecksumForAsset(ctx context.Context, ver, assetName string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, version.BuildChecksumsURL(ver), nil)
	if err != nil {
		return "", err
	}
	client := httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
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
		if len(fields) >= 2 && strings.TrimPrefix(fields[1], "*") == assetName {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

func extractImgtools(name string, r io.ReaderAt, goos string) (string, error) {
	if goos == "windows" {
		return extractZipImgtools(name, r, goos)
	}
	return extractTarImgtools(r, goos)
}

func extractZipImgtools(name string, r io.ReaderAt, goos string) (string, error) {
	stat, err := os.Stat(name)
	if err != nil {
		return "", err
	}
	zr, err := zip.NewReader(r, stat.Size())
	if err != nil {
		return "", err
	}
	want := imgtoolsBinaryName(goos)
	for _, file := range zr.File {
		if filepath.Base(file.Name) != want {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return "", err
		}
		path, err := writeTempBinary(rc)
		closeErr := rc.Close()
		if err != nil {
			return "", err
		}
		if closeErr != nil {
			_ = os.Remove(path)
			return "", closeErr
		}
		return path, nil
	}
	return "", fmt.Errorf("%s not found in archive", want)
}

func extractTarImgtools(r io.ReaderAt, goos string) (string, error) {
	gz, err := gzip.NewReader(io.NewSectionReader(r, 0, 1<<63-1))
	if err != nil {
		return "", err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	want := imgtoolsBinaryName(goos)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		if header.Typeflag != tar.TypeReg || filepath.Base(header.Name) != want {
			continue
		}
		return writeTempBinary(tr)
	}
	return "", fmt.Errorf("%s not found in archive", want)
}

func defaultCacheRoot() string {
	if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
		return filepath.Join(xdg, "aisets")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".aisets-cache"
	}
	return filepath.Join(home, ".cache", "aisets")
}

func writeTempBinary(r io.Reader) (string, error) {
	file, err := os.CreateTemp("", "aisets-imgtools-bin-*")
	if err != nil {
		return "", err
	}
	path := file.Name()
	_, copyErr := io.Copy(file, r)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(path)
		return "", copyErr
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return "", closeErr
	}
	return path, nil
}

func normalizeAppVersion(ver string) string {
	ver = strings.TrimSpace(ver)
	ver = strings.TrimPrefix(ver, "v")
	if ver == "" {
		return "dev"
	}
	return ver
}

func isDevVersion(ver string) bool {
	ver = strings.TrimSpace(ver)
	return ver == "" || ver == "dev" || strings.Contains(ver, "dev")
}

func platformBinaryName() string {
	return imgtoolsBinaryName(runtime.GOOS)
}

func imgtoolsBinaryName(goos string) string {
	if goos == "windows" {
		return binaryName + ".exe"
	}
	return binaryName
}

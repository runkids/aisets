package imgtools

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"aisets/internal/version"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func testBytesResponse(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(body)),
	}
}

func TestDownloadCachedBinaryDownloadsImgtoolsFromReleaseArchive(t *testing.T) {
	archive := buildImgtoolsArchive(t, []byte("new imgtools"))
	sum := sha256.Sum256(archive)
	checksum := hex.EncodeToString(sum[:])
	assetName := version.BuildBinaryAssetName("1.2.3", runtime.GOOS, runtime.GOARCH)

	oldClient := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case version.BuildChecksumsURL("1.2.3"):
			return testBytesResponse(http.StatusOK, []byte(checksum+"  "+assetName+"\n")), nil
		case version.BuildBinaryDownloadURL("1.2.3", runtime.GOOS, runtime.GOARCH):
			return testBytesResponse(http.StatusOK, archive), nil
		default:
			t.Fatalf("unexpected URL: %s", r.URL.String())
			return nil, nil
		}
	})}
	t.Cleanup(func() { httpClient = oldClient })

	root := t.TempDir()
	oldCacheRoot := cacheRoot
	cacheRoot = func() string { return root }
	t.Cleanup(func() { cacheRoot = oldCacheRoot })

	path, err := downloadCachedBinary(t.Context(), "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "imgtools", "1.2.3", platformBinaryName())
	if path != want {
		t.Fatalf("cached path = %q, want %q", path, want)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "new imgtools" {
		t.Fatalf("cached content = %q", content)
	}
}

func TestCachedBinaryUsesExistingVersionedCache(t *testing.T) {
	root := t.TempDir()
	oldCacheRoot := cacheRoot
	cacheRoot = func() string { return root }
	t.Cleanup(func() { cacheRoot = oldCacheRoot })

	dir := filepath.Join(root, "imgtools", "2.0.0")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, platformBinaryName())
	if err := os.WriteFile(want, []byte("cached"), 0o755); err != nil {
		t.Fatal(err)
	}

	oldVersion := appVersion
	appVersion = "2.0.0"
	t.Cleanup(func() { appVersion = oldVersion })

	path, err := cachedBinary()
	if err != nil {
		t.Fatal(err)
	}
	if path != want {
		t.Fatalf("cached path = %q, want %q", path, want)
	}
}

func TestCachedBinarySkipsDevVersion(t *testing.T) {
	oldVersion := appVersion
	appVersion = "dev"
	t.Cleanup(func() { appVersion = oldVersion })

	_, err := cachedBinary()
	if err == nil || !strings.Contains(err.Error(), "dev version") {
		t.Fatalf("cachedBinary() err = %v, want dev-version skip", err)
	}
}

func buildImgtoolsArchive(t *testing.T, content []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	name := imgtoolsBinaryName(runtime.GOOS)
	if runtime.GOOS == "windows" {
		zw := zip.NewWriter(&buf)
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatal(err)
		}
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

package uidist

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCacheDirIsCachedAndClearCache(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", root)
	wantDir := filepath.Join(root, "asset-studio", "ui", "1.2.3")
	if got := CacheDir("1.2.3"); got != wantDir {
		t.Fatalf("CacheDir() = %q, want %q", got, wantDir)
	}
	if IsCached("1.2.3") {
		t.Fatal("expected fresh cache to be missing")
	}
	if err := os.MkdirAll(wantDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wantDir, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsCached("1.2.3") {
		t.Fatal("expected index.html to mark cache as present")
	}
	if err := ClearCache(); err != nil {
		t.Fatal(err)
	}
	if IsCached("1.2.3") {
		t.Fatal("expected ClearCache to remove cached UI")
	}
}

func TestDownloadCachesVerifiedArchive(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", root)
	archive := tarGz(t, tarEntry{Name: "index.html", Body: "<html>ok</html>"})
	sum := sha256.Sum256(archive)
	checksum := hex.EncodeToString(sum[:]) + " *" + AssetName + "\n"
	withHTTPTransport(t, func(req *http.Request) (*http.Response, error) {
		body := archive
		if strings.HasSuffix(req.URL.Path, "/checksums.txt") {
			body = []byte(checksum)
		}
		return response(http.StatusOK, body), nil
	})

	if err := Download("1.2.3"); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(CacheDir("1.2.3"), "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "<html>ok</html>" || !IsCached("1.2.3") {
		t.Fatalf("cached index = %q, cached=%v", bytes, IsCached("1.2.3"))
	}
}

func TestDownloadRejectsChecksumMismatch(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	archive := tarGz(t, tarEntry{Name: "index.html", Body: "<html>ok</html>"})
	withHTTPTransport(t, func(req *http.Request) (*http.Response, error) {
		body := archive
		if strings.HasSuffix(req.URL.Path, "/checksums.txt") {
			body = []byte(strings.Repeat("0", 64) + " *" + AssetName + "\n")
		}
		return response(http.StatusOK, body), nil
	})

	err := Download("1.2.3")
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("Download mismatch err = %v", err)
	}
	if IsCached("1.2.3") {
		t.Fatal("mismatched archive should not be cached")
	}
}

func TestFetchChecksumHandlesStatusAndMissingAsset(t *testing.T) {
	withHTTPTransport(t, func(req *http.Request) (*http.Response, error) {
		return response(http.StatusNotFound, []byte("missing")), nil
	})
	if _, err := fetchChecksum("1.2.3"); err == nil || !strings.Contains(err.Error(), "download checksums") {
		t.Fatalf("fetchChecksum status err = %v", err)
	}

	withHTTPTransport(t, func(req *http.Request) (*http.Response, error) {
		return response(http.StatusOK, []byte("abc other-file.tar.gz\n")), nil
	})
	if _, err := fetchChecksum("1.2.3"); err == nil || !strings.Contains(err.Error(), "checksum for") {
		t.Fatalf("fetchChecksum missing err = %v", err)
	}
}

func TestExtractTarGzWritesFilesAndRejectsUnsupportedEntries(t *testing.T) {
	dest := t.TempDir()
	archive := tarGz(t,
		tarEntry{Name: "assets", Type: tar.TypeDir},
		tarEntry{Name: "assets/index.html", Body: "ok"},
	)
	if err := extractTarGz(bytes.NewReader(archive), dest); err != nil {
		t.Fatal(err)
	}
	fileBytes, err := os.ReadFile(filepath.Join(dest, "assets", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(fileBytes) != "ok" {
		t.Fatalf("extracted file = %q", fileBytes)
	}

	unsupported := tarGz(t, tarEntry{Name: "link", Type: tar.TypeSymlink})
	err = extractTarGz(bytes.NewReader(unsupported), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "unsupported archive entry") {
		t.Fatalf("unsupported err = %v", err)
	}
}

func TestExtractTarGzRejectsTraversal(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "../evil.txt", Mode: 0o644, Size: 4}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("evil")); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	err := extractTarGz(bytes.NewReader(buf.Bytes()), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "unsafe archive path") {
		t.Fatalf("err = %v, want unsafe archive path", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func withHTTPTransport(t *testing.T, fn roundTripFunc) {
	t.Helper()
	old := http.DefaultTransport
	http.DefaultTransport = fn
	t.Cleanup(func() { http.DefaultTransport = old })
}

func response(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{},
	}
}

type tarEntry struct {
	Name string
	Body string
	Type byte
}

func tarGz(t *testing.T, entries ...tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, entry := range entries {
		typeFlag := entry.Type
		if typeFlag == 0 {
			typeFlag = tar.TypeReg
		}
		header := &tar.Header{Name: entry.Name, Mode: 0o644, Typeflag: typeFlag, Size: int64(len(entry.Body))}
		if typeFlag == tar.TypeDir {
			header.Mode = 0o755
			header.Size = 0
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := tw.Write([]byte(entry.Body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

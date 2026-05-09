package version

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
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewBufferString(body)),
	}
}

func bytesResponse(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(body)),
	}
}

func TestFetchLatestVersion(t *testing.T) {
	oldClient := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != githubAPIURL {
			t.Fatalf("unexpected URL: %s", r.URL.String())
		}
		return jsonResponse(http.StatusOK, `{"tag_name":"v1.2.3"}`), nil
	})}
	t.Cleanup(func() { httpClient = oldClient })

	latest, err := FetchLatestVersion(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if latest != "1.2.3" {
		t.Fatalf("latest = %q", latest)
	}
}

func TestCheckReportsReleaseUpdate(t *testing.T) {
	oldClient := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != githubAPIURL {
			t.Fatalf("unexpected URL: %s", r.URL.String())
		}
		return jsonResponse(http.StatusOK, `{"tag_name":"v1.2.4"}`), nil
	})}
	t.Cleanup(func() { httpClient = oldClient })

	result, err := Check(t.Context(), "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if !result.UpdateAvailable || result.CurrentVersion != "1.2.3" || result.LatestVersion != "1.2.4" {
		t.Fatalf("Check() = %#v", result)
	}
}

func TestUpgradeDevMode(t *testing.T) {
	result, err := Upgrade(t.Context(), UpgradeOptions{CurrentVersion: "dev"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.DevMode || !result.Updated || result.LatestVersion != "0.1.1-dev" {
		t.Fatalf("Upgrade(dev) = %#v", result)
	}
}

func TestUpgradeDownloadsAndReplacesBinary(t *testing.T) {
	archive := buildTestArchive(t, []byte("new binary"))
	sum := sha256.Sum256(archive)
	checksum := hex.EncodeToString(sum[:])
	assetName := BuildBinaryAssetName("1.0.1", runtime.GOOS, runtime.GOARCH)

	oldClient := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case githubAPIURL:
			return jsonResponse(http.StatusOK, `{"tag_name":"v1.0.1"}`), nil
		case BuildChecksumsURL("1.0.1"):
			return jsonResponse(http.StatusOK, checksum+"  "+assetName+"\n"), nil
		case BuildBinaryDownloadURL("1.0.1", runtime.GOOS, runtime.GOARCH):
			return bytesResponse(http.StatusOK, archive), nil
		default:
			t.Fatalf("unexpected URL: %s", r.URL.String())
			return nil, nil
		}
	})}
	t.Cleanup(func() { httpClient = oldClient })

	execPath := filepath.Join(t.TempDir(), executableName())
	if err := os.WriteFile(execPath, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	result, err := Upgrade(t.Context(), UpgradeOptions{CurrentVersion: "1.0.0", ExecPath: execPath})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Updated || result.LatestVersion != "1.0.1" {
		t.Fatalf("Upgrade() = %#v", result)
	}
	content, err := os.ReadFile(execPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "new binary" {
		t.Fatalf("binary content = %q", content)
	}
}

func buildTestArchive(t *testing.T, content []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if runtime.GOOS == "windows" {
		zw := zip.NewWriter(&buf)
		w, err := zw.Create("aisets.exe")
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
	if err := tw.WriteHeader(&tar.Header{Name: "aisets", Mode: 0o755, Size: int64(len(content))}); err != nil {
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

func executableName() string {
	if runtime.GOOS == "windows" {
		return "aisets.exe"
	}
	return "aisets"
}

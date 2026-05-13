package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aisets/internal/apierr"
	"aisets/internal/config"
)

func resolvedTempDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func TestAPIVersionAndUpdateDevMode(t *testing.T) {
	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "dev"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"devMode":true`) || !strings.Contains(rec.Body.String(), `"latestVersion":"0.1.1-dev"`) {
		t.Fatalf("version = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/update", strings.NewReader(`{}`))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"updated":true`) || !strings.Contains(rec.Body.String(), `"devMode":true`) {
		t.Fatalf("update = %d %s", rec.Code, rec.Body.String())
	}
}

func TestAPIHealthCatalogScanAssetsThumbsAndOptimizationPreview(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	logoPath := filepath.Join(root, "src", "logo.png")
	writePNG(t, logoPath)
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import logo from "./logo.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("health = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", rec.Code, rec.Body.String())
	}
	var summary struct {
		ScanID int64 `json:"scanId"`
		Stats  struct {
			TotalFiles int `json:"totalFiles"`
		} `json:"stats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.ScanID == 0 || summary.Stats.TotalFiles != 1 {
		t.Fatalf("catalog summary = %#v", summary)
	}
	items := catalogItemsForTest(t, s)
	if len(items) != 1 || items[0].ID == "" {
		t.Fatalf("catalog items = %#v", items)
	}
	id := items[0].ID
	writeSolidPNG(t, logoPath, color.NRGBA{B: 255, A: 255})

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/scan", nil)
	s.handler.ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || rec.Header().Get("content-type") != "application/x-ndjson; charset=utf-8" || !strings.Contains(body, `"type":"start"`) || !strings.Contains(body, `"type":"progress"`) || !strings.Contains(body, `"phase":"metadata"`) || !strings.Contains(body, `"phase":"persisting"`) || !strings.Contains(body, `"type":"done"`) {
		t.Fatalf("scan = %d %s", rec.Code, body)
	}

	rescannedItems := catalogItemsForTest(t, s)
	if len(rescannedItems) != 1 || rescannedItems[0].ID != id {
		t.Fatalf("rescanned catalog items = %#v", rescannedItems)
	}
	if rescannedItems[0].ThumbnailURL == items[0].ThumbnailURL || !strings.Contains(rescannedItems[0].ThumbnailURL, "?v=") {
		t.Fatalf("thumbnail url should change after rescan: before=%q after=%q", items[0].ThumbnailURL, rescannedItems[0].ThumbnailURL)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/assets/"+id, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Fatalf("asset = %d len=%d", rec.Code, rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/thumbs/"+id, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("content-type") != "image/png" || rec.Body.Len() == 0 {
		t.Fatalf("thumb = %d %s len=%d body=%s", rec.Code, rec.Header().Get("content-type"), rec.Body.Len(), rec.Body.String())
	}

	payload, _ := json.Marshal(map[string]string{"assetId": id})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/optimization/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"canApply":false`) {
		t.Fatalf("optimization preview = %d %s", rec.Code, rec.Body.String())
	}
}

func TestAnimatedWebPThumbFallsBackToSource(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	webpBytes, err := base64.StdEncoding.DecodeString("UklGRsoAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAGQAAAJWUDggMgAAADABAJ0BKgIAAgABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkwAAAAAAAAAAAABAAABAABkAAAAVlA4IDQAAAA0AQCdASoCAAIAAAAmJaAAA3AA/ukiH//3nz//ufP/+58/6M///yn7//I4//8jj/5QIAAA")
	if err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(root, "src", "loading.webp")
	mustWriteBytes(t, assetPath, webpBytes)
	mustWrite(t, filepath.Join(root, "src", "App.tsx"), `import loading from "./loading.webp"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{root}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	id := catalogAssetID(t, s)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/thumbs/"+id, nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("content-type") != "image/webp" || rec.Body.Len() != len(webpBytes) {
		t.Fatalf("animated webp thumb fallback = %d %s len=%d", rec.Code, rec.Header().Get("content-type"), rec.Body.Len())
	}
}

func TestServerLifecycleAndErrorStatusHelpers(t *testing.T) {
	s, err := New(Options{Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.SetOnReady(cancel)
	if err := s.StartWithContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("StartWithContext err = %v", err)
	}

	if got := directoryAccessError(os.ErrNotExist, "/missing"); got.Code != "directory_not_found" {
		t.Fatalf("directoryAccessError not exist = %#v", got)
	}
	if got := directoryAccessError(os.ErrPermission, "/private"); got.Code != "directory_permission_denied" {
		t.Fatalf("directoryAccessError permission = %#v", got)
	}
	if got := directoryAccessError(errors.New("boom"), "/bad"); got.Code != "directory_unreadable" {
		t.Fatalf("directoryAccessError generic = %#v", got)
	}
	if projectErrorStatus(apierr.New("project_not_found", "missing")) != http.StatusNotFound || projectErrorStatus(errors.New("bad")) != http.StatusBadRequest {
		t.Fatal("projectErrorStatus returned unexpected status")
	}
	if settingsErrorStatus(apierr.New("settings_quality_invalid", "bad")) != http.StatusBadRequest || settingsErrorStatus(errors.New("bad")) != http.StatusInternalServerError {
		t.Fatal("settingsErrorStatus returned unexpected status")
	}
}

func TestServerHelpersBasePathAndUIHandlers(t *testing.T) {
	if got := normalizeBasePath(" /studio/ "); got != "/studio" {
		t.Fatalf("normalizeBasePath() = %q", got)
	}
	if got := normalizeBasePath("/"); got != "" {
		t.Fatalf("normalizeBasePath root = %q", got)
	}

	s, err := New(Options{BasePath: "/studio", Store: nil})
	if err != nil {
		t.Fatal(err)
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.URL.Path))
	})
	handler := s.wrapBasePath(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/studio/api/health", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "/api/health" {
		t.Fatalf("wrapped path = %d %q", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/studio", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTemporaryRedirect || rec.Header().Get("location") != "/studio/" {
		t.Fatalf("base redirect = %d location=%q", rec.Code, rec.Header().Get("location"))
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/other", nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("base miss = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	uiPlaceholderHandler(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Aisets dev server") {
		t.Fatalf("placeholder = %d %s", rec.Code, rec.Body.String())
	}

	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), `<!doctype html><head></head><body>app</body>`)
	mustWrite(t, filepath.Join(dir, "assets", "app.js"), `console.log("ok")`)
	spa := spaHandlerFromDisk(dir, "/studio")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `window.__BASE_PATH__="/studio"`) {
		t.Fatalf("spa index = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("spa asset = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/missing-route", nil)
	spa.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<body>app</body>") {
		t.Fatalf("spa fallback = %d %s", rec.Code, rec.Body.String())
	}
}

func catalogAssetID(t *testing.T, s *Server) string {
	t.Helper()
	items := catalogItemsForTest(t, s)
	if len(items) != 1 || items[0].ID == "" {
		t.Fatalf("catalog body = %#v", items)
	}
	return items[0].ID
}

type catalogItemForTest struct {
	ID              string `json:"id"`
	RepoPath        string `json:"repoPath"`
	ContentHash     string `json:"contentHash"`
	HashAlgorithm   string `json:"hashAlgorithm"`
	ThumbnailURL    string `json:"thumbnailUrl"`
	Recommendations []any  `json:"optimizationRecommendations"`
}

func catalogItemsForTest(t *testing.T, s *Server) []catalogItemForTest {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog/items", nil)
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog items = %d %s", rec.Code, rec.Body.String())
	}
	var page struct {
		Items []catalogItemForTest `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page.Items
}

func newMultipartPrecheckRequest(t *testing.T, filename, path string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/pre-check", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	return req
}

func mustWriteBytes(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func writePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x * 20), G: uint8(y * 20), B: 100, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeSolidPNG(t *testing.T, path string, c color.NRGBA) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, c)
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

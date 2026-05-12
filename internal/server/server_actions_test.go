package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/optimize"
	"aisets/internal/scanner"
)

func TestActionPreviewApplyOptimizationBulkAndPreCheckRoutes(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "logo.png"))
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import logo from "./logo.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	items := catalogItemsForTest(t, s)
	if len(items) != 1 || len(items[0].Recommendations) == 0 {
		t.Fatalf("catalog items should include optimization recommendations = %#v", items)
	}
	assetID := items[0].ID

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/optimization/estimate", bytes.NewReader([]byte(`{"assetIds":[]}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"itemCount":1`) {
		t.Fatalf("optimization estimate = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/optimization/generate-script", bytes.NewReader([]byte(`{"assetIds":[]}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"format":"bash"`) || !strings.Contains(rec.Body.String(), "aisets-imgtools") {
		t.Fatalf("generate script = %d %s", rec.Code, rec.Body.String())
	}

	payload, _ := json.Marshal(map[string]string{"assetId": assetID, "targetPath": "src/renamed.png"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("rename preview = %d %s", rec.Code, rec.Body.String())
	}
	var previewResp struct {
		Token   string `json:"token"`
		Preview struct {
			CanApply bool `json:"canApply"`
		} `json:"preview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &previewResp); err != nil {
		t.Fatal(err)
	}
	if previewResp.Token == "" || !previewResp.Preview.CanApply {
		t.Fatalf("rename preview body = %#v", previewResp)
	}

	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"movedFiles":1`) {
		t.Fatalf("rename apply = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(project, "src", "renamed.png")); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(filepath.Join(project, "src", "App.tsx"))
	if !strings.Contains(string(content), "./renamed.png") {
		t.Fatalf("renamed content = %s", content)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/rename/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"preview_token_invalid"`) {
		t.Fatalf("reused apply token = %d %s", rec.Code, rec.Body.String())
	}

	s.clearCatalog()
	assetID = catalogAssetID(t, s)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/delete-unused/preview", bytes.NewReader([]byte(`{"assetId":"`+assetID+`"}`)))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"type":"delete-unused"`) {
		t.Fatalf("delete preview = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = newMultipartPrecheckRequest(t, "Logo Bad.png", filepath.Join(project, "src", "renamed.png"))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"verdict":"duplicate"`) || !strings.Contains(rec.Body.String(), `"exactMatches"`) {
		t.Fatalf("pre-check = %d %s", rec.Code, rec.Body.String())
	}
}

func TestMergePreviewRouteForDuplicateAssets(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	aPath := filepath.Join(project, "src", "a.png")
	bPath := filepath.Join(project, "src", "b.png")
	writePNG(t, aPath)
	fileBytes, err := os.ReadFile(aPath)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, bPath, fileBytes)
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import icon from "./b.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	items := catalogItemsForTest(t, s)
	var duplicateID string
	for _, item := range items {
		if item.RepoPath == "src/b.png" {
			duplicateID = item.ID
		}
	}
	if duplicateID == "" {
		t.Fatalf("catalog items = %#v", items)
	}

	payload, _ := json.Marshal(map[string]string{"assetId": duplicateID, "preferredPath": "src/a.png"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/merge-duplicates/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"type":"merge"`) || !strings.Contains(rec.Body.String(), `"deletes":["src/b.png"]`) {
		t.Fatalf("merge preview = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBatchDelete(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "a.png"))
	writePNG(t, filepath.Join(project, "src", "b.png"))
	writePNG(t, filepath.Join(project, "src", "keep.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Fetch catalog items to get asset IDs.
	items := catalogItemsForTest(t, s)
	if len(items) != 3 {
		t.Fatalf("expected 3 catalog items, got %d: %#v", len(items), items)
	}
	idsByPath := map[string]string{}
	for _, item := range items {
		idsByPath[item.RepoPath] = item.ID
	}
	deleteIDs := []string{idsByPath["src/a.png"], idsByPath["src/b.png"]}

	// Empty body returns empty succeeded list.
	payload, _ := json.Marshal(map[string][]string{"assetIds": {}})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/delete", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"succeeded":[]`) {
		t.Fatalf("empty batch delete = %d %s", rec.Code, rec.Body.String())
	}

	// Delete a.png and b.png.
	payload, _ = json.Marshal(map[string][]string{"assetIds": deleteIDs})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/delete", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch delete = %d %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Succeeded []string `json:"succeeded"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 2 {
		t.Fatalf("expected 2 succeeded, got %d: %s", len(result.Succeeded), rec.Body.String())
	}

	// Verify files on disk.
	if _, err := os.Stat(filepath.Join(project, "src", "a.png")); !os.IsNotExist(err) {
		t.Fatal("a.png should have been deleted")
	}
	if _, err := os.Stat(filepath.Join(project, "src", "b.png")); !os.IsNotExist(err) {
		t.Fatal("b.png should have been deleted")
	}
	if _, err := os.Stat(filepath.Join(project, "src", "keep.png")); err != nil {
		t.Fatal("keep.png should still exist")
	}
}

func TestBatchMovePreviewAndApply(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "src", "icon.png"))
	mustWrite(t, filepath.Join(project, "src", "App.tsx"), `import icon from "./icon.png"`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	fullProfile := scanner.ScanProfileFull
	if _, err := store.UpdateSettings(config.SettingsUpdate{ScanProfile: &fullProfile}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Fetch catalog item ID.
	items := catalogItemsForTest(t, s)
	if len(items) != 1 {
		t.Fatalf("expected 1 catalog item, got %d", len(items))
	}
	assetID := items[0].ID

	// POST batch move preview.
	payload, _ := json.Marshal(map[string]any{"assetIds": []string{assetID}, "targetDir": "assets"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/preview", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch move preview = %d %s", rec.Code, rec.Body.String())
	}
	var previewResp struct {
		Token   string `json:"token"`
		Preview struct {
			CanApply bool `json:"canApply"`
		} `json:"preview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &previewResp); err != nil {
		t.Fatal(err)
	}
	if previewResp.Token == "" || !previewResp.Preview.CanApply {
		t.Fatalf("batch move preview body = %#v", previewResp)
	}

	// POST batch move apply.
	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch move apply = %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"movedFiles":1`) {
		t.Fatalf("batch move apply result = %s", rec.Body.String())
	}

	// Verify file moved on disk.
	if _, err := os.Stat(filepath.Join(project, "assets", "icon.png")); err != nil {
		t.Fatalf("icon.png should have been moved to assets/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(project, "src", "icon.png")); !os.IsNotExist(err) {
		t.Fatal("src/icon.png should no longer exist")
	}

	// Verify reference updated.
	content, _ := os.ReadFile(filepath.Join(project, "src", "App.tsx"))
	if !strings.Contains(string(content), "../assets/icon.png") {
		t.Fatalf("reference not updated, content = %s", content)
	}

	// Reusing the same token should fail.
	payload, _ = json.Marshal(map[string]string{"token": previewResp.Token})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/actions/batch/move/apply", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"preview_token_invalid"`) {
		t.Fatalf("reused batch token = %d %s", rec.Code, rec.Body.String())
	}
}

func TestBatchExport(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	project := filepath.Join(root, "project")
	writePNG(t, filepath.Join(project, "img", "a.png"))
	writePNG(t, filepath.Join(project, "img", "b.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	// Trigger a scan so catalog is populated.
	scanRec := httptest.NewRecorder()
	s.handler.ServeHTTP(scanRec, httptest.NewRequest(http.MethodPost, "/api/scan", nil))

	items := catalogItemsForTest(t, s)
	ids := make([]string, 0)
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	payload, _ := json.Marshal(map[string]any{"assetIds": ids})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/actions/batch/export", bytes.NewReader(payload))
	s.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("expected application/zip, got %s", ct)
	}

	zipReader, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("invalid ZIP: %v", err)
	}
	if len(zipReader.File) != 2 {
		t.Fatalf("expected 2 files in ZIP, got %d", len(zipReader.File))
	}
}

func TestImageToolsUploadDownloadAndProjectPreview(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))
	project := filepath.Join(root, "project")
	svgPath := filepath.Join(project, "img", "icon.svg")
	mustWrite(t, svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>`)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.AddProjects([]string{project}); err != nil {
		t.Fatal(err)
	}
	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	uploadReq := newMultipartImageToolRequest(t, "upload.svg", svgPath, map[string]string{"outputFormat": "svg"})
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, uploadReq)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"token"`) {
		t.Fatalf("upload process = %d %s", rec.Code, rec.Body.String())
	}
	var uploadBody struct {
		Results []struct {
			Token string `json:"token"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &uploadBody); err != nil {
		t.Fatal(err)
	}
	if len(uploadBody.Results) != 1 || uploadBody.Results[0].Token == "" {
		t.Fatalf("upload body = %#v", uploadBody)
	}
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/download/"+uploadBody.Results[0].Token, nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<svg") {
		t.Fatalf("download = %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/download/"+uploadBody.Results[0].Token, nil))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"download_token_invalid"`) {
		t.Fatalf("reused download token = %d %s", rec.Code, rec.Body.String())
	}

	items := catalogItemsForTest(t, s)
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	payload, _ := json.Marshal(map[string]any{"assetIds": []string{items[0].ID}, "outputFormat": "svg"})
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/image-tools/assets/preview", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"targetPath":"img/icon-processed.svg"`) {
		t.Fatalf("asset preview = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/image-tools/assets/process", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"outputPath":"img/icon-processed.svg"`) || !strings.Contains(rec.Body.String(), `"token"`) {
		t.Fatalf("asset process = %d %s", rec.Code, rec.Body.String())
	}
	var projectBody struct {
		Results []struct {
			Token      string `json:"token"`
			OutputPath string `json:"outputPath"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &projectBody); err != nil {
		t.Fatal(err)
	}
	if len(projectBody.Results) != 1 || projectBody.Results[0].Token == "" || projectBody.Results[0].OutputPath != "img/icon-processed.svg" {
		t.Fatalf("project process body = %#v", projectBody)
	}
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/image-tools/download/"+projectBody.Results[0].Token, nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<svg") {
		t.Fatalf("project download = %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(project, "img", "icon-processed.svg")); err != nil {
		t.Fatalf("safe variant should remain in project: %v", err)
	}
}

func TestOptimizationEstimateCostPrioritizesLargeAnimationsLast(t *testing.T) {
	smallStatic := scanner.AssetItem{
		ID:    "png",
		Bytes: 1_000_000,
		Image: imageproc.Metadata{Width: 800, Height: 800, Pages: 1},
	}
	largeAnimation := scanner.AssetItem{
		ID:    "gif",
		Bytes: 24_000_000,
		Image: imageproc.Metadata{Width: 3024, Height: 1786, Animated: true, Pages: 684},
	}

	smallCost := optimizationEstimateCost(smallStatic, optimize.Operation{Operation: "convert-avif"})
	largeCost := optimizationEstimateCost(largeAnimation, optimize.Operation{Operation: "convert-webp"})

	if largeCost <= smallCost {
		t.Fatalf("large animated GIF cost %d should exceed static PNG cost %d", largeCost, smallCost)
	}
}

func newMultipartImageToolRequest(t *testing.T, filename, path string, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
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
	req := httptest.NewRequest(http.MethodPost, "/api/image-tools/uploads/process", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	return req
}

package server

import (
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
)

func TestCanvasUploadPersistsAcrossServerInstances(t *testing.T) {
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(root, "cache"))

	imagePath := filepath.Join(root, "banner.png")
	writePNG(t, imagePath)

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, newMultipartCanvasUploadRequest(t, "banner.png", imagePath))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"token"`) {
		t.Fatalf("canvas upload = %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Results []struct {
			Token string `json:"token"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 1 || body.Results[0].Token == "" {
		t.Fatalf("upload body = %#v", body)
	}
	token := body.Results[0].Token

	download, ok := s.peekImageToolDownload(token)
	if !ok {
		t.Fatal("uploaded image should be available in current server")
	}
	if !download.Persistent {
		t.Fatal("canvas upload should be stored as a persistent download")
	}
	if _, err := os.Stat(download.Path); err != nil {
		t.Fatalf("persistent upload missing: %v", err)
	}

	s2, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := s2.peekImageToolDownload(token)
	if !ok {
		t.Fatal("uploaded image should be restored after server restart")
	}
	if restored.Path != download.Path {
		t.Fatalf("restored path = %q, want %q", restored.Path, download.Path)
	}
}

func newMultipartCanvasUploadRequest(t *testing.T, filename, path string) *http.Request {
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
	req := httptest.NewRequest(http.MethodPost, "/api/ai/canvas/upload", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	return req
}

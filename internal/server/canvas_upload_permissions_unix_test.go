//go:build darwin || linux || freebsd || openbsd || netbsd

package server

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"syscall"
	"testing"
)

func TestProcessCanvasUploadNormalizesModeUnderRestrictiveUmask(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", "sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("upload")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	defer req.MultipartForm.RemoveAll()
	header := req.MultipartForm.File["files"][0]

	oldUmask := syscall.Umask(0o077)
	t.Cleanup(func() { syscall.Umask(oldUmask) })

	s := &Server{imageToolDownloads: map[string]imageToolDownload{}}
	result, err := s.processCanvasUpload(header)
	if err != nil {
		t.Fatal(err)
	}
	download, ok := s.peekImageToolDownload(result.Token)
	if !ok {
		t.Fatalf("missing download for token %s", result.Token)
	}
	info, err := os.Stat(download.Path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o644 {
		t.Fatalf("mode = %04o, want 0644", got)
	}
}

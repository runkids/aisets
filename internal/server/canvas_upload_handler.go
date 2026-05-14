package server

import (
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
)

type canvasUploadResult struct {
	Token            string `json:"token"`
	ThumbnailDataURL string `json:"thumbnailDataUrl"`
	FileName         string `json:"fileName"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
}

func (s *Server) handleCanvasUpload(w http.ResponseWriter, r *http.Request) {
	const maxUploadBytes = 20 << 20
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_upload_parse_failed"))
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeJSON(w, http.StatusBadRequest, apierr.New("canvas_upload_no_files", "no files provided"))
		return
	}
	if len(files) > 8 {
		files = files[:8]
	}

	var results []canvasUploadResult
	for _, header := range files {
		result, err := s.processCanvasUpload(header)
		if err != nil {
			continue
		}
		results = append(results, result)
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) processCanvasUpload(header *multipart.FileHeader) (canvasUploadResult, error) {
	src, err := header.Open()
	if err != nil {
		return canvasUploadResult{}, err
	}
	defer src.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".bin"
	}
	token := imageToolToken("canvas-upload:" + header.Filename)
	dir := persistentCanvasUploadDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return canvasUploadResult{}, err
	}
	uploadPath := filepath.Join(dir, token+ext)
	dst, err := os.OpenFile(uploadPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return canvasUploadResult{}, err
	}

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(uploadPath)
		return canvasUploadResult{}, err
	}
	dst.Close()

	meta, _ := imageproc.Probe(uploadPath)

	thumbnail := generatePreCheckThumbnail(uploadPath, "")

	s.storeImageToolDownload(token, imageToolDownload{
		Path:        uploadPath,
		Name:        header.Filename,
		ContentType: contentTypeForName(header.Filename),
		Persistent:  true,
		CreatedAt:   time.Now(),
	})

	return canvasUploadResult{
		Token:            token,
		ThumbnailDataURL: thumbnail,
		FileName:         header.Filename,
		Width:            meta.Width,
		Height:           meta.Height,
	}, nil
}

func persistentCanvasUploadDir() string {
	return filepath.Join(config.DataDir(), "canvas-uploads")
}

func restorePersistentCanvasUpload(token string) (imageToolDownload, bool) {
	if !isImageToolToken(token) {
		return imageToolDownload{}, false
	}
	matches, err := filepath.Glob(filepath.Join(persistentCanvasUploadDir(), token+".*"))
	if err != nil || len(matches) == 0 {
		return imageToolDownload{}, false
	}
	path := matches[0]
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return imageToolDownload{}, false
	}
	name := filepath.Base(path)
	return imageToolDownload{
		Path:        path,
		Name:        name,
		ContentType: contentTypeForName(name),
		Persistent:  true,
		CreatedAt:   info.ModTime(),
	}, true
}

func isImageToolToken(token string) bool {
	if len(token) != 40 {
		return false
	}
	for _, ch := range token {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return false
		}
	}
	return true
}

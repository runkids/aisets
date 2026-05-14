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
	tmp, err := os.CreateTemp("", "aisets-canvas-upload-*"+ext)
	if err != nil {
		return canvasUploadResult{}, err
	}
	tmpPath := tmp.Name()

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return canvasUploadResult{}, err
	}
	tmp.Close()

	meta, _ := imageproc.Probe(tmpPath)

	thumbnail := generatePreCheckThumbnail(tmpPath, "")

	token := imageToolToken("canvas-upload:" + header.Filename)
	s.storeImageToolDownload(token, imageToolDownload{
		Path:        tmpPath,
		Name:        header.Filename,
		ContentType: contentTypeForName(header.Filename),
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

package server

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"aisets/internal/imageproc"
)

type canvasCaptureCard struct {
	AssetID string  `json:"assetId"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Width   float64 `json:"width"`
	Height  float64 `json:"height"`
}

type canvasCaptureRequest struct {
	ScanID       int64               `json:"scanId"`
	Cards        []canvasCaptureCard `json:"cards"`
	Transparent  bool                `json:"transparent"`
	OutputWidth  int                 `json:"outputWidth"`
	OutputHeight int                 `json:"outputHeight"`
}

func (s *Server) handleCanvasCapture(w http.ResponseWriter, r *http.Request) {
	var req canvasCaptureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(req.Cards) == 0 {
		writeError(w, http.StatusBadRequest, http.ErrNoLocation)
		return
	}

	var compositeItems []imageproc.CompositeItem
	for _, card := range req.Cards {
		item, err := s.store.CatalogItem(req.ScanID, card.AssetID)
		if err != nil || item.LocalPath == "" {
			continue
		}
		fw := card.Width
		fh := card.Height
		if fw <= 0 {
			fw = 320
		}
		if fh <= 0 {
			fh = fw * 0.75
		}
		compositeItems = append(compositeItems, imageproc.CompositeItem{
			Path:      item.LocalPath,
			X:         card.X,
			Y:         card.Y,
			FitWidth:  fw,
			FitHeight: fh,
		})
	}

	if len(compositeItems) == 0 {
		writeError(w, http.StatusNotFound, http.ErrNoLocation)
		return
	}

	canvasW := req.OutputWidth
	canvasH := req.OutputHeight
	if canvasW <= 0 || canvasH <= 0 {
		minX := math.Inf(1)
		minY := math.Inf(1)
		maxX := math.Inf(-1)
		maxY := math.Inf(-1)
		for _, it := range compositeItems {
			minX = math.Min(minX, it.X)
			minY = math.Min(minY, it.Y)
			maxX = math.Max(maxX, it.X+it.FitWidth)
			maxY = math.Max(maxY, it.Y+it.FitHeight)
		}
		pad := 24.0
		canvasW = int(math.Ceil(maxX - minX + pad*2))
		canvasH = int(math.Ceil(maxY - minY + pad*2))
		for i := range compositeItems {
			compositeItems[i].X -= minX - pad
			compositeItems[i].Y -= minY - pad
		}
	}

	spec := imageproc.CompositeSpec{
		Width:       canvasW,
		Height:      canvasH,
		Transparent: req.Transparent,
		Items:       compositeItems,
	}

	f, err := os.CreateTemp("", "aisets-canvas-capture-*.png")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	tmpFile := f.Name()
	f.Close()
	defer os.Remove(tmpFile)

	if err := imageproc.CompositeCanvas(spec, tmpFile); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, tmpFile)
}

func (s *Server) handleCanvasCaptureSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("parse form: %w", err))
		return
	}
	projectID := r.FormValue("projectId")
	if projectID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("projectId is required"))
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("file is required: %w", err))
		return
	}
	defer file.Close()

	project, err := s.store.Project(projectID)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("project not found: %w", err))
		return
	}

	name := strings.TrimSpace(r.FormValue("fileName"))
	if name == "" {
		name = fmt.Sprintf("canvas-%d.png", os.Getpid())
	}
	if filepath.Ext(name) == "" {
		name += ".png"
	}
	name = filepath.Base(name)

	if _, statErr := os.Stat(project.Path); statErr != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("project directory not accessible: %s: %w", project.Path, statErr))
		return
	}

	targetAbs := filepath.Join(project.Path, name)
	for i := 1; i < 100; i++ {
		if _, err := os.Stat(targetAbs); os.IsNotExist(err) {
			break
		}
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		targetAbs = filepath.Join(project.Path, fmt.Sprintf("%s-%d%s", base, i, ext))
	}

	tmp, err := os.CreateTemp(filepath.Dir(targetAbs), ".aisets-capture-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	tmpPath := tmp.Name()
	if _, copyErr := io.Copy(tmp, file); copyErr != nil {
		tmp.Close()
		os.Remove(tmpPath)
		writeError(w, http.StatusInternalServerError, copyErr)
		return
	}
	tmp.Close()

	if err := os.Rename(tmpPath, targetAbs); err != nil {
		os.Remove(tmpPath)
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	s.markCatalogStale()

	relPath, _ := filepath.Rel(project.Path, targetAbs)
	writeJSON(w, http.StatusOK, map[string]string{
		"path":    relPath,
		"absPath": targetAbs,
	})
}

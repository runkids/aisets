package server

import (
	"encoding/json"
	"math"
	"net/http"
	"os"

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

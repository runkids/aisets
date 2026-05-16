package server

import (
	"context"
	"image"
	"image/color"
	"math"
	"os"
	"strconv"
	"strings"
)

type canvasRegionVisualCue struct {
	TargetDescription string
	Color             color.RGBA
	HasColor          bool
}

func (s *Server) refineCanvasImageRegionAction(ctx context.Context, act canvasAction, canvas canvasSnapshot) canvasAction {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return act
	}
	region, ok := canvasRegionFromValue(act.Params["region"])
	if !ok {
		return act
	}
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	if !ok || !cue.HasColor {
		return act
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	path, ok := s.canvasRegionActionImagePath(ctx, act, anchor)
	if !ok {
		return act
	}
	refined, ok := refineCanvasRegionByColor(path, region, cue)
	if !ok {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["region"] = map[string]any{
		"x":      refined.X,
		"y":      refined.Y,
		"width":  refined.Width,
		"height": refined.Height,
	}
	return next
}

func (s *Server) canvasRegionActionImagePath(ctx context.Context, act canvasAction, anchor *canvasCardSnapshot) (string, bool) {
	if anchor != nil {
		return s.canvasRegionAnchorImagePath(ctx, *anchor)
	}
	assetID, _ := act.Params["anchorCardId"].(string)
	return s.canvasCatalogAssetImagePath(ctx, assetID)
}

func (s *Server) canvasRegionAnchorImagePath(ctx context.Context, card canvasCardSnapshot) (string, bool) {
	switch card.Kind {
	case "asset":
		if card.Asset == nil || card.Asset.ID == "" {
			return "", false
		}
		return s.canvasCatalogAssetImagePath(ctx, card.Asset.ID)
	case "upload":
		if card.UploadToken == "" {
			return "", false
		}
		download, ok := s.peekImageToolDownload(card.UploadToken)
		if !ok || download.Path == "" {
			return "", false
		}
		return download.Path, true
	default:
		_ = ctx
		return "", false
	}
}

func (s *Server) canvasCatalogAssetImagePath(ctx context.Context, assetID string) (string, bool) {
	_ = ctx
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return "", false
	}
	scanID := s.latestScanID()
	if scanID == 0 {
		return "", false
	}
	item, err := s.store.CatalogItem(scanID, assetID)
	if err != nil || item.LocalPath == "" {
		return "", false
	}
	return item.LocalPath, true
}

func canvasRegionVisualCueFromParams(params map[string]any) (canvasRegionVisualCue, bool) {
	raw, ok := params["visualCue"]
	if !ok {
		return canvasRegionVisualCue{}, false
	}
	cueMap, ok := raw.(map[string]any)
	if !ok {
		return canvasRegionVisualCue{}, false
	}
	cue := canvasRegionVisualCue{}
	if text, ok := cueMap["targetDescription"].(string); ok {
		cue.TargetDescription = strings.TrimSpace(text)
	}
	if text, ok := cueMap["colorHex"].(string); ok {
		if parsed, ok := parseCanvasHexColor(text); ok {
			cue.Color = parsed
			cue.HasColor = true
		}
	}
	return cue, cue.TargetDescription != "" || cue.HasColor
}

func parseCanvasHexColor(value string) (color.RGBA, bool) {
	text := strings.TrimSpace(value)
	text = strings.TrimPrefix(text, "#")
	if len(text) != 6 {
		return color.RGBA{}, false
	}
	n, err := strconv.ParseUint(text, 16, 32)
	if err != nil {
		return color.RGBA{}, false
	}
	return color.RGBA{
		R: uint8((n >> 16) & 0xff),
		G: uint8((n >> 8) & 0xff),
		B: uint8(n & 0xff),
		A: 255,
	}, true
}

func refineCanvasRegionByColor(path string, region canvasRegion, cue canvasRegionVisualCue) (canvasRegion, bool) {
	if !cue.HasColor {
		return canvasRegion{}, false
	}
	f, err := os.Open(path)
	if err != nil {
		return canvasRegion{}, false
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		return canvasRegion{}, false
	}
	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	if w <= 0 || h <= 0 {
		return canvasRegion{}, false
	}

	region = clampCanvasRegion(region)
	search := canvasRegionSearchRect(region, w, h)
	if search.Empty() {
		return canvasRegion{}, false
	}

	if canvasVisualCueLooksLikeText(cue) {
		if refined, ok := inferCanvasTextRegionFromImage(img, bounds, region, cue); ok {
			return refined, true
		}
		fullSearch := image.Rect(0, 0, w, h)
		fullComponents := canvasColorComponents(img, bounds, fullSearch, cue.Color, minCanvasRegionColorMatchPixels(w, h))
		refined, ok := bestCanvasTextRegionFromColorComponents(fullComponents, region, w, h)
		if ok {
			return refined, true
		}
	}
	components := canvasColorComponents(img, bounds, search, cue.Color, minCanvasRegionColorMatchPixels(w, h))
	if len(components) == 0 {
		return canvasRegion{}, false
	}
	if canvasVisualCueLooksLikeText(cue) {
		refined, ok := canvasTextRegionFromColorComponents(components, region, w, h)
		if ok {
			return refined, true
		}
	}

	component, ok := bestCanvasColorComponent(components, region, cue, w, h)
	if !ok {
		return canvasRegion{}, false
	}
	refined := canvasRegionFromColorComponent(component, w, h)
	if refined.Width > 0.65 || refined.Height > 0.65 {
		return canvasRegion{}, false
	}
	return clampCanvasRegion(refined), true
}

type canvasTextRegionCandidate struct {
	Region         canvasRegion
	Color          color.RGBA
	ComponentCount int
	Pixels         int
	BoxArea        float64
	Score          float64
}

type canvasColorComponent struct {
	MinX   int
	MinY   int
	MaxX   int
	MaxY   int
	Pixels int
}

func (c canvasColorComponent) width() int {
	return c.MaxX - c.MinX + 1
}

func (c canvasColorComponent) height() int {
	return c.MaxY - c.MinY + 1
}

func (c canvasColorComponent) boxArea() int {
	return c.width() * c.height()
}

func canvasColorComponents(img image.Image, bounds image.Rectangle, search image.Rectangle, target color.RGBA, minPixels int) []canvasColorComponent {
	searchW := search.Dx()
	searchH := search.Dy()
	if searchW <= 0 || searchH <= 0 {
		return nil
	}
	visited := make([]bool, searchW*searchH)
	index := func(x, y int) int {
		return (y-search.Min.Y)*searchW + (x - search.Min.X)
	}

	var components []canvasColorComponent
	for y := search.Min.Y; y < search.Max.Y; y++ {
		for x := search.Min.X; x < search.Max.X; x++ {
			idx := index(x, y)
			if visited[idx] {
				continue
			}
			visited[idx] = true
			if !canvasPixelMatchesColor(img.At(bounds.Min.X+x, bounds.Min.Y+y), target) {
				continue
			}
			component := canvasColorComponent{MinX: x, MinY: y, MaxX: x, MaxY: y, Pixels: 0}
			queue := []image.Point{{X: x, Y: y}}
			for len(queue) > 0 {
				point := queue[len(queue)-1]
				queue = queue[:len(queue)-1]
				component.Pixels++
				if point.X < component.MinX {
					component.MinX = point.X
				}
				if point.Y < component.MinY {
					component.MinY = point.Y
				}
				if point.X > component.MaxX {
					component.MaxX = point.X
				}
				if point.Y > component.MaxY {
					component.MaxY = point.Y
				}
				for _, next := range []image.Point{
					{X: point.X - 1, Y: point.Y},
					{X: point.X + 1, Y: point.Y},
					{X: point.X, Y: point.Y - 1},
					{X: point.X, Y: point.Y + 1},
				} {
					if next.X < search.Min.X || next.X >= search.Max.X || next.Y < search.Min.Y || next.Y >= search.Max.Y {
						continue
					}
					nextIdx := index(next.X, next.Y)
					if visited[nextIdx] {
						continue
					}
					visited[nextIdx] = true
					if !canvasPixelMatchesColor(img.At(bounds.Min.X+next.X, bounds.Min.Y+next.Y), target) {
						continue
					}
					queue = append(queue, next)
				}
			}
			if component.Pixels >= minPixels {
				components = append(components, component)
			}
		}
	}
	return components
}

func bestCanvasColorComponent(components []canvasColorComponent, region canvasRegion, cue canvasRegionVisualCue, width, height int) (canvasColorComponent, bool) {
	regionCenterX := region.X + region.Width/2
	regionCenterY := region.Y + region.Height/2
	regionAreaPx := math.Max(1, region.Width*float64(width)*region.Height*float64(height))
	totalAreaPx := float64(width * height)
	maxBoxArea := math.Max(regionAreaPx*12, totalAreaPx*0.06)
	if canvasVisualCueLooksSmall(cue) {
		maxBoxArea = math.Min(maxBoxArea, totalAreaPx*0.04)
	}

	var best canvasColorComponent
	bestScore := math.Inf(1)
	for _, component := range components {
		boxArea := float64(component.boxArea())
		if boxArea > maxBoxArea {
			continue
		}
		centerX := (float64(component.MinX+component.MaxX) + 1) / 2 / float64(width)
		centerY := (float64(component.MinY+component.MaxY) + 1) / 2 / float64(height)
		dist := math.Hypot(centerX-regionCenterX, centerY-regionCenterY)
		areaPenalty := math.Abs(math.Log(math.Max(boxArea, 1) / regionAreaPx))
		score := dist + areaPenalty*0.12
		if score < bestScore {
			best = component
			bestScore = score
		}
	}
	return best, !math.IsInf(bestScore, 1)
}


package server

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

func cloneCanvasSnapshot(canvas canvasSnapshot) canvasSnapshot {
	next := canvas
	next.SelectedCardIDs = append([]string(nil), canvas.SelectedCardIDs...)
	next.Cards = append([]canvasCardSnapshot(nil), canvas.Cards...)
	return next
}

func canvasValueString(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func canvasValueFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	case string:
		n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return n, err == nil
	default:
		return 0, false
	}
}

func canvasResultMap(result any) map[string]any {
	if values, ok := result.(map[string]any); ok {
		return values
	}
	return nil
}

func refreshCanvasLayerIndices(canvas *canvasSnapshot) {
	for i := range canvas.Cards {
		canvas.Cards[i].LayerIndex = i
	}
}

func canvasProjectedImageHeight(card canvasCardSnapshot) float64 {
	width := card.Width
	if width <= 0 {
		width = 320
	}
	if card.Asset != nil && card.Asset.Width > 0 && card.Asset.Height > 0 {
		return width * float64(card.Asset.Height) / float64(card.Asset.Width)
	}
	if card.UploadWidth > 0 && card.UploadHeight > 0 {
		return width * float64(card.UploadHeight) / float64(card.UploadWidth)
	}
	if card.Height > 0 {
		return card.Height
	}
	return 240
}

type canvasProjectedCardBox struct {
	ID     string
	X      float64
	Y      float64
	Width  float64
	Height float64
}

func (box canvasProjectedCardBox) right() float64  { return box.X + box.Width }
func (box canvasProjectedCardBox) bottom() float64 { return box.Y + box.Height }
func (box canvasProjectedCardBox) cx() float64     { return box.X + box.Width/2 }
func (box canvasProjectedCardBox) cy() float64     { return box.Y + box.Height/2 }

func canvasProjectedCardBoxes(canvas canvasSnapshot, ids []string) []canvasProjectedCardBox {
	var boxes []canvasProjectedCardBox
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		card := canvasCardByID(canvas, id)
		if card == nil {
			continue
		}
		width, height := canvasCardImageDisplaySize(*card)
		boxes = append(boxes, canvasProjectedCardBox{
			ID:     card.ID,
			X:      card.X,
			Y:      card.Y,
			Width:  width,
			Height: height,
		})
	}
	return boxes
}

type canvasProjectedPosition struct {
	X float64
	Y float64
}

func canvasPositionsByCardID(value any) map[string]canvasProjectedPosition {
	out := map[string]canvasProjectedPosition{}
	add := func(item map[string]any) {
		id := canvasValueString(item["cardId"])
		x, okX := canvasValueFloat(item["x"])
		y, okY := canvasValueFloat(item["y"])
		if id != "" && okX && okY {
			out[id] = canvasProjectedPosition{X: x, Y: y}
		}
	}
	switch positions := value.(type) {
	case []any:
		for _, raw := range positions {
			if item, ok := raw.(map[string]any); ok {
				add(item)
			}
		}
	case []map[string]any:
		for _, item := range positions {
			add(item)
		}
	}
	return out
}

type canvasProjectedDuplicateCopy struct {
	SourceCardID string
	CardID       string
}

func canvasDuplicateCopiesFromResult(values map[string]any) []canvasProjectedDuplicateCopy {
	var copies []canvasProjectedDuplicateCopy
	add := func(item map[string]any) {
		sourceID := canvasValueString(item["sourceCardId"])
		cardID := canvasValueString(item["cardId"])
		if sourceID != "" && cardID != "" {
			copies = append(copies, canvasProjectedDuplicateCopy{SourceCardID: sourceID, CardID: cardID})
		}
	}
	switch rawCopies := values["copies"].(type) {
	case []any:
		for _, raw := range rawCopies {
			if item, ok := raw.(map[string]any); ok {
				add(item)
			}
		}
	case []map[string]any:
		for _, item := range rawCopies {
			add(item)
		}
	default:
		if rawCopies != nil {
			if data, err := json.Marshal(rawCopies); err == nil {
				var decoded []map[string]any
				if err := json.Unmarshal(data, &decoded); err == nil {
					for _, item := range decoded {
						add(item)
					}
				}
			}
		}
	}
	if len(copies) > 0 {
		return copies
	}
	sourceIDs := canvasParamStringSlice(values["cardIds"])
	newIDs := canvasParamStringSlice(values["newCardIds"])
	if len(sourceIDs) == 0 {
		return nil
	}
	for i, cardID := range newIDs {
		copies = append(copies, canvasProjectedDuplicateCopy{SourceCardID: sourceIDs[i%len(sourceIDs)], CardID: cardID})
	}
	return copies
}


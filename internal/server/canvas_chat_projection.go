package server

import (
	"encoding/json"
	"fmt"
	"sort"
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

func applyCanvasActionResultToSnapshot(canvas canvasSnapshot, tool string, result any) canvasSnapshot {
	values := canvasResultMap(result)
	if len(values) == 0 {
		return canvas
	}
	next := cloneCanvasSnapshot(canvas)
	switch tool {
	case "select_cards":
		next.SelectedCardIDs = canvasParamStringSlice(values["cardIds"])
	case "remove_cards":
		remove := map[string]bool{}
		for _, id := range canvasParamStringSlice(values["cardIds"]) {
			remove[id] = true
		}
		if len(remove) == 0 {
			return next
		}
		filtered := next.Cards[:0]
		for _, card := range next.Cards {
			if !remove[card.ID] {
				filtered = append(filtered, card)
			}
		}
		next.Cards = filtered
		selected := next.SelectedCardIDs[:0]
		for _, id := range next.SelectedCardIDs {
			if !remove[id] {
				selected = append(selected, id)
			}
		}
		next.SelectedCardIDs = selected
	case "duplicate_cards":
		positions := canvasPositionsByCardID(values["positions"])
		var createdIDs []string
		for _, copy := range canvasDuplicateCopiesFromResult(values) {
			source := canvasCardByID(next, copy.SourceCardID)
			if source == nil {
				continue
			}
			card := *source
			card.ID = copy.CardID
			index := len(createdIDs)
			card.X = source.X + float64(index+1)*36
			card.Y = source.Y + float64(index+1)*36
			if pos, ok := positions[card.ID]; ok {
				card.X = pos.X
				card.Y = pos.Y
			}
			next.Cards = append(next.Cards, card)
			createdIDs = append(createdIDs, card.ID)
		}
		if len(createdIDs) > 0 {
			next.SelectedCardIDs = createdIDs
		}
	case "move_card":
		id := canvasValueString(values["cardId"])
		x, okX := canvasValueFloat(values["x"])
		y, okY := canvasValueFloat(values["y"])
		if id != "" && okX && okY {
			for i := range next.Cards {
				if next.Cards[i].ID == id {
					next.Cards[i].X = x
					next.Cards[i].Y = y
					break
				}
			}
		}
	case "arrange_cards":
		for id, pos := range canvasPositionsByCardID(values["positions"]) {
			for i := range next.Cards {
				if next.Cards[i].ID == id {
					next.Cards[i].X = pos.X
					next.Cards[i].Y = pos.Y
					break
				}
			}
		}
	case "align_cards":
		axis := canvasValueString(values["axis"])
		boxes := canvasProjectedCardBoxes(next, canvasParamStringSlice(values["cardIds"]))
		if len(boxes) >= 2 {
			target := boxes[0].X
			switch axis {
			case "right":
				target = boxes[0].right()
				for _, box := range boxes[1:] {
					target = max(target, box.right())
				}
			case "center":
				var sum float64
				for _, box := range boxes {
					sum += box.cx()
				}
				target = sum / float64(len(boxes))
			case "bottom":
				target = boxes[0].bottom()
				for _, box := range boxes[1:] {
					target = max(target, box.bottom())
				}
			case "middle":
				var sum float64
				for _, box := range boxes {
					sum += box.cy()
				}
				target = sum / float64(len(boxes))
			case "top":
				target = boxes[0].Y
				for _, box := range boxes[1:] {
					target = min(target, box.Y)
				}
			default:
				for _, box := range boxes[1:] {
					target = min(target, box.X)
				}
			}
			for _, box := range boxes {
				for i := range next.Cards {
					if next.Cards[i].ID != box.ID {
						continue
					}
					switch axis {
					case "right":
						next.Cards[i].X = target - box.Width
					case "center":
						next.Cards[i].X = target - box.Width/2
					case "bottom":
						next.Cards[i].Y = target - box.Height
					case "middle":
						next.Cards[i].Y = target - box.Height/2
					case "top":
						next.Cards[i].Y = target
					default:
						next.Cards[i].X = target
					}
				}
			}
		}
	case "distribute_cards":
		direction := canvasValueString(values["direction"])
		boxes := canvasProjectedCardBoxes(next, canvasParamStringSlice(values["cardIds"]))
		if len(boxes) >= 3 {
			sort.Slice(boxes, func(i, j int) bool {
				if direction == "vertical" {
					return boxes[i].Y < boxes[j].Y
				}
				return boxes[i].X < boxes[j].X
			})
			gap, hasGap := canvasValueFloat(values["gap"])
			if gap < 0 {
				gap = 0
			}
			if direction == "vertical" {
				top := boxes[0].Y
				bottom := boxes[0].bottom()
				totalHeight := 0.0
				for _, box := range boxes {
					top = min(top, box.Y)
					bottom = max(bottom, box.bottom())
					totalHeight += box.Height
				}
				if !hasGap {
					gap = max(0, (bottom-top-totalHeight)/float64(len(boxes)-1))
				}
				y := top
				for _, box := range boxes {
					for i := range next.Cards {
						if next.Cards[i].ID == box.ID {
							next.Cards[i].Y = y
							break
						}
					}
					y += box.Height + gap
				}
			} else {
				left := boxes[0].X
				right := boxes[0].right()
				totalWidth := 0.0
				for _, box := range boxes {
					left = min(left, box.X)
					right = max(right, box.right())
					totalWidth += box.Width
				}
				if !hasGap {
					gap = max(0, (right-left-totalWidth)/float64(len(boxes)-1))
				}
				x := left
				for _, box := range boxes {
					for i := range next.Cards {
						if next.Cards[i].ID == box.ID {
							next.Cards[i].X = x
							break
						}
					}
					x += box.Width + gap
				}
			}
		}
	case "resize_card":
		id := canvasValueString(values["cardId"])
		width, ok := canvasValueFloat(values["width"])
		if id != "" && ok && width > 0 {
			for i := range next.Cards {
				if next.Cards[i].ID == id {
					next.Cards[i].Width = width
					next.Cards[i].Height = canvasProjectedImageHeight(next.Cards[i])
					break
				}
			}
		}
	case "bring_cards_to_front":
		ids := canvasParamStringSlice(values["cardIds"])
		if len(ids) > 0 {
			afterCardID := canvasValueString(values["afterCardId"])
			next.Cards = canvasReorderCardsToFront(next.Cards, ids, afterCardID)
		}
	}
	refreshCanvasLayerIndices(&next)
	return next
}

func canvasReorderCardsToFront(cards []canvasCardSnapshot, ids []string, afterCardID string) []canvasCardSnapshot {
	move := map[string]bool{}
	for _, id := range ids {
		move[id] = true
	}
	if len(move) == 0 {
		return cards
	}
	moving := make([]canvasCardSnapshot, 0, len(ids))
	rest := make([]canvasCardSnapshot, 0, len(cards))
	for _, card := range cards {
		if move[card.ID] {
			moving = append(moving, card)
		} else {
			rest = append(rest, card)
		}
	}
	if len(moving) == 0 {
		return cards
	}
	if strings.TrimSpace(afterCardID) == "" {
		return append(rest, moving...)
	}
	for i, card := range rest {
		if card.ID == afterCardID {
			out := make([]canvasCardSnapshot, 0, len(cards))
			out = append(out, rest[:i+1]...)
			out = append(out, moving...)
			out = append(out, rest[i+1:]...)
			return out
		}
	}
	return append(rest, moving...)
}

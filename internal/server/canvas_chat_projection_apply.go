package server

import (
	"sort"
	"strings"
)

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
	case "group_cards":
		ids := canvasParamStringSlice(values["cardIds"])
		boxes := canvasProjectedCardBoxes(next, ids)
		if len(boxes) >= 2 {
			minX, minY := boxes[0].X, boxes[0].Y
			maxRight, maxBottom := boxes[0].right(), boxes[0].bottom()
			for _, box := range boxes[1:] {
				minX = min(minX, box.X)
				minY = min(minY, box.Y)
				maxRight = max(maxRight, box.right())
				maxBottom = max(maxBottom, box.bottom())
			}
			remove := map[string]bool{}
			for _, id := range ids {
				remove[id] = true
			}
			filtered := next.Cards[:0]
			for _, card := range next.Cards {
				if !remove[card.ID] {
					filtered = append(filtered, card)
				}
			}
			groupID := canvasValueString(values["groupId"])
			if groupID == "" {
				groupID = "group-projected"
			}
			filtered = append(filtered, canvasCardSnapshot{
				ID:      groupID,
				Kind:    "group",
				Name:    canvasValueString(values["name"]),
				CardIDs: ids,
				X:       minX,
				Y:       minY,
				Width:   max(1, maxRight-minX),
				Height:  max(1, maxBottom-minY),
			})
			next.Cards = filtered
			next.SelectedCardIDs = []string{groupID}
		}
	case "ungroup_card":
		id := canvasValueString(values["cardId"])
		if id != "" {
			filtered := next.Cards[:0]
			for _, card := range next.Cards {
				if card.ID != id {
					filtered = append(filtered, card)
				}
			}
			next.Cards = filtered
			next.SelectedCardIDs = nil
		}
	case "rename_group":
		id := canvasValueString(values["cardId"])
		name := canvasValueString(values["name"])
		if id != "" && name != "" {
			for i := range next.Cards {
				if next.Cards[i].ID == id && next.Cards[i].Kind == "group" {
					next.Cards[i].Name = name
					break
				}
			}
			next.SelectedCardIDs = []string{id}
		}
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

package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func selectedCanvasAssetIDs(canvas canvasSnapshot) []string {
	selected := make(map[string]bool, len(canvas.SelectedCardIDs))
	for _, id := range canvas.SelectedCardIDs {
		selected[id] = true
	}
	var ids []string
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !selected[card.ID] || card.Asset == nil || card.Asset.ID == "" {
			continue
		}
		if seen[card.Asset.ID] {
			continue
		}
		seen[card.Asset.ID] = true
		ids = append(ids, card.Asset.ID)
	}
	return ids
}

func selectedCanvasImageCardIDs(canvas canvasSnapshot) []string {
	byID := map[string]canvasCardSnapshot{}
	for _, card := range canvas.Cards {
		byID[card.ID] = card
	}
	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		if id = strings.TrimSpace(id); id == "" || seen[id] {
			return
		}
		card, ok := byID[id]
		if !ok {
			return
		}
		if card.Kind != "asset" && card.Kind != "upload" && card.Kind != "variant" {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, id := range canvas.SelectedCardIDs {
		card, ok := byID[id]
		if !ok {
			continue
		}
		if card.Kind == "comment" {
			add(card.AnchorID)
			continue
		}
		add(card.ID)
	}
	return ids
}

func selectedCanvasOCRCardIDs(canvas canvasSnapshot) []string {
	selected := make(map[string]bool, len(canvas.SelectedCardIDs))
	for _, id := range canvas.SelectedCardIDs {
		selected[id] = true
	}
	var ids []string
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !selected[card.ID] || seen[card.ID] {
			continue
		}
		if card.Kind != "asset" && card.Kind != "upload" {
			continue
		}
		seen[card.ID] = true
		ids = append(ids, card.ID)
	}
	return ids
}

func canvasParamStringSlice(value any) []string {
	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	switch v := value.(type) {
	case []string:
		for _, id := range v {
			add(id)
		}
	case []any:
		for _, raw := range v {
			if id, ok := raw.(string); ok {
				add(id)
			}
		}
	case string:
		add(v)
	}
	return ids
}

func setCanvasActionCardIDs(act *canvasAction, ids []string) {
	if act.Params == nil {
		act.Params = map[string]any{}
	} else {
		next := make(map[string]any, len(act.Params)+1)
		for k, v := range act.Params {
			next[k] = v
		}
		act.Params = next
	}
	act.Params["cardIds"] = ids
	if len(ids) > 0 {
		act.Params["cardId"] = ids[0]
	}
}

func filterCanvasRemoveActionProtectedCards(act canvasAction, protected map[string]bool) canvasAction {
	if act.Tool != "remove_cards" || len(protected) == 0 {
		return act
	}
	var filtered []string
	for _, id := range canvasActionCardIDs(act) {
		if protected[id] {
			continue
		}
		filtered = append(filtered, id)
	}
	setCanvasActionCardIDs(&act, filtered)
	return act
}

func canvasCleanupCandidateCardIDs(canvas canvasSnapshot, protected map[string]bool) []string {
	var ids []string
	for _, card := range canvas.Cards {
		if protected[card.ID] {
			continue
		}
		if card.Kind != "asset" && card.Kind != "upload" && card.Kind != "variant" {
			continue
		}
		ids = append(ids, card.ID)
	}
	return ids
}

func normalizeCanvasImageRegionAction(act canvasAction, canvas canvasSnapshot) canvasAction {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return act
	}
	rawRegion, ok := act.Params["region"]
	if !ok {
		return act
	}
	region, ok := canvasRegionFromValue(rawRegion)
	if !ok {
		return act
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor != nil && canvasRegionLooksPixelBased(region) {
		width, height := canvasCardImageDisplaySize(*anchor)
		if width > 0 && height > 0 {
			region.X /= width
			region.Width /= width
			region.Y /= height
			region.Height /= height
		}
	}
	region = clampCanvasRegion(region)
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["region"] = map[string]any{
		"x":      region.X,
		"y":      region.Y,
		"width":  region.Width,
		"height": region.Height,
	}
	return next
}

func canvasToolHasImageRegion(tool string) bool {
	switch tool {
	case "create_comment", "update_comment":
		return true
	default:
		return false
	}
}

func canvasImageRegionAnchorCard(act canvasAction, canvas canvasSnapshot) *canvasCardSnapshot {
	if act.Params == nil {
		return nil
	}
	switch act.Tool {
	case "create_comment":
		anchorID, _ := act.Params["anchorCardId"].(string)
		return canvasCardByID(canvas, anchorID)
	case "update_comment":
		commentID, _ := act.Params["commentCardId"].(string)
		comment := canvasCardByID(canvas, commentID)
		if comment == nil || comment.AnchorID == "" {
			return nil
		}
		return canvasCardByID(canvas, comment.AnchorID)
	default:
		return nil
	}
}

func canvasCardByID(canvas canvasSnapshot, id string) *canvasCardSnapshot {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	for i := range canvas.Cards {
		if canvas.Cards[i].ID == id {
			return &canvas.Cards[i]
		}
	}
	return nil
}

func canvasRegionFromValue(value any) (canvasRegion, bool) {
	raw, ok := value.(map[string]any)
	if !ok {
		return canvasRegion{}, false
	}
	number := func(key string) (float64, bool) {
		switch v := raw[key].(type) {
		case float64:
			return v, true
		case int:
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
	x, okX := number("x")
	y, okY := number("y")
	width, okWidth := number("width")
	height, okHeight := number("height")
	if !okX || !okY || !okWidth || !okHeight {
		return canvasRegion{}, false
	}
	return canvasRegion{X: x, Y: y, Width: width, Height: height}, true
}

func canvasRegionLooksPixelBased(region canvasRegion) bool {
	return region.X > 1 || region.Y > 1 || region.Width > 1 || region.Height > 1
}

func clampCanvasRegion(region canvasRegion) canvasRegion {
	region.Width = min(max(region.Width, 0.02), 1)
	region.Height = min(max(region.Height, 0.02), 1)
	region.X = min(max(region.X, 0), 1-region.Width)
	region.Y = min(max(region.Y, 0), 1-region.Height)
	return region
}

func canvasCardImageDisplaySize(card canvasCardSnapshot) (float64, float64) {
	width := card.Width
	if width <= 0 {
		width = 320
	}
	if card.Height > 0 {
		return width, card.Height
	}
	if card.Asset != nil && card.Asset.Width > 0 && card.Asset.Height > 0 {
		return width, width * float64(card.Asset.Height) / float64(card.Asset.Width)
	}
	if card.UploadWidth > 0 && card.UploadHeight > 0 {
		return width, width * float64(card.UploadHeight) / float64(card.UploadWidth)
	}
	return width, 240
}

func canvasActionCardIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	ids := canvasParamStringSlice(act.Params["cardIds"])
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if id, ok := act.Params["cardId"].(string); ok {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func canvasActionPositionCardIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	rawPositions, ok := act.Params["positions"]
	if !ok {
		return nil
	}
	addFromMap := func(out []string, item map[string]any) []string {
		id := strings.TrimSpace(fmt.Sprint(item["cardId"]))
		if id != "" {
			out = append(out, id)
		}
		return out
	}
	var ids []string
	switch positions := rawPositions.(type) {
	case []any:
		for _, raw := range positions {
			if item, ok := raw.(map[string]any); ok {
				ids = addFromMap(ids, item)
			}
		}
	case []map[string]any:
		for _, item := range positions {
			ids = addFromMap(ids, item)
		}
	}
	return ids
}

func canvasActionAssetIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	ids := canvasParamStringSlice(act.Params["assetIds"])
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if id, ok := act.Params["assetId"].(string); ok {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func setCanvasActionAssetIDs(act *canvasAction, ids []string) {
	if act.Params == nil {
		act.Params = map[string]any{}
	} else {
		next := make(map[string]any, len(act.Params)+1)
		for k, v := range act.Params {
			next[k] = v
		}
		act.Params = next
	}
	act.Params["assetIds"] = ids
	if len(ids) > 0 {
		act.Params["assetId"] = ids[0]
	}
}

func canvasImageTempFile(dataURI string) (string, func(), error) {
	if dataURI == "" {
		return "", func() {}, nil
	}
	_, encoded, ok := strings.Cut(dataURI, ";base64,")
	if !ok {
		return "", func() {}, fmt.Errorf("invalid canvas image data")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", func() {}, err
	}
	f, err := os.CreateTemp("", "aisets-ai-canvas-*.png")
	if err != nil {
		return "", func() {}, err
	}
	path := f.Name()
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return "", func() {}, err
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return "", func() {}, err
	}
	return path, func() { os.Remove(path) }, nil
}

func canvasUserLimitsToSingleAsset(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"only this", "only first", "first image", "single image",
	)
}

func expandCanvasMultiSelectedActions(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	selectedAssetIDs := selectedCanvasAssetIDs(canvas)
	selectedImageCardIDs := selectedCanvasImageCardIDs(canvas)
	selectedOCRCardIDs := selectedCanvasOCRCardIDs(canvas)
	limitToSingle := canvasUserLimitsToSingleAsset(latestUserMessage)

	toolCounts := map[string]int{}
	for _, act := range actions {
		if canvasToolCanUseSelectedAssetIDs(act.Tool) {
			toolCounts[act.Tool]++
		}
	}

	var expanded []canvasAction
	for _, act := range actions {
		if act.Tool == "extract_ocr_text" && len(canvasActionAssetIDs(act)) == 0 && len(canvasActionCardIDs(act)) == 0 && len(selectedOCRCardIDs) > 0 {
			clone := act
			cardIDs := selectedOCRCardIDs
			if limitToSingle {
				cardIDs = selectedOCRCardIDs[:1]
			}
			setCanvasActionCardIDs(&clone, cardIDs)
			expanded = append(expanded, clone)
			continue
		}
		if (act.Tool == "duplicate_cards" || act.Tool == "group_cards") && len(canvasActionCardIDs(act)) == 0 && len(selectedImageCardIDs) > 0 {
			clone := act
			cardIDs := selectedImageCardIDs
			if limitToSingle {
				cardIDs = selectedImageCardIDs[:1]
			}
			setCanvasActionCardIDs(&clone, cardIDs)
			expanded = append(expanded, clone)
			continue
		}
		targetAssetIDs := canvasActionAssetIDs(act)
		if canvasToolPreservesExplicitAssetTargets(act.Tool) && len(targetAssetIDs) > 0 {
			expanded = append(expanded, act)
			continue
		}
		if !canvasToolCanUseSelectedAssetIDs(act.Tool) || toolCounts[act.Tool] != 1 || len(targetAssetIDs) > 1 || len(selectedAssetIDs) == 0 {
			expanded = append(expanded, act)
			continue
		}
		if limitToSingle {
			if len(targetAssetIDs) == 0 {
				clone := act
				setCanvasActionAssetIDs(&clone, selectedAssetIDs[:1])
				expanded = append(expanded, clone)
				continue
			}
			expanded = append(expanded, act)
			continue
		}
		if len(selectedAssetIDs) <= 1 && len(targetAssetIDs) > 0 {
			expanded = append(expanded, act)
			continue
		}
		clone := act
		setCanvasActionAssetIDs(&clone, selectedAssetIDs)
		expanded = append(expanded, clone)
	}
	return expanded
}

func canvasToolPreservesExplicitAssetTargets(tool string) bool {
	switch tool {
	case "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image":
		return true
	default:
		return false
	}
}

func refineCanvasActionTargets(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	return actions
}

func cloneStringBoolMap(values map[string]bool) map[string]bool {
	next := make(map[string]bool, len(values))
	for key, value := range values {
		next[key] = value
	}
	return next
}

func cloneCanvasActionParams(params map[string]any) map[string]any {
	next := make(map[string]any, len(params))
	for key, value := range params {
		next[key] = value
	}
	return next
}

func canvasTextHasExplicitRotationDegrees(text string) bool {
	return containsAnyText(text,
		"90", "180", "270",
		"ninety", "one eighty", "one-eighty", "hundred eighty", "two seventy", "two-seventy",
	)
}

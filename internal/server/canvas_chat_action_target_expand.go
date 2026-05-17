package server

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

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
	visibleAssetIDs := visibleCanvasAssetIDs(canvas)
	selectedImageCardIDs := selectedCanvasImageCardIDs(canvas)
	selectedOCRCardIDs := selectedCanvasOCRCardIDs(canvas)
	limitToSingle := canvasUserLimitsToSingleAsset(latestUserMessage)
	targetsVisibleAssets := canvasUserTargetsVisibleAssets(latestUserMessage)

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
			if canvasToolCanUseSelectedAssetIDs(act.Tool) &&
				toolCounts[act.Tool] == 1 &&
				len(targetAssetIDs) == 0 &&
				len(selectedAssetIDs) == 0 &&
				len(visibleAssetIDs) > 0 &&
				targetsVisibleAssets {
				clone := act
				if limitToSingle {
					setCanvasActionAssetIDs(&clone, visibleAssetIDs[:1])
				} else {
					setCanvasActionAssetIDs(&clone, visibleAssetIDs)
				}
				expanded = append(expanded, clone)
				continue
			}
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

func canvasUserTargetsVisibleAssets(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"visible", "existing", "current", "on the canvas", "all image", "all asset", "both", "each", "every",
	)
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

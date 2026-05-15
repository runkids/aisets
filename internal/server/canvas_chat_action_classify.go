package server

import (
	"aisets/internal/llm"
	"fmt"
	"strings"
)

func canvasActionsFromToolCalls(calls []llm.ChatToolCall) []canvasAction {
	var actions []canvasAction
	for _, call := range calls {
		if canvasToolCardinality(call.Name) == "" {
			continue
		}
		params := call.Arguments
		description := ""
		impact := ""
		if nested, ok := params["params"].(map[string]any); ok {
			if rawDescription, ok := params["description"].(string); ok {
				description = rawDescription
			}
			if rawImpact, ok := params["impact"].(string); ok {
				impact = rawImpact
			}
			params = nested
		}
		if params == nil {
			params = map[string]any{}
		}
		actions = append(actions, canvasAction{
			Tool:        call.Name,
			Params:      params,
			Description: description,
			Impact:      impact,
		})
	}
	return actions
}

func canvasActionsOnlyFocus(actions []canvasAction) bool {
	if len(actions) == 0 {
		return false
	}
	for _, act := range actions {
		if act.Tool != "focus_card" {
			return false
		}
	}
	return true
}

func canvasActionToolNames(actions []canvasAction) []string {
	names := make([]string, 0, len(actions))
	for _, action := range actions {
		if action.Tool != "" {
			names = append(names, action.Tool)
		}
	}
	return names
}

func canvasActionsOnlyPreparatory(actions []canvasAction) bool {
	if len(actions) == 0 {
		return false
	}
	for _, act := range actions {
		if !canvasToolIsPreparatoryForCanvasWork(act.Tool) {
			return false
		}
	}
	return true
}

func canvasToolIsPreparatoryForCanvasWork(tool string) bool {
	switch tool {
	case "focus_card", "select_cards", "inspect_canvas":
		return true
	default:
		return false
	}
}

func canvasToolIsConcreteCanvasWork(tool string) bool {
	if canvasToolIsPreparatoryForCanvasWork(tool) {
		return false
	}
	switch tool {
	case "search_assets", "add_assets_to_canvas", "get_asset_detail", "extract_ocr_text",
		"compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text",
		"capture_viewport", "capture_canvas", "capture_selected":
		return false
	default:
		return canvasToolCardinality(tool) != ""
	}
}

func filterCanvasIncidentalCatalogSearchActions(actions []canvasAction) []canvasAction {
	hasImageOperation := false
	for _, act := range actions {
		if isCanvasOptimizationTool(act.Tool) || isCanvasImageTransformTool(act.Tool) {
			hasImageOperation = true
			break
		}
	}
	if !hasImageOperation {
		return actions
	}
	out := actions[:0]
	for _, act := range actions {
		if act.Tool == "search_assets" {
			continue
		}
		out = append(out, act)
	}
	return out
}

func canvasActionStatusMessage(act canvasAction) string {
	switch act.Tool {
	case "focus_card":
		if cardID := strings.TrimSpace(fmt.Sprint(act.Params["cardId"])); cardID != "" {
			return "Confirming target card: " + cardID
		}
		return "Confirming the target card."
	case "select_cards":
		return "Confirming the target selection before applying canvas changes."
	case "inspect_canvas":
		return "Inspecting the canvas before deciding the final placement."
	case "resize_card":
		return "Applying visual resize on the canvas."
	case "move_card", "arrange_cards":
		return "Applying the planned canvas placement."
	case "align_cards", "distribute_cards", "bring_cards_to_front":
		return "Applying the planned layout adjustment."
	default:
		if !canvasToolSafe(act.Tool) {
			return "Preparing confirmation proposal: " + act.Tool
		}
		if canvasToolIsConcreteCanvasWork(act.Tool) {
			return "Applying canvas operation: " + act.Tool
		}
		return ""
	}
}

func canvasActionStreamParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(params))
	for key, value := range params {
		if key == "label" {
			continue
		}
		out[key] = value
	}
	return out
}

func canvasToolDescription(tool string) string {
	for _, def := range canvasToolRegistry() {
		if def.Name == tool {
			return def.Description
		}
	}
	return "Canvas operation"
}

func canvasPlannedToolNames(latestUserMessage string) []string {
	var names []string
	add := func(name string) {
		for _, existing := range names {
			if existing == name {
				return
			}
		}
		names = append(names, name)
	}
	if canvasMessageWantsVisualResize(latestUserMessage) {
		add("resize_card")
	}
	if canvasMessageWantsVisualMove(latestUserMessage) {
		add("move_card")
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "arrange", "layout") {
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "align") {
		add("align_cards")
	}
	if len(names) == 0 && canvasUserWantsCanvasAction(latestUserMessage) {
		add("arrange_cards")
	}
	return names
}

func canvasFollowupStatusMessage(reason string, latestUserMessage string, preparatoryActionLoops int) string {
	planned := canvasPlannedToolNames(latestUserMessage)
	plannedText := strings.Join(planned, " / ")
	switch reason {
	case canvasLoopReasonFocusOnlyNeedsAnswer:
		if plannedText != "" {
			if preparatoryActionLoops > 1 {
				return "Target checks are done; next I will move from confirmation to operation tools: " + plannedText + "."
			}
			return "Target confirmed; next I am preparing the operation tools: " + plannedText + "."
		}
		return "Target confirmed; deciding the next canvas operation."
	case canvasLoopReasonToolResults:
		if plannedText != "" {
			return "Confirmation result received; continuing toward: " + plannedText + "."
		}
		return "Confirmation result received; deciding whether another canvas operation is needed."
	case canvasLoopReasonTextOnlyDeferredWork:
		if plannedText != "" {
			return "Converting the described plan into executable tools: " + plannedText + "."
		}
		return "Converting the described plan into executable canvas tools."
	case canvasLoopReasonCaptureOnlyWork:
		return "Capture was deferred until staging is complete; continuing with layout tools first."
	case canvasLoopReasonOCRTextExtraction:
		return "Text-bearing assets are on the canvas; extracting OCR before creating annotations."
	case canvasLoopReasonOCRTextAnnotation:
		return "OCR text is ready; creating the requested text annotations."
	default:
		return ""
	}
}

func canvasSearchQueryCandidates(s string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		out = append(out, v)
	}
	add(s)
	for _, match := range filenameTokenRe.FindAllStringSubmatch(s, -1) {
		if len(match) >= 2 {
			add(match[1])
		}
	}
	for _, token := range assetStemTokenRe.FindAllString(s, -1) {
		add(token)
	}
	for _, token := range canvasCatalogSearchQueryCandidates(s) {
		add(token)
	}
	return out
}

func canvasExactFilenameStem(s string) string {
	candidates := canvasSearchQueryCandidates(s)
	if len(candidates) > 1 {
		return candidates[1]
	}
	return ""
}

func containsAnyText(s string, terms ...string) bool {
	s = strings.ToLower(s)
	for _, term := range terms {
		if strings.Contains(s, strings.ToLower(term)) {
			return true
		}
	}
	return false
}

func isCanvasOptimizationTool(tool string) bool {
	switch tool {
	case "compress_image", "resize_image", "convert_image":
		return true
	default:
		return false
	}
}

func isCanvasImageTransformTool(tool string) bool {
	switch tool {
	case "mirror_image", "rotate_image":
		return true
	default:
		return false
	}
}

func canvasToolSuppressesSameTurnText(tool string) bool {
	return tool != "focus_card"
}

func canvasToolCompletesKnownChain(tool string, executed map[string]bool) bool {
	switch tool {
	case "align_cards":
		return true
	case "bring_cards_to_front":
		return executed["resize_card"] || executed["move_card"] || executed["arrange_cards"]
	case "remove_cards":
		return executed["duplicate_cards"] || executed["search_assets"]
	case "create_comment", "update_comment":
		return true
	case "capture_selected":
		return executed["capture_viewport"] || executed["capture_canvas"]
	case "generate_alt_text":
		return executed["compare_assets"] || executed["find_similar_assets"] || executed["inspect_image_quality"]
	default:
		return false
	}
}

func canvasUserAsksVisualIdentification(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"what is this", "what's this", "what is it", "what's it", "what is this doing", "what are they doing", "identify this", "recognize this",
	)
}

func canvasUserAsksOptimizationReview(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"issue", "problem", "quality", "review", "audit", "delivery", "performance", "file size", "too large",
	)
}

func canvasUserAsksAnnotation(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"annotate", "annotation", "comment", "comments", "commend", "commends", "add a note", "leave a note", "mark", "mark up", "circle", "highlight", "point to", "pin",
	)
}

func canvasFallbackCommentAllowed(latestUserMessage string, selectedSkillIDs []string) bool {
	return canvasUserAsksAnnotation(latestUserMessage) || canvasStringListContains(selectedSkillIDs, canvasSkillComments)
}

func canvasProposalAllowed(tool string, latestUserMessage string, options canvasChatOptions, nativeToolCall bool) bool {
	if canvasToolSafe(tool) {
		return true
	}
	if options.ImageOptimizationAdvice && isCanvasOptimizationTool(tool) && !canvasUserAsksVisualIdentification(latestUserMessage) {
		return true
	}
	if isCanvasOptimizationTool(tool) {
		return containsAnyText(latestUserMessage,
			"optimize", "optimization", "compress", "resize", "convert", "webp", "avif",
		)
	}
	if isCanvasImageTransformTool(tool) {
		return containsAnyText(latestUserMessage,
			"mirror", "flip", "flipped", "rotate", "rotation", "turn",
		)
	}

	mutationIntent := containsAnyText(latestUserMessage,
		"add", "update", "set", "save", "write", "apply", "change", "edit", "create", "generate",
	)

	switch tool {
	case "update_tags", "batch_update_tags":
		return mutationIntent && containsAnyText(latestUserMessage, "tag", "tags")
	case "update_description":
		return mutationIntent && containsAnyText(latestUserMessage, "description", "describe", "caption")
	case "update_ocr_text":
		return mutationIntent && containsAnyText(latestUserMessage, "ocr", "text")
	case "rename_asset":
		return containsAnyText(latestUserMessage, "rename")
	case "move_asset":
		return containsAnyText(latestUserMessage, "move")
	case "copy_asset":
		return containsAnyText(latestUserMessage, "copy", "duplicate")
	case "delete_asset":
		return containsAnyText(latestUserMessage, "delete", "remove")
	case "favorite_asset", "batch_favorite_assets":
		return containsAnyText(latestUserMessage, "favorite", "favourite")
	case "export_asset":
		return containsAnyText(latestUserMessage, "export", "download")
	default:
		return false
	}
}

func canvasProposalAllowedForAction(act canvasAction, latestUserMessage string, options canvasChatOptions, nativeToolCall bool) bool {
	if act.Tool == "copy_asset" && canvasCopyAssetProposalHasDestination(act) {
		return true
	}
	return canvasProposalAllowed(act.Tool, latestUserMessage, options, nativeToolCall)
}

func canvasCopyAssetProposalHasDestination(act canvasAction) bool {
	if act.Params == nil {
		return false
	}
	if text, ok := act.Params["destPath"].(string); ok && strings.TrimSpace(text) != "" {
		return len(canvasActionAssetIDs(act)) > 0
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok {
		return false
	}
	for _, row := range rows {
		values, ok := row.(map[string]any)
		if !ok {
			return false
		}
		assetID, _ := values["assetId"].(string)
		destPath, _ := values["destPath"].(string)
		if strings.TrimSpace(assetID) == "" || strings.TrimSpace(destPath) == "" {
			return false
		}
	}
	return len(rows) > 0
}

func canvasToolTargetsCatalogAssets(tool string) bool {
	switch tool {
	case "add_assets_to_canvas",
		"extract_ocr_text",
		"compare_assets",
		"find_similar_assets",
		"inspect_image_quality",
		"generate_alt_text",
		"update_tags",
		"batch_update_tags",
		"update_description",
		"update_ocr_text",
		"compress_image",
		"resize_image",
		"convert_image",
		"mirror_image",
		"rotate_image",
		"move_asset",
		"copy_asset",
		"delete_asset",
		"favorite_asset",
		"batch_favorite_assets",
		"export_asset":
		return true
	default:
		return false
	}
}

func canvasToolCanUseSelectedAssetIDs(tool string) bool {
	switch canvasToolCardinality(tool) {
	case "multi", "pair", "batchOnly":
		return canvasToolTargetsCatalogAssets(tool)
	default:
		return false
	}
}

func canvasToolIsCapture(tool string) bool {
	switch tool {
	case "capture_viewport", "capture_canvas", "capture_selected":
		return true
	default:
		return false
	}
}

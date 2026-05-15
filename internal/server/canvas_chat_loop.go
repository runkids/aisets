package server

import (
	"aisets/internal/agent"
	"aisets/internal/llm"
	"aisets/internal/scanner"
	"encoding/json"
	"fmt"
)

func canvasNextLoopReason(input canvasNextLoopInput) string {
	if input.Loop >= input.MaxLoops-1 {
		return ""
	}
	if input.TruncatedAction {
		return canvasLoopReasonTruncatedAction
	}
	if input.InvalidAction {
		return canvasLoopReasonInvalidAction
	}
	if input.IncompleteTextAnnotation {
		return canvasLoopReasonIncompleteTextAnnotation
	}
	if input.OCRTextExtraction {
		return canvasLoopReasonOCRTextExtraction
	}
	if input.OCRTextAnnotation {
		return canvasLoopReasonOCRTextAnnotation
	}
	if input.MissingCapture {
		return canvasLoopReasonMissingCapture
	}
	if input.CaptureOnlyDeferredWork {
		return canvasLoopReasonCaptureOnlyWork
	}
	if input.TextOnlyDeferredWork {
		return canvasLoopReasonTextOnlyDeferredWork
	}
	if input.FocusOnlyNeedsAnswer {
		return canvasLoopReasonFocusOnlyNeedsAnswer
	}
	if input.BlockedCommentNeedsAnswer {
		return canvasLoopReasonBlockedComment
	}
	if input.ToolResultCount > 0 {
		return canvasLoopReasonToolResults
	}
	return ""
}

func compactCanvasToolResult(tool string, result any) canvasCompactToolResult {
	summary, ok := compactCanvasValue("result", result).(map[string]any)
	if !ok {
		summary = map[string]any{"value": compactCanvasValue("value", result)}
	}
	return canvasCompactToolResult{Tool: tool, Summary: summary}
}

func compactCanvasValue(key string, value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		return truncate(v, 300)
	case bool, int, int64, float64:
		return v
	case []string:
		return v
	case []scanner.AssetItem:
		return compactCanvasAssetItems(v)
	case scanner.AssetItem:
		return compactCanvasAssetItem(v)
	case []any:
		limit := min(len(v), 20)
		out := make([]any, 0, limit)
		for _, item := range v[:limit] {
			out = append(out, compactCanvasValue(key, item))
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			if k == "items" {
				out[k] = compactCanvasValue(k, item)
				continue
			}
			out[k] = compactCanvasValue(k, item)
		}
		return out
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		var decoded any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return truncate(string(raw), 300)
		}
		return compactCanvasValue(key, decoded)
	}
}

func compactCanvasAssetItems(items []scanner.AssetItem) []map[string]any {
	limit := min(len(items), 8)
	out := make([]map[string]any, 0, limit)
	for _, item := range items[:limit] {
		out = append(out, compactCanvasAssetItem(item))
	}
	return out
}

func compactCanvasAssetItem(item scanner.AssetItem) map[string]any {
	summary := map[string]any{
		"assetId":     item.ID,
		"fileName":    canvasAssetFileName("", item.RepoPath),
		"repoPath":    item.RepoPath,
		"projectName": item.ProjectName,
		"ext":         item.Ext,
		"usedByCount": len(item.UsedBy),
		"image": map[string]any{
			"format":   item.Image.Format,
			"width":    item.Image.Width,
			"height":   item.Image.Height,
			"animated": item.Image.Animated,
			"alpha":    item.Image.Alpha,
			"pages":    item.Image.Pages,
			"bytes":    item.Bytes,
		},
		"visual": map[string]any{
			"url":          item.URL,
			"thumbnailUrl": item.ThumbnailURL,
		},
	}
	if item.AITag != nil {
		ai := map[string]any{}
		if item.AITag.Category != "" {
			ai["category"] = item.AITag.Category
		}
		if len(item.AITag.Tags) > 0 {
			ai["tags"] = item.AITag.Tags
		}
		if item.AITag.Description != "" {
			ai["description"] = truncate(item.AITag.Description, 180)
		}
		if len(item.AITag.Languages) > 0 {
			ai["languages"] = item.AITag.Languages
		}
		if len(ai) > 0 {
			summary["ai"] = ai
		}
	}
	if item.OCR != nil && item.OCR.Text != "" {
		summary["ocrText"] = truncate(item.OCR.Text, 180)
	}
	return summary
}

func canvasOCRAnnotationItems(result any) []canvasOCRAnnotationItem {
	raw, err := json.Marshal(result)
	if err != nil {
		return nil
	}
	var decoded struct {
		Items []canvasOCRAnnotationItem `json:"items"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	return decoded.Items
}

func canvasOCRTextAnnotationWorkflowRequested(latestUserMessage string, selectedSkillIDs []string, executed map[string]bool) bool {
	if !executed["add_assets_to_canvas"] {
		return false
	}
	if canvasUserAsksAnnotation(latestUserMessage) {
		return true
	}
	return canvasStringListContains(selectedSkillIDs, canvasSkillComments) && canvasStringListContains(selectedSkillIDs, canvasSkillOCR)
}

func markCanvasOCRResultAsIntermediate(result any) {
	if values, ok := result.(map[string]any); ok {
		values["displayToUser"] = false
		values["useForFollowup"] = "text_annotation"
	}
}

func canvasNativeToolsEnabled(backend string, tools []llm.ChatTool) bool {
	if len(tools) == 0 {
		return false
	}
	if _, ok := agent.AgentBackendID(backend); ok {
		return false
	}
	return true
}

func canvasNativeToolChoice(tools []llm.ChatTool, loopReason string) string {
	if len(tools) == 0 {
		return ""
	}
	switch loopReason {
	case "initial",
		canvasLoopReasonTruncatedAction,
		canvasLoopReasonMissingCapture,
		canvasLoopReasonTextOnlyDeferredWork,
		canvasLoopReasonFocusOnlyNeedsAnswer,
		canvasLoopReasonCaptureOnlyWork,
		canvasLoopReasonInvalidAction,
		canvasLoopReasonIncompleteTextAnnotation,
		canvasLoopReasonOCRTextExtraction,
		canvasLoopReasonOCRTextAnnotation:
		return "required"
	default:
		return ""
	}
}

func canvasNativeToolsForRound(tools []llm.ChatTool, loopReason string) []llm.ChatTool {
	if loopReason == canvasLoopReasonOCRTextExtraction {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{"extract_ocr_text": true}); len(filtered) > 0 {
			return filtered
		}
	}
	if loopReason == canvasLoopReasonOCRTextAnnotation {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{
			"create_comment": true,
			"remove_cards":   true,
			"arrange_cards":  true,
			"copy_asset":     true,
		}); len(filtered) > 0 {
			return requireCanvasNativeToolParams(filtered, "create_comment", "anchorCardId", "text", "region", "visualCue")
		}
	}
	if loopReason == canvasLoopReasonIncompleteTextAnnotation {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{"create_comment": true}); len(filtered) > 0 {
			return filtered
		}
	}
	if loopReason != canvasLoopReasonFocusOnlyNeedsAnswer {
		if loopReason == "initial" {
			if initialTools := filterCanvasNativeToolsByName(tools, canvasNativeInitialToolNames()); len(initialTools) > 0 {
				return initialTools
			}
		}
		return tools
	}
	filtered := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if canvasToolIsConcreteCanvasWork(tool.Name) {
			filtered = append(filtered, tool)
		}
	}
	if len(filtered) == 0 {
		return tools
	}
	return filtered
}

func requireCanvasNativeToolParams(tools []llm.ChatTool, toolName string, required ...string) []llm.ChatTool {
	out := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if tool.Name != toolName || len(tool.Parameters) == 0 {
			out = append(out, tool)
			continue
		}
		params := make(map[string]any, len(tool.Parameters)+1)
		for key, value := range tool.Parameters {
			params[key] = value
		}
		seen := map[string]bool{}
		nextRequired := make([]string, 0, len(required))
		for _, key := range canvasSchemaRequired(params) {
			if !seen[key] {
				seen[key] = true
				nextRequired = append(nextRequired, key)
			}
		}
		for _, key := range required {
			if !seen[key] {
				seen[key] = true
				nextRequired = append(nextRequired, key)
			}
		}
		params["required"] = nextRequired
		tool.Parameters = params
		out = append(out, tool)
	}
	return out
}

func canvasNativeInitialToolNames() map[string]bool {
	return map[string]bool{
		"focus_card":            true,
		"search_assets":         true,
		"add_assets_to_canvas":  true,
		"get_asset_detail":      true,
		"select_cards":          true,
		"distribute_cards":      true,
		"align_cards":           true,
		"resize_card":           true,
		"move_card":             true,
		"arrange_cards":         true,
		"bring_cards_to_front":  true,
		"inspect_canvas":        true,
		"duplicate_cards":       true,
		"remove_cards":          true,
		"extract_ocr_text":      true,
		"create_comment":        true,
		"update_comment":        true,
		"delete_comment":        true,
		"capture_viewport":      true,
		"capture_canvas":        true,
		"capture_selected":      true,
		"compare_assets":        true,
		"find_similar_assets":   true,
		"inspect_image_quality": true,
		"generate_alt_text":     true,
		"rotate_image":          true,
		"mirror_image":          true,
		"rename_asset":          true,
		"copy_asset":            true,
	}
}

func filterCanvasNativeToolsByName(tools []llm.ChatTool, allowed map[string]bool) []llm.ChatTool {
	if len(allowed) == 0 {
		return tools
	}
	out := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if allowed[tool.Name] {
			out = append(out, tool)
		}
	}
	return out
}

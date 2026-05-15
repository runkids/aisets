package server

import (
	"fmt"
	"strings"
)

func canvasPhotoStagingWorkflowRequested(latestUserMessage string, explicitSelectedSkillIDs []string, selectedSkillIDs []string) bool {
	if canvasStringListContains(explicitSelectedSkillIDs, canvasSkillPhotoStaging) {
		return true
	}
	if !canvasStringListContains(selectedSkillIDs, canvasSkillPhotoStaging) {
		return false
	}
	return containsAnyText(latestUserMessage,
		"professional photographer",
		"art director",
		"photo shoot",
		"photoshoot",
		"photo staging",
		"stage photos",
		"stage all visible image cards",
		"staged canvas screenshot",
		"beautify",
		"make beautiful",
		"portfolio shot",
		"hero shot",
		"editorial composition",
	)
}

func canvasPhotoStagingWorkTool(tool string) bool {
	switch tool {
	case "resize_card", "move_card", "arrange_cards", "align_cards", "distribute_cards", "bring_cards_to_front", "mirror_image", "rotate_image":
		return true
	default:
		return false
	}
}

func canvasPhotoStagingLayoutTool(tool string) bool {
	switch tool {
	case "resize_card", "move_card", "arrange_cards", "align_cards", "distribute_cards":
		return true
	default:
		return false
	}
}

func canvasPhotoStagingWorkCompleted(executed map[string]bool) bool {
	for _, tool := range []string{"resize_card", "move_card", "arrange_cards", "align_cards", "distribute_cards"} {
		if executed[tool] {
			return true
		}
	}
	return false
}

func canvasPhotoStagingActionCardIDs(act canvasAction) []string {
	addUnique := func(ids []string, value string) []string {
		value = strings.TrimSpace(value)
		if value == "" {
			return ids
		}
		for _, id := range ids {
			if id == value {
				return ids
			}
		}
		return append(ids, value)
	}
	switch act.Tool {
	case "resize_card", "move_card":
		var ids []string
		return addUnique(ids, fmt.Sprint(act.Params["cardId"]))
	case "arrange_cards":
		positions, ok := act.Params["positions"].([]any)
		if !ok {
			return nil
		}
		ids := make([]string, 0, len(positions))
		for _, raw := range positions {
			pos, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			ids = addUnique(ids, fmt.Sprint(pos["cardId"]))
		}
		return ids
	case "align_cards", "distribute_cards", "bring_cards_to_front":
		return canvasActionCardIDs(act)
	default:
		return nil
	}
}

func canvasPhotoStagingMissingTargetIDs(act canvasAction, canvas canvasSnapshot) []string {
	switch act.Tool {
	case "arrange_cards", "align_cards", "distribute_cards":
	default:
		return nil
	}
	required := canvasVisibleImageCardIDs(canvas)
	if len(required) == 0 {
		return nil
	}
	covered := map[string]bool{}
	for _, id := range canvasPhotoStagingActionCardIDs(act) {
		covered[id] = true
	}
	var missing []string
	for _, id := range required {
		if !covered[id] {
			missing = append(missing, id)
		}
	}
	return missing
}

func canvasPhotoStagingAllVisibleImagesCovered(canvas canvasSnapshot, covered map[string]bool) bool {
	required := canvasVisibleImageCardIDs(canvas)
	if len(required) == 0 {
		return true
	}
	for _, id := range required {
		if !covered[id] {
			return false
		}
	}
	return true
}

func canvasPhotoStagingMissingCoveredIDs(canvas canvasSnapshot, covered map[string]bool) []string {
	var missing []string
	for _, id := range canvasVisibleImageCardIDs(canvas) {
		if !covered[id] {
			missing = append(missing, id)
		}
	}
	return missing
}

func canvasPhotoStagingMissingReason(missing []string) string {
	if len(missing) == 0 {
		return "photo staging must include every visible image card before capture"
	}
	limit := min(len(missing), 12)
	suffix := ""
	if len(missing) > limit {
		suffix = fmt.Sprintf(" (+%d more)", len(missing)-limit)
	}
	return fmt.Sprintf("photo staging must include every visible image card before capture; missing cardIds: %s%s", strings.Join(missing[:limit], ", "), suffix)
}

func reorderCanvasPhotoStagingCaptureActions(actions []canvasAction, enabled bool) []canvasAction {
	if !enabled || len(actions) < 2 {
		return actions
	}
	nonCapture := make([]canvasAction, 0, len(actions))
	capture := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		if canvasToolIsCapture(act.Tool) {
			capture = append(capture, act)
		} else {
			nonCapture = append(nonCapture, act)
		}
	}
	if len(capture) == 0 || len(nonCapture) == 0 {
		return actions
	}
	return append(nonCapture, capture...)
}

func canvasPhotoStagingCaptureCompleted(completedTools []string) bool {
	return canvasStringListContains(completedTools, "capture_canvas") ||
		canvasStringListContains(completedTools, "capture_viewport") ||
		canvasStringListContains(completedTools, "capture_selected")
}

func canvasCaptureRequested(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"capture", "screenshot", "photo", "picture", "export", "download",
	)
}

func canvasFollowupShouldRetainImages(reason string, latestUserMessage string) bool {
	if reason == canvasLoopReasonMissingCapture {
		return true
	}
	if reason == canvasLoopReasonFocusOnlyNeedsAnswer {
		return true
	}
	if reason == canvasLoopReasonIncompleteTextAnnotation {
		return true
	}
	if reason == canvasLoopReasonOCRTextExtraction {
		return true
	}
	if reason == canvasLoopReasonOCRTextAnnotation {
		return true
	}
	if canvasUserWantsCanvasAction(latestUserMessage) && (reason == canvasLoopReasonFocusOnlyNeedsAnswer || reason == canvasLoopReasonTextOnlyDeferredWork || reason == canvasLoopReasonCaptureOnlyWork) {
		return true
	}
	return containsAnyText(latestUserMessage,
		"look at", "inspect", "compare", "analyze", "analyse", "describe",
		"what is in", "what's in", "visual", "image quality", "quality issue",
	)
}

func canvasCaptureRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The user's latest request asks for a screenshot/capture/export, but your previous response did not call a capture tool.
You DO have real frontend capture/export tools. Do not say the tool is unavailable.
Choose the correct capture tool yourself based on the request and canvas state:
- capture_viewport: visible viewport
- capture_canvas: entire canvas / full layout / exported canvas
- capture_selected: selected cards only
If the user asked for transparent or no-background output, set {"transparent": true}; otherwise false.

Latest user request: %q

Reply with exactly one action block and no prose. Use one of these exact forms:
`+"```"+`action
{"tool":"capture_canvas","params":{"transparent":true},"description":"Export the arranged canvas as a transparent image","impact":"Shows the screenshot preview"}
`+"```"+`
`+"```"+`action
{"tool":"capture_viewport","params":{"transparent":false},"description":"Capture the visible viewport","impact":"Shows the screenshot preview"}
`+"```"+`
`+"```"+`action
{"tool":"capture_selected","params":{"transparent":true},"description":"Capture the selected cards as a transparent image","impact":"Shows the screenshot preview"}
`+"```"+``, latestUserMessage)
}

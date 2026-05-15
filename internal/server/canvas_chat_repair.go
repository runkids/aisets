package server

import (
	"fmt"
	"math"
	"strings"
)

func canvasTextOnlyResponseNeedsActionRepair(textBody string, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 || nonFocusToolExecuted || strings.TrimSpace(textBody) == "" {
		return false
	}
	return canvasTextLooksLikeDeferredWork(textBody)
}

func canvasActionBlockTextNeedsActionRepair(usingNativeTools bool, loopReason string, textBody string, actionCount int, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if usingNativeTools || loop >= maxLoops-1 || nonFocusToolExecuted || actionCount > 0 || strings.TrimSpace(textBody) == "" {
		return false
	}
	switch loopReason {
	case "initial", canvasLoopReasonTextOnlyDeferredWork, canvasLoopReasonTruncatedAction, canvasLoopReasonMissingCapture, canvasLoopReasonCaptureOnlyWork, canvasLoopReasonInvalidAction, canvasLoopReasonNativeEmptyFallback, canvasLoopReasonOCRTextExtraction, canvasLoopReasonOCRTextAnnotation:
		return true
	default:
		return false
	}
}

func canvasRequiredNativeToolCallMissing(usingNativeTools bool, toolChoice string, textBody string, actionCount int, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 || nonFocusToolExecuted || actionCount > 0 {
		return false
	}
	return usingNativeTools && toolChoice == "required" && strings.TrimSpace(textBody) != ""
}

func canvasActionMentionsAssetOCR(act canvasAction, canvas canvasSnapshot) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	text := strings.TrimSpace(fmt.Sprint(act.Params["text"]))
	if text == "" {
		return false
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor == nil || anchor.Asset == nil {
		return false
	}
	ocrText := strings.TrimSpace(anchor.Asset.OcrText)
	return ocrText != "" && strings.Contains(text, ocrText)
}

func canvasActionTargetsTextRegion(act canvasAction) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	if !ok {
		return false
	}
	return cue.HasColor && canvasVisualCueLooksLikeText(cue)
}

func canvasActionHasVerifiableNonTextCue(act canvasAction) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	return ok && cue.HasColor && !canvasVisualCueLooksLikeText(cue)
}

func canvasActionHasRefinableVisualCue(act canvasAction) bool {
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	return ok && strings.TrimSpace(cue.TargetDescription) != "" && cue.HasColor
}

func canvasActionHasImageRegion(act canvasAction) bool {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return false
	}
	_, ok := canvasRegionFromValue(act.Params["region"])
	return ok
}

func canvasActionHasGenericPlaceholderRegion(act canvasAction) bool {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return false
	}
	region, ok := canvasRegionFromValue(act.Params["region"])
	return ok && canvasRegionLooksGenericPlaceholder(region)
}

func canvasRegionLooksGenericPlaceholder(region canvasRegion) bool {
	return math.Abs(region.X-0.1) <= 0.015 &&
		math.Abs(region.Y-0.2) <= 0.015 &&
		math.Abs(region.Width-0.2) <= 0.015 &&
		math.Abs(region.Height-0.1) <= 0.015
}

func canvasTextRegionActionDedupeKey(act canvasAction, canvas canvasSnapshot) string {
	if act.Tool != "create_comment" || !canvasActionTargetsTextRegion(act) {
		return ""
	}
	region, ok := canvasRegionFromValue(act.Params["region"])
	if !ok {
		return ""
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor == nil || anchor.ID == "" {
		return ""
	}
	return fmt.Sprintf(
		"%s:%s:%.3f:%.3f:%.3f:%.3f",
		act.Tool,
		anchor.ID,
		region.X,
		region.Y,
		region.Width,
		region.Height,
	)
}

func canvasIncompleteTextAnnotationNeedsRepair(actions []canvasAction, canvas canvasSnapshot, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 {
		return false
	}
	mentionsOCR := false
	hasTextRegion := false
	for _, act := range actions {
		if canvasActionTargetsTextRegion(act) {
			hasTextRegion = true
		}
		if canvasActionMentionsAssetOCR(act, canvas) {
			mentionsOCR = true
		}
	}
	return mentionsOCR && !hasTextRegion
}

func filterCanvasUnverifiableTextMentionActions(actions []canvasAction, canvas canvasSnapshot) ([]canvasAction, int) {
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		if canvasActionMentionsAssetOCR(act, canvas) && !canvasActionTargetsTextRegion(act) && !canvasActionHasVerifiableNonTextCue(act) {
			blocked++
			continue
		}
		filtered = append(filtered, act)
	}
	return filtered, blocked
}

func filterCanvasFallbackImageRegionActionsMissingVisualCue(actions []canvasAction, requireVisualCue bool) ([]canvasAction, []canvasActionValidationIssue) {
	if !requireVisualCue {
		return actions, nil
	}
	filtered := make([]canvasAction, 0, len(actions))
	var issues []canvasActionValidationIssue
	for _, act := range actions {
		if canvasActionHasImageRegion(act) && !canvasActionHasRefinableVisualCue(act) {
			issues = append(issues, canvasActionValidationIssue{
				Tool:   act.Tool,
				Reason: "fallback image-region actions must include visualCue.targetDescription and visualCue.colorHex so the marker can be refined against the original image pixels",
			})
			continue
		}
		filtered = append(filtered, act)
	}
	return filtered, issues
}

func filterCanvasIncompleteTextAnnotationActions(actions []canvasAction, loopReason string, repairPending bool) ([]canvasAction, int) {
	if loopReason != canvasLoopReasonIncompleteTextAnnotation && !repairPending {
		return actions, 0
	}
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		if act.Tool == "create_comment" && canvasActionTargetsTextRegion(act) {
			filtered = append(filtered, act)
			continue
		}
		blocked++
	}
	return filtered, blocked
}

func filterCanvasOCRTextAnnotationActions(actions []canvasAction, loopReason string) ([]canvasAction, int) {
	if loopReason != canvasLoopReasonOCRTextAnnotation {
		return actions, 0
	}
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		switch act.Tool {
		case "create_comment":
			if canvasActionHasImageRegion(act) && canvasActionTargetsTextRegion(act) {
				filtered = append(filtered, act)
				continue
			}
			blocked++
		case "remove_cards", "arrange_cards", "copy_asset":
			filtered = append(filtered, act)
		default:
			blocked++
		}
	}
	return filtered, blocked
}

func canvasTextLooksLikeDeferredWork(text string) bool {
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return false
	}

	futureMarkers := []string{
		"i will", "i'll", "i can", "i would", "i'm going to", "let me", "next, i", "here is the plan", "suggested",
	}
	hasFutureMarker := false
	for _, marker := range futureMarkers {
		if strings.Contains(text, marker) {
			hasFutureMarker = true
			break
		}
	}
	if !hasFutureMarker {
		return false
	}

	if containsAnyText(text,
		"imagegen", "image gen", "image generation", "generate image", "generated image",
		"use the image", "use imagegen", "built-in", "skill", "tool",
	) {
		return true
	}

	lineCount := 0
	listLikeLines := 0
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lineCount++
		if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") || strings.HasPrefix(line, "• ") ||
			(len(line) >= 2 && line[0] >= '1' && line[0] <= '9' && line[1] == '.') ||
			(len(line) >= 2 && line[0] >= '1' && line[0] <= '9' && line[1] == ')') {
			listLikeLines++
		}
	}
	if listLikeLines > 0 {
		return true
	}
	return lineCount >= 3
}

func canvasActionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous response described intended canvas work without producing an executable non-focus action.
Do not continue explaining the plan. Convert the described work into the closest available canvas tool actions now.
Use native tool calls if available; otherwise use action blocks.

Required behavior:
- Use canvas layout tools for visual board changes.
- Use create_comment with region for annotation, circle, mark, highlight, or object-location requests; put the location answer in the comment text.
- Use proposal tools for source-file or metadata changes.
- Use capture tools for screenshot/export work.
- If this is running inside Codex CLI and the work truly requires its built-in imagegen capability, use that capability now in this same response and return a concrete generated result. Do not merely say you will use imagegen later.
- If the work needs multiple steps, start with the first concrete tool action and continue after tool results.
- For CLI/text transport, output bracket action blocks like [action: create_comment] with param lines. Do not output only "done", "already", or a natural-language completion claim.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasIncompleteTextAnnotationRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`A previous comment mentioned OCR/text content from the asset, but no separate region-bearing text annotation was produced.
Add one create_comment for each missing OCR text target listed above. Do not repeat existing non-text comments.
For text, box the actual visible characters themselves, not the banner, sign, label, or container.
Required params: anchorCardId, text, region, visualCue.targetDescription, visualCue.colorHex.
Use a text visual cue such as targetDescription: "white text characters" and the text pixel color.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasOCRTextAnnotationRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The previous tool results contain OCR items for text-bearing candidates on the canvas.
Complete the visual text-annotation workflow now:
- Allowed tools in this round are create_comment, remove_cards, arrange_cards, and copy_asset only.
- Do not call search_assets, add_assets_to_canvas, extract_ocr_text, focus_card, inspect_canvas, or any prose-only response; those cannot complete this repair round.
- For each extract_ocr_text item with status "ready" and non-empty text, call create_comment on that same card or asset. Put the OCR text in the comment text.
- For each extract_ocr_text item with no readable text, call remove_cards for that card or asset because the user asked to show text-bearing images.
- If cards are removed, call arrange_cards for the remaining text-bearing cards so the layout stays even.
- Use the returned cardId when present. If only assetId is present for a newly added card, use that assetId as anchorCardId/cardId; the frontend resolves it to the created canvas card.
- For text, box the visible text area. If the exact character box is uncertain from metadata alone, box the visible text-bearing label/sign/image region rather than inventing unrelated coordinates.
- Include visualCue.targetDescription in English and visualCue.colorHex for text pixels when calling create_comment.
- If the original request also asks to copy files using the OCR text as filenames, call copy_asset in this same response after the comments. Use perAssetDestPaths with one assetId and OCR-derived destPath per source asset. This must create a proposal, not directly write files.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasOCRTextExtractionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The previous tool results show a text-bearing catalog search and assets were added to the canvas, but the OCR text needed for annotations has not been extracted yet.
Call extract_ocr_text for the added assetIds or cardIds from the compact tool results.
Required params: assetIds or cardIds, mode: "vlm", saveToMetadata: false.
Do not call selection, layout, focus, or prose-only tools in this repair round.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasUserWantsCanvasAction(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"arrange", "layout", "storyboard", "battle", "fight", "move", "position",
		"duplicate", "copy", "mirror", "flip", "rotate", "resize", "bigger", "larger", "smaller", "capture", "export",
	) || canvasMessageWantsVisualResize(latestUserMessage) ||
		canvasMessageWantsVisualMove(latestUserMessage) ||
		canvasMessageWantsVisualDuplicate(latestUserMessage)
}

func canvasFocusOnlyRepairPrompt(latestUserMessage string) string {
	if canvasUserWantsCanvasAction(latestUserMessage) {
		return fmt.Sprintf(`Your previous response only moved the cursor with focus_card, but the user's request requires canvas work.
	Every follow-up must either resolve a specific target/layout uncertainty or execute a concrete canvas operation.
	Do not repeat the same focus_card for the same target. If target confirmation is still needed, use select_cards or inspect_canvas with a precise reason. If the target is clear, call concrete operation tools such as arrange_cards, duplicate_cards, move_card, resize_card, capture_* tools, or image variant tools like mirror_image/rotate_image when image generation is requested.
	If this is running inside Codex CLI and the user is asking for newly generated artwork, use its built-in imagegen capability now. Do not only promise to use imagegen later.

	Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
	}
	return "Your previous response only moved the cursor with focus_card and did not answer or complete the user's request. Do NOT call focus_card again. If the original request asks for an edit, layout change, or file operation in any language, call the concrete non-focus tool now. If it is a visual question, answer the user's latest question in prose, or use a non-focus inspection/detail tool if more data is required."
}

func canvasCaptureOnlyRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous response only captured the canvas, but the user's request requires canvas editing or multi-step composition work.
Do NOT call capture_* again as the next action.
Use the closest executable non-capture canvas tool action now, such as arrange_cards, duplicate_cards, move_card, resize_card, or image variant tools like mirror_image/rotate_image when image generation is requested.
If this is running inside Codex CLI and the user is asking for newly generated artwork, use its built-in imagegen capability now. Do not only promise to use imagegen later.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasInvalidActionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous canvas tool call had invalid arguments. The backend normalized common aliases and scalar values where possible, but one or more tool calls still missed required fields or used invalid enum/type values.
Do not explain the mistake. Call the same intended canvas tool again with valid arguments that match the tool schema.
Use native tool calls if available; otherwise use action blocks.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasPhotoStagingFallbackAnswerText(latestUserMessage string, locale string) string {
	return "Completed the staged layout and screenshot. The composition uses focal hierarchy, spacing, layering, and deliberate scale or transform choices to support the requested style."
}

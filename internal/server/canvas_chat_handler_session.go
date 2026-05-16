package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

// canvasChatSession holds all loop state for a single handleCanvasChat invocation.
type canvasChatSession struct {
	// Server/HTTP references
	s *Server
	w http.ResponseWriter
	r *http.Request

	// Settings
	settings config.AppSettings

	// Request context
	req               canvasChatRequest
	locale            string
	latestUserMessage string

	// Backend
	backend      string
	providerName string
	modelName    string

	// Skill/tool config
	selectedSkillIDs      []string
	photoStagingWorkflow  bool
	usingNativeTools      bool

	// Prompt state (mutated across loops)
	systemPrompt  string
	canvasTools   []llm.ChatTool
	currentPrompt string
	promptKind    string
	userPrompt    string

	// Images
	images []vlmImage

	// Loop state
	proposalIndex                  int
	captureRequested               bool
	executedCaptureTools           map[string]bool
	photoStagingCoveredCardIDs     map[string]bool
	totalInputTokens               int64
	totalOutputTokens              int64
	start                          time.Time
	loopReason                     string
	loopStats                      []vlmChatRoundStats
	generatedImagePaths            map[string]bool
	concreteCanvasActionSeen       bool
	preparatoryActionLoops         int
	textEmitted                    bool
	executedCanvasTools            map[string]bool
	executedCanvasActionKeys       map[string]bool
	executedCanvasTextRegionKeys   map[string]bool
	cleanupProtectedCardIDs        map[string]bool
	executedCanvasToolSequence     []string
	textAnnotationRepairPending    bool
	textAssetSearchSeen            bool
	ocrTextAnnotationRepairPending bool
	latestOCRAnnotationItems       []canvasOCRAnnotationItem
	projectedCanvas                canvasSnapshot

	// Results
	addedCatalogItemsForAnswer []scanner.AssetItem
	createdCommentTexts        []string
}

func (cs *canvasChatSession) protectCleanupCardIDs(ids []string) {
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			cs.cleanupProtectedCardIDs[id] = true
		}
	}
}

func (cs *canvasChatSession) actionAlreadyExecuted(act canvasAction) bool {
	key := canvasActionExecutionKey(act)
	if key == "" {
		return false
	}
	return cs.executedCanvasActionKeys[key]
}

func (cs *canvasChatSession) rememberExecutedAction(act canvasAction) {
	if strings.TrimSpace(act.Tool) == "" {
		return
	}
	cs.executedCanvasTools[act.Tool] = true
	cs.executedCanvasToolSequence = append(cs.executedCanvasToolSequence, act.Tool)
	if key := canvasActionExecutionKey(act); key != "" {
		cs.executedCanvasActionKeys[key] = true
	}
}

func (cs *canvasChatSession) runToolLoop() {
	const maxToolLoops = 5
	const canvasOutputTokenLimit = 900

	for loop := 0; loop < maxToolLoops; loop++ {
		roundTools := cs.canvasTools
		roundToolChoice := ""
		if cs.usingNativeTools {
			roundTools = canvasNativeToolsForRound(cs.canvasTools, cs.loopReason)
			roundToolChoice = canvasNativeToolChoice(roundTools, cs.loopReason)
		}
		round := cs.s.chatVLMRound(cs.r.Context(), vlmChatRoundRequest{
			Images:           cs.images,
			Backend:          cs.backend,
			ModelName:        cs.modelName,
			SystemPrompt:     cs.systemPrompt,
			Prompt:           cs.currentPrompt,
			Purpose:          "canvas",
			TimeoutSec:       canvasOutputTokenLimit,
			Tools:            roundTools,
			ToolChoice:       roundToolChoice,
			ImageDetail:      "high",
			SelectedSkillIDs: cs.selectedSkillIDs,
			Loop:             loop,
			PromptKind:       cs.promptKind,
			LoopReason:       cs.loopReason,
		})
		cs.loopStats = append(cs.loopStats, round.Stats)
		statIndex := len(cs.loopStats) - 1
		if round.Err != nil {
			sendNDJSON(cs.w, map[string]any{
				"type":  "error",
				"error": map[string]string{"code": "canvas_chat_llm_failed", "message": round.Err.Error()},
			})
			return
		}
		content := round.Content
		chatResp := round.Response
		cs.totalInputTokens += chatResp.InputTokens
		cs.totalOutputTokens += chatResp.OutputTokens
		if cs.usingNativeTools && strings.TrimSpace(content) == "" && len(chatResp.ToolCalls) == 0 && loop < maxToolLoops-1 {
			cs.loopStats[statIndex].ToolUseSource = "native_empty"
			cs.loopStats[statIndex].NextReason = canvasLoopReasonNativeEmptyFallback
			cs.canvasTools = nil
			cs.usingNativeTools = false
			cs.systemPrompt = canvasSystemPromptForSkills(cs.locale, cs.req.Options, cs.selectedSkillIDs)
			cs.currentPrompt = cs.userPrompt
			cs.promptKind = vlmPromptKindFull
			cs.loopReason = canvasLoopReasonNativeEmptyFallback
			sendNDJSON(cs.w, map[string]any{"type": "thinking"})
			continue
		}
		for _, image := range cs.s.canvasGeneratedImagesFromContent(content, cs.generatedImagePaths) {
			sendNDJSON(cs.w, map[string]any{
				"type":             "generated_image",
				"token":            image.Token,
				"thumbnailDataUrl": image.ThumbnailDataURL,
				"fileName":         image.FileName,
				"width":            image.Width,
				"height":           image.Height,
			})
		}

		textBody, actions := parseCanvasActions(content)
		fallbackActionCount := len(actions)
		toolCallActions := canvasActionsFromToolCalls(chatResp.ToolCalls)
		toolUseSource := ""
		if len(toolCallActions) > 0 {
			actions = toolCallActions
			textBody = ""
			toolUseSource = "native_tool_call"
		} else if fallbackActionCount > 0 {
			toolUseSource = "fallback_parse"
		}
		cs.loopStats[statIndex].ToolUseSource = toolUseSource
		cs.loopStats[statIndex].NativeToolCallCount = len(toolCallActions)
		cs.loopStats[statIndex].FallbackActionCount = fallbackActionCount
		truncatedAction := canvasActionBlockLikelyTruncated(content) && loop < maxToolLoops-1
		var invalidActionIssues []canvasActionValidationIssue
		actions, invalidActionIssues = normalizeCanvasActions(actions, false)
		if cs.usingNativeTools && len(chatResp.ToolCalls) > 0 && len(toolCallActions) == 0 && strings.TrimSpace(content) == "" {
			for _, call := range chatResp.ToolCalls {
				invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
					Tool:   call.Name,
					Reason: "unknown or unsupported native tool call",
				})
			}
		}
		actions = expandCanvasMultiSelectedActions(actions, cs.projectedCanvas, cs.latestUserMessage)
		actions = refineCanvasActionTargets(actions, cs.projectedCanvas, cs.latestUserMessage)
		actions = refineCanvasSearchActions(actions, cs.latestUserMessage)
		actions = filterCanvasIncidentalCatalogSearchActions(actions)
		var postExpansionIssues []canvasActionValidationIssue
		actions, postExpansionIssues = normalizeCanvasActions(actions, true)
		var blockedUnverifiableTextActionCount int
		actions, blockedUnverifiableTextActionCount = filterCanvasUnverifiableTextMentionActions(actions, cs.projectedCanvas)
		var missingVisualCueIssues []canvasActionValidationIssue
		actions, missingVisualCueIssues = filterCanvasFallbackImageRegionActionsMissingVisualCue(actions, toolUseSource != "native_tool_call")
		var blockedIncompleteTextActionCount int
		actions, blockedIncompleteTextActionCount = filterCanvasIncompleteTextAnnotationActions(actions, cs.loopReason, cs.textAnnotationRepairPending)
		var blockedOCRTextAnnotationActionCount int
		actions, blockedOCRTextAnnotationActionCount = filterCanvasOCRTextAnnotationActions(actions, cs.loopReason)
		actions = reorderCanvasPhotoStagingCaptureActions(actions, cs.photoStagingWorkflow)
		invalidActionIssues = append(invalidActionIssues, postExpansionIssues...)
		invalidActionIssues = append(invalidActionIssues, missingVisualCueIssues...)
		if cs.usingNativeTools && len(chatResp.ToolCalls) > 0 && len(actions) == 0 && strings.TrimSpace(content) == "" {
			invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
				Tool:   "native_tool_call",
				Reason: "native tool calls did not produce executable canvas actions: " + strings.Join(canvasActionToolNames(toolCallActions), ", "),
			})
		}
		invalidActionNeedsRepair := len(invalidActionIssues) > 0 && loop < maxToolLoops-1
		cs.loopStats[statIndex].ActionCount = len(actions)
		cs.loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		cs.loopStats[statIndex].InvalidActionIssues = invalidActionIssues
		hasCaptureAction := false
		for _, act := range actions {
			if canvasToolIsCapture(act.Tool) {
				hasCaptureAction = true
				break
			}
		}
		missingCapture := false

		var compactToolResults []canvasCompactToolResult
		captureExecutedThisLoop := false
		nonCaptureToolExecutedThisLoop := false
		nonFocusToolExecutedThisLoop := false
		blockedCommentNeedsAnswer := false
		executedActionCount := 0
		safeActionCount := 0
		proposalCount := 0
		blockedProposalCount := 0
		blockedCommentCount := 0
		executedTextAnnotation := false
		ocrTextExtractionNeededThisLoop := false
		ocrTextAnnotationNeededThisLoop := false
		blockedGenericTextRegionCount := 0
		var executedCommentResults []canvasCompactToolResult
		captureBeforeStagingWork := false
		photoStagingCoverageRepairPending := false
		photoStagingDeferredWorkForInvalidLoop := false
		for _, issue := range invalidActionIssues {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
		}
		for i := 0; i < blockedUnverifiableTextActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "comment mentioned OCR/text content but did not include a verifiable visualCue for either the non-text target or the text characters",
			}))
		}
		for i := 0; i < blockedIncompleteTextActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "text annotation repair requires a create_comment whose visualCue.targetDescription identifies text, letters, words, glyphs, or characters and whose visualCue.colorHex provides the text pixel color",
			}))
		}
		for i := 0; i < blockedOCRTextAnnotationActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "OCR text annotation repair requires create_comment with a text visualCue, remove_cards for non-text results, arrange_cards for layout, or copy_asset with perAssetDestPaths when the original request asks for text-derived filenames",
			}))
		}
		for _, act := range actions {
			if act.Tool == "search_assets" && canvasSearchActionRequestsOCRText(act) {
				cs.textAssetSearchSeen = true
			}
			if act.Tool == "remove_cards" {
				requestedRemoveIDs := canvasActionCardIDs(act)
				act = filterCanvasRemoveActionProtectedCards(act, cs.cleanupProtectedCardIDs)
				if len(canvasActionCardIDs(act)) == 0 && len(requestedRemoveIDs) > 0 && cs.executedCanvasTools["duplicate_cards"] {
					setCanvasActionCardIDs(&act, canvasCleanupCandidateCardIDs(cs.projectedCanvas, cs.cleanupProtectedCardIDs))
				}
				if len(canvasActionCardIDs(act)) == 0 {
					continue
				}
			}
			act = normalizeCanvasImageRegionAction(act, cs.projectedCanvas)
			act = cs.s.refineCanvasImageRegionAction(cs.r.Context(), act, cs.projectedCanvas)
			act = fillCanvasCopyAssetDestPathsFromOCR(act, cs.latestOCRAnnotationItems)
			act = sanitizeCanvasCopyAssetDestPathsFromOCR(act, cs.latestOCRAnnotationItems)
			act = normalizeCanvasCopyAssetDestPaths(act)
			if cs.loopReason == canvasLoopReasonOCRTextAnnotation && act.Tool == "create_comment" && canvasActionTargetsTextRegion(act) && canvasActionHasGenericPlaceholderRegion(act) {
				blockedGenericTextRegionCount++
				compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
					Tool:   "create_comment",
					Reason: "OCR text annotation still used a generic placeholder region after image refinement; provide a specific box around the visible text pixels",
				}))
				continue
			}
			if cs.actionAlreadyExecuted(act) {
				continue
			}
			if key := canvasTextRegionActionDedupeKey(act, cs.projectedCanvas); key != "" {
				if cs.executedCanvasTextRegionKeys[key] {
					continue
				}
				cs.executedCanvasTextRegionKeys[key] = true
			}
			if cs.photoStagingWorkflow && len(invalidActionIssues) > 0 && (canvasPhotoStagingWorkTool(act.Tool) || canvasToolIsCapture(act.Tool)) {
				if !photoStagingDeferredWorkForInvalidLoop {
					photoStagingDeferredWorkForInvalidLoop = true
					issue := canvasActionValidationIssue{
						Tool:   act.Tool,
						Reason: "photo staging deferred layout and capture because this loop contains invalid tool calls; repair invalid arguments and return one clean final layout before capture",
					}
					invalidActionIssues = append(invalidActionIssues, issue)
					compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
				}
				continue
			}
			if cs.photoStagingWorkflow && canvasPhotoStagingWorkTool(act.Tool) {
				if missing := canvasPhotoStagingMissingTargetIDs(act, cs.projectedCanvas); len(missing) > 0 {
					photoStagingCoverageRepairPending = true
					issue := canvasActionValidationIssue{
						Tool:   act.Tool,
						Reason: canvasPhotoStagingMissingReason(missing),
					}
					invalidActionIssues = append(invalidActionIssues, issue)
					compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
					continue
				}
			}
			if cs.photoStagingWorkflow && canvasToolIsCapture(act.Tool) {
				reason := ""
				if len(invalidActionIssues) > 0 || photoStagingCoverageRepairPending {
					reason = "photo staging capture is deferred because earlier staging tool calls in this loop are invalid or incomplete; repair the invalid arguments and finish the layout before capture"
				} else if !canvasPhotoStagingWorkCompleted(cs.executedCanvasTools) ||
					!canvasPhotoStagingAllVisibleImagesCovered(cs.projectedCanvas, cs.photoStagingCoveredCardIDs) {
					reason = canvasPhotoStagingMissingReason(canvasPhotoStagingMissingCoveredIDs(cs.projectedCanvas, cs.photoStagingCoveredCardIDs))
				}
				if reason != "" {
					captureBeforeStagingWork = true
					issue := canvasActionValidationIssue{
						Tool:   act.Tool,
						Reason: reason,
					}
					invalidActionIssues = append(invalidActionIssues, issue)
					compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
					continue
				}
			}
			if status := canvasActionStatusMessage(act); status != "" {
				sendNDJSON(cs.w, map[string]any{
					"type":    "status",
					"phase":   "confirming",
					"content": status,
				})
			}
			if act.Tool == "focus_card" {
				executedActionCount++
				safeActionCount++
				sendNDJSON(cs.w, map[string]any{
					"type":   "focus",
					"cardId": act.Params["cardId"],
				})
				cs.rememberExecutedAction(act)
				time.Sleep(300 * time.Millisecond)
				continue
			}
			if act.Tool == "create_comment" && toolUseSource != "native_tool_call" && !canvasFallbackCommentAllowed(cs.latestUserMessage, cs.selectedSkillIDs) {
				blockedCommentNeedsAnswer = true
				blockedCommentCount++
				continue
			}
			if canvasToolSafe(act.Tool) {
				if canvasToolIsCapture(act.Tool) {
					if cs.executedCaptureTools[act.Tool] {
						continue
					}
					cs.executedCaptureTools[act.Tool] = true
					captureExecutedThisLoop = true
				}
				result := cs.s.executeCanvasSafeAction(cs.r, act, cs.settings, cs.projectedCanvas)
				if act.Tool == "extract_ocr_text" && canvasOCRTextAnnotationWorkflowRequested(cs.latestUserMessage, cs.selectedSkillIDs, cs.executedCanvasTools) {
					markCanvasOCRResultAsIntermediate(result)
					if items := canvasOCRAnnotationItems(result); len(items) > 0 {
						cs.latestOCRAnnotationItems = items
						if !cs.executedCanvasTools["create_comment"] {
							ocrTextAnnotationNeededThisLoop = true
						}
					}
					if len(cs.latestOCRAnnotationItems) > 0 && !cs.executedCanvasTools["create_comment"] {
						ocrTextAnnotationNeededThisLoop = true
					}
					compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
				}
				executedActionCount++
				safeActionCount++
				sendNDJSON(cs.w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				cs.projectedCanvas = applyCanvasActionResultToSnapshot(cs.projectedCanvas, act.Tool, result)
				if act.Tool == "add_assets_to_canvas" {
					cs.addedCatalogItemsForAnswer = appendCanvasAssetItemsUnique(cs.addedCatalogItemsForAnswer, canvasAssetItemsFromActionResult(result))
				}
				if act.Tool == "duplicate_cards" {
					if values, ok := result.(map[string]any); ok {
						cs.protectCleanupCardIDs(canvasParamStringSlice(values["cardIds"]))
						cs.protectCleanupCardIDs(canvasParamStringSlice(values["newCardIds"]))
					}
				}
				if act.Tool == "create_comment" {
					if values, ok := result.(map[string]any); ok {
						if text, ok := values["text"].(string); ok && strings.TrimSpace(text) != "" {
							cs.createdCommentTexts = append(cs.createdCommentTexts, strings.TrimSpace(text))
						}
					}
					if canvasActionTargetsTextRegion(act) {
						executedTextAnnotation = true
					}
					executedCommentResults = append(executedCommentResults, compactCanvasToolResult(act.Tool, result))
				}
				cs.rememberExecutedAction(act)
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					cs.concreteCanvasActionSeen = true
				}
				if canvasPhotoStagingLayoutTool(act.Tool) {
					for _, id := range canvasPhotoStagingActionCardIDs(act) {
						cs.photoStagingCoveredCardIDs[id] = true
					}
				}
				if act.Tool != "extract_ocr_text" {
					if !canvasToolIsCapture(act.Tool) {
						nonCaptureToolExecutedThisLoop = true
					}
					if !canvasToolCompletesKnownChain(act.Tool, cs.executedCanvasTools) {
						compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
					}
				}
			} else {
				if !canvasProposalAllowedForAction(act, cs.latestUserMessage, cs.req.Options, toolUseSource == "native_tool_call") {
					blockedProposalCount++
					continue
				}
				cs.proposalIndex++
				targetAssetIDs := canvasActionAssetIDs(act)
				var targetAssetID any
				if len(targetAssetIDs) > 0 {
					targetAssetID = targetAssetIDs[0]
				}
				sendNDJSON(cs.w, map[string]any{
					"type":           "proposal",
					"id":             fmt.Sprintf("p%d", cs.proposalIndex),
					"tool":           act.Tool,
					"params":         canvasActionStreamParams(act.Params),
					"description":    canvasToolDescription(act.Tool),
					"impact":         "Requires confirmation before applying.",
					"targetAssetId":  targetAssetID,
					"targetAssetIds": targetAssetIDs,
				})
				cs.rememberExecutedAction(act)
				executedActionCount++
				proposalCount++
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					cs.concreteCanvasActionSeen = true
				}
				if canvasPhotoStagingLayoutTool(act.Tool) {
					for _, id := range canvasPhotoStagingActionCardIDs(act) {
						cs.photoStagingCoveredCardIDs[id] = true
					}
				}
				nonCaptureToolExecutedThisLoop = true
			}
			time.Sleep(150 * time.Millisecond)
		}
		cs.loopStats[statIndex].ExecutedActionCount = executedActionCount
		cs.loopStats[statIndex].SafeActionCount = safeActionCount
		cs.loopStats[statIndex].ProposalCount = proposalCount
		cs.loopStats[statIndex].BlockedProposalCount = blockedProposalCount
		cs.loopStats[statIndex].BlockedCommentCount = blockedCommentCount
		cs.loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		cs.loopStats[statIndex].InvalidActionIssues = invalidActionIssues

		requiredNativeToolCallMissing := canvasRequiredNativeToolCallMissing(cs.usingNativeTools, roundToolChoice, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionBlockTextNeedsRepair := canvasActionBlockTextNeedsActionRepair(cs.usingNativeTools, cs.loopReason, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionRequestNeedsTool := requiredNativeToolCallMissing || actionBlockTextNeedsRepair || canvasTextOnlyResponseNeedsActionRepair(textBody, nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		incompleteTextAnnotation := blockedUnverifiableTextActionCount > 0 || blockedIncompleteTextActionCount > 0 || blockedGenericTextRegionCount > 0 || canvasIncompleteTextAnnotationNeedsRepair(actions, cs.projectedCanvas, loop, maxToolLoops)
		if executedTextAnnotation {
			cs.textAnnotationRepairPending = false
		}
		if cs.textAnnotationRepairPending && !executedTextAnnotation {
			incompleteTextAnnotation = true
		}
		if incompleteTextAnnotation {
			cs.textAnnotationRepairPending = true
		}
		if cs.textAssetSearchSeen &&
			cs.executedCanvasTools["add_assets_to_canvas"] &&
			!cs.executedCanvasTools["extract_ocr_text"] &&
			!cs.executedCanvasTools["create_comment"] &&
			canvasStringListContains(cs.selectedSkillIDs, canvasSkillComments) &&
			loop < maxToolLoops-1 {
			ocrTextExtractionNeededThisLoop = true
		}
		ocrTextAnnotation := ocrTextAnnotationNeededThisLoop
		if blockedOCRTextAnnotationActionCount > 0 {
			ocrTextAnnotation = true
		}
		if executedTextAnnotation {
			cs.ocrTextAnnotationRepairPending = false
		}
		if cs.ocrTextAnnotationRepairPending && !executedTextAnnotation {
			ocrTextAnnotation = true
		}
		if ocrTextAnnotation {
			cs.ocrTextAnnotationRepairPending = true
		}
		if photoStagingCoverageRepairPending && loop < maxToolLoops-1 {
			invalidActionNeedsRepair = true
		}
		if incompleteTextAnnotation {
			compactToolResults = append(compactToolResults, executedCommentResults...)
		}
		if (canvasUserWantsCanvasAction(cs.latestUserMessage) || cs.photoStagingWorkflow) && canvasActionsOnlyPreparatory(actions) && !cs.concreteCanvasActionSeen {
			cs.preparatoryActionLoops++
		}
		photoStagingNeedsLayout := cs.photoStagingWorkflow && canvasActionsOnlyPreparatory(actions) && !canvasPhotoStagingWorkCompleted(cs.executedCanvasTools)
		focusOnlyNeedsAnswer := (canvasActionsOnlyFocus(actions) || (canvasUserWantsCanvasAction(cs.latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !cs.concreteCanvasActionSeen) || photoStagingNeedsLayout) && !actionRequestNeedsTool && loop < maxToolLoops-1 && (textBody == "" || canvasUserWantsCanvasAction(cs.latestUserMessage) || cs.photoStagingWorkflow)
		if incompleteTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if ocrTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if textBody != "" && !truncatedAction && !nonFocusToolExecutedThisLoop && !actionRequestNeedsTool && !focusOnlyNeedsAnswer && !invalidActionNeedsRepair && !incompleteTextAnnotation && !cs.textAnnotationRepairPending && !ocrTextAnnotation && !cs.ocrTextAnnotationRepairPending && len(cs.addedCatalogItemsForAnswer) == 0 {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(cs.w, map[string]any{"type": "text", "content": p})
				cs.textEmitted = true
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		missingCapture = cs.captureRequested && len(cs.executedCaptureTools) == 0 && !hasCaptureAction && loop < maxToolLoops-1
		if cs.photoStagingWorkflow && (!canvasPhotoStagingWorkCompleted(cs.executedCanvasTools) ||
			!canvasPhotoStagingAllVisibleImagesCovered(cs.projectedCanvas, cs.photoStagingCoveredCardIDs)) {
			missingCapture = false
		}
		captureResultNeedsFollowup := captureExecutedThisLoop && len(compactToolResults) > 0 && (!nonCaptureToolExecutedThisLoop || cs.photoStagingWorkflow) && loop < maxToolLoops-1
		captureOnlyDeferredWork := captureBeforeStagingWork && (!canvasPhotoStagingWorkCompleted(cs.executedCanvasTools) ||
			!canvasPhotoStagingAllVisibleImagesCovered(cs.projectedCanvas, cs.photoStagingCoveredCardIDs))
		if cs.photoStagingWorkflow && captureExecutedThisLoop && !truncatedAction {
			break
		}
		if captureExecutedThisLoop && !truncatedAction && !captureResultNeedsFollowup {
			break
		}
		if proposalCount > 0 && !truncatedAction {
			break
		}
		nextLoopReason := canvasNextLoopReason(canvasNextLoopInput{
			Loop:                      loop,
			MaxLoops:                  maxToolLoops,
			ToolResultCount:           len(compactToolResults),
			TruncatedAction:           truncatedAction,
			MissingCapture:            missingCapture,
			TextOnlyDeferredWork:      actionRequestNeedsTool,
			FocusOnlyNeedsAnswer:      focusOnlyNeedsAnswer,
			BlockedCommentNeedsAnswer: blockedCommentNeedsAnswer,
			CaptureOnlyDeferredWork:   captureOnlyDeferredWork,
			InvalidAction:             invalidActionNeedsRepair,
			IncompleteTextAnnotation:  incompleteTextAnnotation,
			OCRTextExtraction:         ocrTextExtractionNeededThisLoop,
			OCRTextAnnotation:         ocrTextAnnotation,
		})
		cs.loopStats[statIndex].NextReason = nextLoopReason
		if nextLoopReason == "" {
			break
		}
		if status := canvasFollowupStatusMessage(nextLoopReason, cs.latestUserMessage, cs.preparatoryActionLoops); status != "" {
			sendNDJSON(cs.w, map[string]any{
				"type":    "status",
				"phase":   "planning",
				"content": status,
			})
		}
		if !canvasFollowupShouldRetainImages(nextLoopReason, cs.latestUserMessage) {
			cs.images = nil
		}
		cs.selectedSkillIDs = expandCanvasSkillFamiliesForLoopReason(cs.selectedSkillIDs, nextLoopReason, cs.latestUserMessage, cs.req.Options)
		if cs.usingNativeTools {
			cs.canvasTools = canvasNativeLLMToolsForSkills(cs.selectedSkillIDs)
			cs.systemPrompt = canvasNativeSystemPromptForSkills(cs.locale, cs.req.Options, cs.selectedSkillIDs)
		} else {
			cs.canvasTools = nil
			cs.systemPrompt = canvasSystemPromptForSkills(cs.locale, cs.req.Options, cs.selectedSkillIDs)
		}
		cs.currentPrompt = buildCanvasFollowupPrompt(nextLoopReason, cs.latestUserMessage, cs.projectedCanvas, actions, compactToolResults, cs.executedCanvasToolSequence, content, cs.photoStagingWorkflow)
		cs.promptKind = vlmPromptKindFollowup
		cs.loopReason = nextLoopReason
		sendNDJSON(cs.w, map[string]any{"type": "thinking"})
	}
}

func (cs *canvasChatSession) finalize() {
	if !cs.executedCanvasTools["arrange_cards"] && len(cs.addedCatalogItemsForAnswer) > 1 {
		act := canvasArrangeAddedCatalogItemsAction(cs.addedCatalogItemsForAnswer)
		if status := canvasActionStatusMessage(act); status != "" {
			sendNDJSON(cs.w, map[string]any{
				"type":    "status",
				"phase":   "operation",
				"content": status,
			})
		}
		result := cs.s.executeCanvasSafeAction(cs.r, act, cs.settings, cs.projectedCanvas)
		sendNDJSON(cs.w, map[string]any{
			"type":   "action_result",
			"tool":   act.Tool,
			"result": result,
		})
		cs.projectedCanvas = applyCanvasActionResultToSnapshot(cs.projectedCanvas, act.Tool, result)
		cs.rememberExecutedAction(act)
	}

	if !cs.textEmitted && cs.photoStagingWorkflow && canvasPhotoStagingCaptureCompleted(cs.executedCanvasToolSequence) {
		sendNDJSON(cs.w, map[string]any{"type": "text", "content": canvasPhotoStagingFallbackAnswerText(cs.latestUserMessage, cs.locale)})
		cs.textEmitted = true
	}

	if !cs.textEmitted && !cs.textAnnotationRepairPending && !cs.ocrTextAnnotationRepairPending {
		if answer := canvasCreatedCommentsAnswerText(cs.createdCommentTexts, cs.locale); answer != "" {
			sendNDJSON(cs.w, map[string]any{"type": "text", "content": answer})
			cs.textEmitted = true
		}
	}

	if !cs.textEmitted {
		if answer := canvasAddedAssetsAnswerText(cs.addedCatalogItemsForAnswer, cs.locale); answer != "" {
			sendNDJSON(cs.w, map[string]any{"type": "text", "content": answer})
			cs.textEmitted = true
		}
	}

	durationMs := time.Since(cs.start).Milliseconds()
	sendNDJSON(cs.w, map[string]any{
		"type":         "done",
		"providerName": cs.providerName,
		"modelName":    cs.modelName,
		"durationMs":   durationMs,
		"inputTokens":  cs.totalInputTokens,
		"outputTokens": cs.totalOutputTokens,
		"loopStats":    cs.loopStats,
	})
}

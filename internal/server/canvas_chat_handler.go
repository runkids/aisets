package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/scanner"
)

func (s *Server) handleCanvasChat(w http.ResponseWriter, r *http.Request) {
	var req canvasChatRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_request"))
		return
	}
	if len(req.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, apierr.New("canvas_chat_no_messages", "at least one message is required"))
		return
	}

	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "canvas_chat_settings_failed"))
		return
	}
	if !s.hasVLMBackend(settings) {
		writeJSON(w, http.StatusServiceUnavailable, apierr.New("canvas_chat_no_backend", "no AI backend configured"))
		return
	}

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureCanvas)

	locale := req.Locale
	if locale == "" {
		locale = "en"
	}
	req.Options.CanvasImageAttached = req.CanvasImage != ""
	req.Options.AutoLocale = settings.LLMAutoLocale
	req.Options.CanvasStrategy = s.canvasStrategyPrompt()
	latestUserMessage := latestCanvasUserMessage(req.Messages)
	explicitSelectedSkillIDs := normalizeCanvasSelectedSkillIDs(req.SelectedSkillIDs)
	selectedSkillIDs := explicitSelectedSkillIDs
	if len(selectedSkillIDs) == 0 {
		selectedSkillIDs = classifyCanvasSkillFamilies(canvasSkillClassifyInput{
			Message: latestUserMessage,
			Canvas:  req.Canvas,
			Options: req.Options,
		})
		if canvasLatestUserLanguage(latestUserMessage, locale) != "" {
			selectedSkillIDs = canvasAllSkillIDs()
		}
	}
	photoStagingWorkflow := canvasPhotoStagingWorkflowRequested(latestUserMessage, explicitSelectedSkillIDs, selectedSkillIDs)
	req.Options.PhotoStagingWorkflow = photoStagingWorkflow
	canvasTools := canvasLLMToolsForSkills(selectedSkillIDs)
	usingNativeTools := canvasNativeToolsEnabled(backend, canvasTools)
	if photoStagingWorkflow && backend == agent.BackendLocalLLM {
		usingNativeTools = false
	}
	systemPrompt := canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	if usingNativeTools {
		canvasTools = canvasNativeLLMToolsForSkills(selectedSkillIDs)
		systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	} else {
		canvasTools = nil
	}
	userPrompt := buildCanvasUserPrompt(req.Messages, req.Canvas, req.Options, locale)

	var images []vlmImage
	var canvasImage *vlmImage
	if req.CanvasImage != "" {
		path, cleanup, err := canvasImageTempFile(req.CanvasImage)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_canvas_image"))
			return
		}
		defer cleanup()
		canvasImage = &vlmImage{Path: path, Ext: ".png"}
	}
	imageLimit := 4
	useSelectedCoordinateGrid := len(selectedCanvasImageCardIDs(req.Canvas)) == 1
	selectedImageLimit := imageLimit
	if canvasImage != nil {
		selectedImageLimit--
	}
	for _, card := range req.Canvas.Cards {
		if card.Asset == nil {
			continue
		}
		selected := false
		for _, sid := range req.Canvas.SelectedCardIDs {
			if sid == card.ID {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			continue
		}
		item, err := s.store.CatalogItem(scanID, card.Asset.ID)
		if err != nil || item.LocalPath == "" {
			continue
		}
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(item.LocalPath); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: item.LocalPath, Ext: item.Ext})
		if len(images) >= selectedImageLimit {
			break
		}
	}
	for _, card := range req.Canvas.Cards {
		if len(images) >= selectedImageLimit {
			break
		}
		if card.Kind != "upload" || card.UploadToken == "" {
			continue
		}
		selected := false
		for _, sid := range req.Canvas.SelectedCardIDs {
			if sid == card.ID {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		download, ok := s.peekImageToolDownload(card.UploadToken)
		if !ok {
			continue
		}
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(download.Path); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
	}
	if canvasImage != nil && len(images) < imageLimit {
		images = append(images, *canvasImage)
	}
	for _, token := range req.AttachmentTokens {
		if len(images) >= imageLimit {
			break
		}
		if token == "" {
			continue
		}
		download, ok := s.peekImageToolDownload(token)
		if !ok {
			continue
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	if len(req.Canvas.SelectedCardIDs) > 0 {
		sendNDJSON(w, map[string]any{
			"type":   "focus",
			"cardId": req.Canvas.SelectedCardIDs[0],
		})
		time.Sleep(800 * time.Millisecond)
	}
	sendNDJSON(w, map[string]any{"type": "thinking"})

	const maxToolLoops = 5
	currentPrompt := userPrompt
	proposalIndex := 0
	captureRequested := canvasCaptureRequested(latestUserMessage) || photoStagingWorkflow
	executedCaptureTools := map[string]bool{}
	photoStagingCoveredCardIDs := map[string]bool{}
	var totalInputTokens, totalOutputTokens int64
	start := time.Now()

	const canvasOutputTokenLimit = 900
	promptKind := vlmPromptKindFull
	loopReason := "initial"
	var loopStats []vlmChatRoundStats
	generatedImagePaths := map[string]bool{}
	concreteCanvasActionSeen := false
	preparatoryActionLoops := 0
	textEmitted := false
	var addedCatalogItemsForAnswer []scanner.AssetItem
	var createdCommentTexts []string
	executedCanvasTools := map[string]bool{}
	executedCanvasActionKeys := map[string]bool{}
	executedCanvasTextRegionKeys := map[string]bool{}
	cleanupProtectedCardIDs := map[string]bool{}
	var executedCanvasToolSequence []string
	textAnnotationRepairPending := false
	textAssetSearchSeen := false
	ocrTextAnnotationRepairPending := false
	var latestOCRAnnotationItems []canvasOCRAnnotationItem
	projectedCanvas := req.Canvas
	protectCleanupCardIDs := func(ids []string) {
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id != "" {
				cleanupProtectedCardIDs[id] = true
			}
		}
	}
	canvasActionAlreadyExecuted := func(act canvasAction) bool {
		key := canvasActionExecutionKey(act)
		if key == "" {
			return false
		}
		return executedCanvasActionKeys[key]
	}
	rememberExecutedCanvasAction := func(act canvasAction) {
		if strings.TrimSpace(act.Tool) == "" {
			return
		}
		executedCanvasTools[act.Tool] = true
		executedCanvasToolSequence = append(executedCanvasToolSequence, act.Tool)
		if key := canvasActionExecutionKey(act); key != "" {
			executedCanvasActionKeys[key] = true
		}
	}
	for loop := 0; loop < maxToolLoops; loop++ {
		roundTools := canvasTools
		roundToolChoice := ""
		if usingNativeTools {
			roundTools = canvasNativeToolsForRound(canvasTools, loopReason)
			roundToolChoice = canvasNativeToolChoice(roundTools, loopReason)
		}
		round := s.chatVLMRound(r.Context(), vlmChatRoundRequest{
			Images:           images,
			Backend:          backend,
			ModelName:        modelName,
			SystemPrompt:     systemPrompt,
			Prompt:           currentPrompt,
			Purpose:          "canvas",
			TimeoutSec:       canvasOutputTokenLimit,
			Tools:            roundTools,
			ToolChoice:       roundToolChoice,
			ImageDetail:      "high",
			SelectedSkillIDs: selectedSkillIDs,
			Loop:             loop,
			PromptKind:       promptKind,
			LoopReason:       loopReason,
		})
		loopStats = append(loopStats, round.Stats)
		statIndex := len(loopStats) - 1
		if round.Err != nil {
			sendNDJSON(w, map[string]any{
				"type":  "error",
				"error": map[string]string{"code": "canvas_chat_llm_failed", "message": round.Err.Error()},
			})
			return
		}
		content := round.Content
		chatResp := round.Response
		totalInputTokens += chatResp.InputTokens
		totalOutputTokens += chatResp.OutputTokens
		if usingNativeTools && strings.TrimSpace(content) == "" && len(chatResp.ToolCalls) == 0 && loop < maxToolLoops-1 {
			loopStats[statIndex].ToolUseSource = "native_empty"
			loopStats[statIndex].NextReason = canvasLoopReasonNativeEmptyFallback
			canvasTools = nil
			usingNativeTools = false
			systemPrompt = canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
			currentPrompt = userPrompt
			promptKind = vlmPromptKindFull
			loopReason = canvasLoopReasonNativeEmptyFallback
			sendNDJSON(w, map[string]any{"type": "thinking"})
			continue
		}
		for _, image := range s.canvasGeneratedImagesFromContent(content, generatedImagePaths) {
			sendNDJSON(w, map[string]any{
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
		loopStats[statIndex].ToolUseSource = toolUseSource
		loopStats[statIndex].NativeToolCallCount = len(toolCallActions)
		loopStats[statIndex].FallbackActionCount = fallbackActionCount
		truncatedAction := canvasActionBlockLikelyTruncated(content) && loop < maxToolLoops-1
		var invalidActionIssues []canvasActionValidationIssue
		actions, invalidActionIssues = normalizeCanvasActions(actions, false)
		if usingNativeTools && len(chatResp.ToolCalls) > 0 && len(toolCallActions) == 0 && strings.TrimSpace(content) == "" {
			for _, call := range chatResp.ToolCalls {
				invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
					Tool:   call.Name,
					Reason: "unknown or unsupported native tool call",
				})
			}
		}
		actions = expandCanvasMultiSelectedActions(actions, projectedCanvas, latestUserMessage)
		actions = refineCanvasActionTargets(actions, projectedCanvas, latestUserMessage)
		actions = refineCanvasSearchActions(actions, latestUserMessage)
		actions = filterCanvasIncidentalCatalogSearchActions(actions)
		var postExpansionIssues []canvasActionValidationIssue
		actions, postExpansionIssues = normalizeCanvasActions(actions, true)
		var blockedUnverifiableTextActionCount int
		actions, blockedUnverifiableTextActionCount = filterCanvasUnverifiableTextMentionActions(actions, projectedCanvas)
		var missingVisualCueIssues []canvasActionValidationIssue
		actions, missingVisualCueIssues = filterCanvasFallbackImageRegionActionsMissingVisualCue(actions, toolUseSource != "native_tool_call")
		var blockedIncompleteTextActionCount int
		actions, blockedIncompleteTextActionCount = filterCanvasIncompleteTextAnnotationActions(actions, loopReason, textAnnotationRepairPending)
		var blockedOCRTextAnnotationActionCount int
		actions, blockedOCRTextAnnotationActionCount = filterCanvasOCRTextAnnotationActions(actions, loopReason)
		actions = reorderCanvasPhotoStagingCaptureActions(actions, photoStagingWorkflow)
		invalidActionIssues = append(invalidActionIssues, postExpansionIssues...)
		invalidActionIssues = append(invalidActionIssues, missingVisualCueIssues...)
		if usingNativeTools && len(chatResp.ToolCalls) > 0 && len(actions) == 0 && strings.TrimSpace(content) == "" {
			invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
				Tool:   "native_tool_call",
				Reason: "native tool calls did not produce executable canvas actions: " + strings.Join(canvasActionToolNames(toolCallActions), ", "),
			})
		}
		invalidActionNeedsRepair := len(invalidActionIssues) > 0 && loop < maxToolLoops-1
		loopStats[statIndex].ActionCount = len(actions)
		loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		loopStats[statIndex].InvalidActionIssues = invalidActionIssues
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
				textAssetSearchSeen = true
			}
			if act.Tool == "remove_cards" {
				requestedRemoveIDs := canvasActionCardIDs(act)
				act = filterCanvasRemoveActionProtectedCards(act, cleanupProtectedCardIDs)
				if len(canvasActionCardIDs(act)) == 0 && len(requestedRemoveIDs) > 0 && executedCanvasTools["duplicate_cards"] {
					setCanvasActionCardIDs(&act, canvasCleanupCandidateCardIDs(projectedCanvas, cleanupProtectedCardIDs))
				}
				if len(canvasActionCardIDs(act)) == 0 {
					continue
				}
			}
			act = normalizeCanvasImageRegionAction(act, projectedCanvas)
			act = s.refineCanvasImageRegionAction(r.Context(), act, projectedCanvas)
			act = fillCanvasCopyAssetDestPathsFromOCR(act, latestOCRAnnotationItems)
			act = sanitizeCanvasCopyAssetDestPathsFromOCR(act, latestOCRAnnotationItems)
			act = normalizeCanvasCopyAssetDestPaths(act)
			if loopReason == canvasLoopReasonOCRTextAnnotation && act.Tool == "create_comment" && canvasActionTargetsTextRegion(act) && canvasActionHasGenericPlaceholderRegion(act) {
				blockedGenericTextRegionCount++
				compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
					Tool:   "create_comment",
					Reason: "OCR text annotation still used a generic placeholder region after image refinement; provide a specific box around the visible text pixels",
				}))
				continue
			}
			if canvasActionAlreadyExecuted(act) {
				continue
			}
			if key := canvasTextRegionActionDedupeKey(act, projectedCanvas); key != "" {
				if executedCanvasTextRegionKeys[key] {
					continue
				}
				executedCanvasTextRegionKeys[key] = true
			}
			if photoStagingWorkflow && len(invalidActionIssues) > 0 && (canvasPhotoStagingWorkTool(act.Tool) || canvasToolIsCapture(act.Tool)) {
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
			if photoStagingWorkflow && canvasPhotoStagingWorkTool(act.Tool) {
				if missing := canvasPhotoStagingMissingTargetIDs(act, projectedCanvas); len(missing) > 0 {
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
			if photoStagingWorkflow && canvasToolIsCapture(act.Tool) {
				reason := ""
				if len(invalidActionIssues) > 0 || photoStagingCoverageRepairPending {
					reason = "photo staging capture is deferred because earlier staging tool calls in this loop are invalid or incomplete; repair the invalid arguments and finish the layout before capture"
				} else if !canvasPhotoStagingWorkCompleted(executedCanvasTools) ||
					!canvasPhotoStagingAllVisibleImagesCovered(projectedCanvas, photoStagingCoveredCardIDs) {
					reason = canvasPhotoStagingMissingReason(canvasPhotoStagingMissingCoveredIDs(projectedCanvas, photoStagingCoveredCardIDs))
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
				sendNDJSON(w, map[string]any{
					"type":    "status",
					"phase":   "confirming",
					"content": status,
				})
			}
			if act.Tool == "focus_card" {
				executedActionCount++
				safeActionCount++
				sendNDJSON(w, map[string]any{
					"type":   "focus",
					"cardId": act.Params["cardId"],
				})
				rememberExecutedCanvasAction(act)
				time.Sleep(300 * time.Millisecond)
				continue
			}
			if act.Tool == "create_comment" && toolUseSource != "native_tool_call" && !canvasFallbackCommentAllowed(latestUserMessage, selectedSkillIDs) {
				blockedCommentNeedsAnswer = true
				blockedCommentCount++
				continue
			}
			if canvasToolSafe(act.Tool) {
				if canvasToolIsCapture(act.Tool) {
					if executedCaptureTools[act.Tool] {
						continue
					}
					executedCaptureTools[act.Tool] = true
					captureExecutedThisLoop = true
				}
				result := s.executeCanvasSafeAction(r, act, settings, projectedCanvas)
				if act.Tool == "extract_ocr_text" && canvasOCRTextAnnotationWorkflowRequested(latestUserMessage, selectedSkillIDs, executedCanvasTools) {
					markCanvasOCRResultAsIntermediate(result)
					if items := canvasOCRAnnotationItems(result); len(items) > 0 {
						latestOCRAnnotationItems = items
						if !executedCanvasTools["create_comment"] {
							ocrTextAnnotationNeededThisLoop = true
						}
					}
					if len(latestOCRAnnotationItems) > 0 && !executedCanvasTools["create_comment"] {
						ocrTextAnnotationNeededThisLoop = true
					}
					compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
				}
				executedActionCount++
				safeActionCount++
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				projectedCanvas = applyCanvasActionResultToSnapshot(projectedCanvas, act.Tool, result)
				if act.Tool == "add_assets_to_canvas" {
					addedCatalogItemsForAnswer = appendCanvasAssetItemsUnique(addedCatalogItemsForAnswer, canvasAssetItemsFromActionResult(result))
				}
				if act.Tool == "duplicate_cards" {
					if values, ok := result.(map[string]any); ok {
						protectCleanupCardIDs(canvasParamStringSlice(values["cardIds"]))
						protectCleanupCardIDs(canvasParamStringSlice(values["newCardIds"]))
					}
				}
				if act.Tool == "create_comment" {
					if values, ok := result.(map[string]any); ok {
						if text, ok := values["text"].(string); ok && strings.TrimSpace(text) != "" {
							createdCommentTexts = append(createdCommentTexts, strings.TrimSpace(text))
						}
					}
					if canvasActionTargetsTextRegion(act) {
						executedTextAnnotation = true
					}
					executedCommentResults = append(executedCommentResults, compactCanvasToolResult(act.Tool, result))
				}
				rememberExecutedCanvasAction(act)
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					concreteCanvasActionSeen = true
				}
				if canvasPhotoStagingLayoutTool(act.Tool) {
					for _, id := range canvasPhotoStagingActionCardIDs(act) {
						photoStagingCoveredCardIDs[id] = true
					}
				}
				if act.Tool != "extract_ocr_text" {
					if !canvasToolIsCapture(act.Tool) {
						nonCaptureToolExecutedThisLoop = true
					}
					if !canvasToolCompletesKnownChain(act.Tool, executedCanvasTools) {
						compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
					}
				}
			} else {
				if !canvasProposalAllowedForAction(act, latestUserMessage, req.Options, toolUseSource == "native_tool_call") {
					blockedProposalCount++
					continue
				}
				proposalIndex++
				targetAssetIDs := canvasActionAssetIDs(act)
				var targetAssetID any
				if len(targetAssetIDs) > 0 {
					targetAssetID = targetAssetIDs[0]
				}
				sendNDJSON(w, map[string]any{
					"type":           "proposal",
					"id":             fmt.Sprintf("p%d", proposalIndex),
					"tool":           act.Tool,
					"params":         canvasActionStreamParams(act.Params),
					"description":    canvasToolDescription(act.Tool),
					"impact":         "Requires confirmation before applying.",
					"targetAssetId":  targetAssetID,
					"targetAssetIds": targetAssetIDs,
				})
				rememberExecutedCanvasAction(act)
				executedActionCount++
				proposalCount++
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					concreteCanvasActionSeen = true
				}
				if canvasPhotoStagingLayoutTool(act.Tool) {
					for _, id := range canvasPhotoStagingActionCardIDs(act) {
						photoStagingCoveredCardIDs[id] = true
					}
				}
				nonCaptureToolExecutedThisLoop = true
			}
			time.Sleep(150 * time.Millisecond)
		}
		loopStats[statIndex].ExecutedActionCount = executedActionCount
		loopStats[statIndex].SafeActionCount = safeActionCount
		loopStats[statIndex].ProposalCount = proposalCount
		loopStats[statIndex].BlockedProposalCount = blockedProposalCount
		loopStats[statIndex].BlockedCommentCount = blockedCommentCount
		loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		loopStats[statIndex].InvalidActionIssues = invalidActionIssues

		requiredNativeToolCallMissing := canvasRequiredNativeToolCallMissing(usingNativeTools, roundToolChoice, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionBlockTextNeedsRepair := canvasActionBlockTextNeedsActionRepair(usingNativeTools, loopReason, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionRequestNeedsTool := requiredNativeToolCallMissing || actionBlockTextNeedsRepair || canvasTextOnlyResponseNeedsActionRepair(textBody, nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		incompleteTextAnnotation := blockedUnverifiableTextActionCount > 0 || blockedIncompleteTextActionCount > 0 || blockedGenericTextRegionCount > 0 || canvasIncompleteTextAnnotationNeedsRepair(actions, projectedCanvas, loop, maxToolLoops)
		if executedTextAnnotation {
			textAnnotationRepairPending = false
		}
		if textAnnotationRepairPending && !executedTextAnnotation {
			incompleteTextAnnotation = true
		}
		if incompleteTextAnnotation {
			textAnnotationRepairPending = true
		}
		if textAssetSearchSeen &&
			executedCanvasTools["add_assets_to_canvas"] &&
			!executedCanvasTools["extract_ocr_text"] &&
			!executedCanvasTools["create_comment"] &&
			canvasStringListContains(selectedSkillIDs, canvasSkillComments) &&
			loop < maxToolLoops-1 {
			ocrTextExtractionNeededThisLoop = true
		}
		ocrTextAnnotation := ocrTextAnnotationNeededThisLoop
		if blockedOCRTextAnnotationActionCount > 0 {
			ocrTextAnnotation = true
		}
		if executedTextAnnotation {
			ocrTextAnnotationRepairPending = false
		}
		if ocrTextAnnotationRepairPending && !executedTextAnnotation {
			ocrTextAnnotation = true
		}
		if ocrTextAnnotation {
			ocrTextAnnotationRepairPending = true
		}
		if photoStagingCoverageRepairPending && loop < maxToolLoops-1 {
			invalidActionNeedsRepair = true
		}
		if incompleteTextAnnotation {
			compactToolResults = append(compactToolResults, executedCommentResults...)
		}
		if (canvasUserWantsCanvasAction(latestUserMessage) || photoStagingWorkflow) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen {
			preparatoryActionLoops++
		}
		photoStagingNeedsLayout := photoStagingWorkflow && canvasActionsOnlyPreparatory(actions) && !canvasPhotoStagingWorkCompleted(executedCanvasTools)
		focusOnlyNeedsAnswer := (canvasActionsOnlyFocus(actions) || (canvasUserWantsCanvasAction(latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen) || photoStagingNeedsLayout) && !actionRequestNeedsTool && loop < maxToolLoops-1 && (textBody == "" || canvasUserWantsCanvasAction(latestUserMessage) || photoStagingWorkflow)
		if incompleteTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if ocrTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if textBody != "" && !truncatedAction && !nonFocusToolExecutedThisLoop && !actionRequestNeedsTool && !focusOnlyNeedsAnswer && !invalidActionNeedsRepair && !incompleteTextAnnotation && !textAnnotationRepairPending && !ocrTextAnnotation && !ocrTextAnnotationRepairPending && len(addedCatalogItemsForAnswer) == 0 {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(w, map[string]any{"type": "text", "content": p})
				textEmitted = true
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		missingCapture = captureRequested && len(executedCaptureTools) == 0 && !hasCaptureAction && loop < maxToolLoops-1
		if photoStagingWorkflow && (!canvasPhotoStagingWorkCompleted(executedCanvasTools) ||
			!canvasPhotoStagingAllVisibleImagesCovered(projectedCanvas, photoStagingCoveredCardIDs)) {
			missingCapture = false
		}
		captureResultNeedsFollowup := captureExecutedThisLoop && len(compactToolResults) > 0 && (!nonCaptureToolExecutedThisLoop || photoStagingWorkflow) && loop < maxToolLoops-1
		captureOnlyDeferredWork := captureBeforeStagingWork && (!canvasPhotoStagingWorkCompleted(executedCanvasTools) ||
			!canvasPhotoStagingAllVisibleImagesCovered(projectedCanvas, photoStagingCoveredCardIDs))
		if photoStagingWorkflow && captureExecutedThisLoop && !truncatedAction {
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
		loopStats[statIndex].NextReason = nextLoopReason
		if nextLoopReason == "" {
			break
		}
		if status := canvasFollowupStatusMessage(nextLoopReason, latestUserMessage, preparatoryActionLoops); status != "" {
			sendNDJSON(w, map[string]any{
				"type":    "status",
				"phase":   "planning",
				"content": status,
			})
		}
		if !canvasFollowupShouldRetainImages(nextLoopReason, latestUserMessage) {
			images = nil
		}
		selectedSkillIDs = expandCanvasSkillFamiliesForLoopReason(selectedSkillIDs, nextLoopReason, latestUserMessage, req.Options)
		if usingNativeTools {
			canvasTools = canvasNativeLLMToolsForSkills(selectedSkillIDs)
			systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		} else {
			canvasTools = nil
			systemPrompt = canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		}
		currentPrompt = buildCanvasFollowupPrompt(nextLoopReason, latestUserMessage, projectedCanvas, actions, compactToolResults, executedCanvasToolSequence, content, photoStagingWorkflow)
		promptKind = vlmPromptKindFollowup
		loopReason = nextLoopReason
		sendNDJSON(w, map[string]any{"type": "thinking"})
	}

	if !executedCanvasTools["arrange_cards"] && len(addedCatalogItemsForAnswer) > 1 {
		act := canvasArrangeAddedCatalogItemsAction(addedCatalogItemsForAnswer)
		if status := canvasActionStatusMessage(act); status != "" {
			sendNDJSON(w, map[string]any{
				"type":    "status",
				"phase":   "operation",
				"content": status,
			})
		}
		result := s.executeCanvasSafeAction(r, act, settings, projectedCanvas)
		sendNDJSON(w, map[string]any{
			"type":   "action_result",
			"tool":   act.Tool,
			"result": result,
		})
		projectedCanvas = applyCanvasActionResultToSnapshot(projectedCanvas, act.Tool, result)
		rememberExecutedCanvasAction(act)
	}

	if !textEmitted && photoStagingWorkflow && canvasPhotoStagingCaptureCompleted(executedCanvasToolSequence) {
		sendNDJSON(w, map[string]any{"type": "text", "content": canvasPhotoStagingFallbackAnswerText(latestUserMessage, locale)})
		textEmitted = true
	}

	if !textEmitted && !textAnnotationRepairPending && !ocrTextAnnotationRepairPending {
		if answer := canvasCreatedCommentsAnswerText(createdCommentTexts, locale); answer != "" {
			sendNDJSON(w, map[string]any{"type": "text", "content": answer})
			textEmitted = true
		}
	}

	if !textEmitted {
		if answer := canvasAddedAssetsAnswerText(addedCatalogItemsForAnswer, locale); answer != "" {
			sendNDJSON(w, map[string]any{"type": "text", "content": answer})
			textEmitted = true
		}
	}

	durationMs := time.Since(start).Milliseconds()
	sendNDJSON(w, map[string]any{
		"type":         "done",
		"providerName": providerName,
		"modelName":    modelName,
		"durationMs":   durationMs,
		"inputTokens":  totalInputTokens,
		"outputTokens": totalOutputTokens,
		"loopStats":    loopStats,
	})
}

func canvasArrangeAddedCatalogItemsAction(items []scanner.AssetItem) canvasAction {
	const (
		cols   = 4
		startX = 100
		startY = 100
		gapX   = 380
		gapY   = 340
	)
	positions := make([]any, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.ID == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		index := len(positions)
		positions = append(positions, map[string]any{
			"cardId": item.ID,
			"x":      float64(startX + (index%cols)*gapX),
			"y":      float64(startY + (index/cols)*gapY),
		})
	}
	return canvasAction{
		Tool:        "arrange_cards",
		Params:      map[string]any{"positions": positions},
		Description: "Arrange newly added catalog assets",
		Impact:      "Places newly added cards into a scannable layout on the canvas",
	}
}

func canvasActionExecutionKey(act canvasAction) string {
	tool := strings.TrimSpace(act.Tool)
	if tool == "" {
		return ""
	}
	params, err := json.Marshal(canvasActionStreamParams(act.Params))
	if err != nil {
		return tool
	}
	return tool + ":" + string(params)
}

func splitParagraphs(text string) []string {
	raw := strings.Split(text, "\n\n")
	var result []string
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	if len(result) == 0 && text != "" {
		return []string{text}
	}
	return result
}

func (s *Server) latestScanID() int64 {
	scan, err := s.store.LatestScan()
	if err != nil {
		return 0
	}
	return scan.ID
}

func (s *Server) canvasStrategyPrompt() string {
	presets, err := s.store.ListPromptPresets("canvas")
	if err != nil {
		return config.DefaultCanvasPrompt()
	}
	for _, preset := range presets {
		if preset.IsDefault {
			return config.FormatPrompt(preset.Content)
		}
	}
	if len(presets) > 0 {
		return config.FormatPrompt(presets[0].Content)
	}
	return config.DefaultCanvasPrompt()
}

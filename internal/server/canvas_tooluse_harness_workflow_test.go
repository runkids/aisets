package server

import (
	"aisets/internal/llm"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestCanvasHarnessNativeToolResultsCanFinishHeroLayerChain(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"把主圖放大，移到中間，然後放到其他圖的最上層。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
		canvasHarnessToolCall("resize_card", map[string]any{"cardId": "card-a", "width": float64(420)}),
		canvasHarnessToolCall("move_card", map[string]any{"cardId": "card-a", "x": float64(240), "y": float64(180)}),
		canvasHarnessToolCall("bring_cards_to_front", map[string]any{"cardIds": []any{"card-a"}}),
		canvasHarnessText("Done."),
	)
	requireCanvasHarnessToolEventOrder(t, events, "resize_card", "move_card", "bring_cards_to_front")

	requests := provider.Requests()
	if len(requests) < 4 {
		t.Fatalf("expected native hero-layer follow-up loop, got %d requests", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	requireCanvasHarnessToolChoice(t, requests[2], "")
	requireCanvasHarnessToolChoice(t, requests[3], "")
	if prompt := requests[2].Messages[len(requests[2].Messages)-1].Content; !strings.Contains(prompt, `"width":420`) || !strings.Contains(prompt, `"height":420`) {
		t.Fatalf("resize follow-up prompt did not project updated size:\n%s", prompt)
	}
	if prompt := requests[3].Messages[len(requests[3].Messages)-1].Content; !strings.Contains(prompt, `"x":240`) || !strings.Contains(prompt, `"y":180`) || !strings.Contains(prompt, `"width":420`) || !strings.Contains(prompt, `"height":420`) {
		t.Fatalf("move follow-up prompt did not project updated geometry:\n%s", prompt)
	}
	fourthStat := requireCanvasHarnessLoopStat(t, events, 3)
	if fourthStat["reason"] != canvasLoopReasonToolResults {
		t.Fatalf("fourth reason = %#v", fourthStat["reason"])
	}
}

func TestCanvasHarnessNativeToolResultsCanContinueCaptureChain(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"幫我截目前 viewport；再截目前選取的圖片區域，背景透明。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessToolCall("capture_viewport", map[string]any{"transparent": false}),
		canvasHarnessToolCall("capture_selected", map[string]any{"transparent": true}),
		canvasHarnessText("Done."),
	)
	requireCanvasHarnessToolEventOrder(t, events, "capture_viewport", "capture_selected")

	requests := provider.Requests()
	if len(requests) != 2 {
		t.Fatalf("expected capture chain to stop after selected capture, got %d requests", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	requireCanvasHarnessToolChoice(t, requests[1], "")
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonToolResults {
		t.Fatalf("second reason = %#v", secondStat["reason"])
	}
}

func TestCanvasHarnessGroupToolsCreateRenameAndUngroupCanvasGroup(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"把目前選取的兩張圖片群組成一組，命名為主視覺，然後改名成封面組，最後解除群組。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		canvasHarnessToolCall("group_cards", map[string]any{"cardIds": []any{"card-a", "card-b"}, "name": "Hero group"}),
		canvasHarnessToolCall("rename_group", map[string]any{"cardId": "group-test", "name": "Cover group"}),
		canvasHarnessToolCall("ungroup_card", map[string]any{"cardId": "group-test"}),
	)
	requireCanvasHarnessToolEventOrder(t, events, "group_cards", "rename_group", "ungroup_card")
	groupEvent := requireCanvasHarnessEvent(t, events, "action_result", "group_cards")
	groupResult, ok := groupEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("group result = %#v", groupEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(groupResult["cardIds"]); !reflect.DeepEqual(got, []string{"card-a", "card-b"}) {
		t.Fatalf("group cardIds = %#v", got)
	}
	if strings.TrimSpace(fmt.Sprint(groupResult["groupId"])) == "" {
		t.Fatalf("groupId missing in result: %#v", groupResult)
	}
	requests := provider.Requests()
	if len(requests) < 3 {
		t.Fatalf("expected group follow-up loop, got %d requests", len(requests))
	}
	if prompt := requests[1].Messages[len(requests[1].Messages)-1].Content; !strings.Contains(prompt, `"kind":"group"`) || !strings.Contains(prompt, `"name":"Hero group"`) {
		t.Fatalf("group follow-up prompt did not project group state:\n%s", prompt)
	}
}

func TestCanvasHarnessGroupCardsUsesSelectedImagesWhenCardIdsOmitted(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"把目前選取的圖片群組起來。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		canvasHarnessToolCall("group_cards", map[string]any{"name": "Selected group"}),
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "group_cards")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("group result = %#v", event["result"])
	}
	if got := canvasHarnessEventStringSlice(result["cardIds"]); !reflect.DeepEqual(got, []string{"card-a", "card-b"}) {
		t.Fatalf("expanded group cardIds = %#v", got)
	}
}

func TestCanvasHarnessDuplicateCleanupProtectsSelectedOriginals(t *testing.T) {
	snapshot := canvasHarnessGenericRecoverySnapshot()
	snapshot.SelectedCardIDs = []string{"card-primary", "card-secondary"}
	events, _ := runCanvasToolUseHarness(
		t,
		"把目前選取的圖各複製兩張，放到空白區；如果多出不相關的候選圖就移除。",
		snapshot,
		canvasHarnessToolCall("duplicate_cards", map[string]any{
			"cardIds": []any{"card-primary", "card-secondary"},
			"count":   float64(2),
			"layout":  "grid",
		}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "dup-1", "x": float64(120), "y": float64(420)},
			map[string]any{"cardId": "dup-2", "x": float64(480), "y": float64(420)},
		}}),
		canvasHarnessToolCall("remove_cards", map[string]any{
			"cardIds": []any{"card-decoy", "card-primary", "card-secondary"},
		}),
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "remove_cards")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("remove result = %#v", event["result"])
	}
	got := canvasHarnessEventStringSlice(result["cardIds"])
	if !reflect.DeepEqual(got, []string{"card-decoy"}) {
		t.Fatalf("remove_cards cardIds = %#v, want card-decoy only", got)
	}
}

func TestCanvasHarnessDuplicateCleanupRecoversCandidateWhenModelTargetsOriginals(t *testing.T) {
	snapshot := canvasHarnessGenericRecoverySnapshot()
	snapshot.SelectedCardIDs = []string{"card-primary", "card-secondary"}
	events, _ := runCanvasToolUseHarness(
		t,
		"把目前選取的圖各複製兩張，放到空白區；如果多出不相關的候選圖就移除。",
		snapshot,
		canvasHarnessToolCall("duplicate_cards", map[string]any{
			"cardIds": []any{"card-primary", "card-secondary"},
			"count":   float64(2),
			"layout":  "grid",
		}),
		canvasHarnessToolCall("remove_cards", map[string]any{
			"cardIds": []any{"card-primary", "card-secondary"},
		}),
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "remove_cards")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("remove result = %#v", event["result"])
	}
	got := canvasHarnessEventStringSlice(result["cardIds"])
	if !reflect.DeepEqual(got, []string{"card-decoy"}) {
		t.Fatalf("remove_cards cardIds = %#v, want recovered decoy candidate", got)
	}
}

func TestCanvasHarnessStreamDoesNotEchoLocalizedActionMetadata(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"move selected cards",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a", "label": "狐狸和葡萄的卡片"}),
		canvasHarnessToolCall("select_cards", map[string]any{"cardIds": []any{"card-a", "card-b"}, "label": "需要移動的卡片"}),
		canvasHarnessToolCall("duplicate_cards", map[string]any{"cardIds": []any{"card-a"}, "count": float64(2), "label": "複製驢子圖片兩張"}),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "action_result", "select_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")

	data, err := json.Marshal(events)
	if err != nil {
		t.Fatalf("marshal events: %v", err)
	}
	for _, forbidden := range []string{"狐狸", "需要移動", "複製驢子"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("localized action metadata leaked into stream: %s in %s", forbidden, data)
		}
	}
}

func TestCanvasHarnessArrangesMultipleAddedCatalogItems(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"search cat related assets, add the most relevant 2 cards to the canvas, then arrange them in a row",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("search_assets", map[string]any{"q": "img", "limit": float64(2)}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA, bootstrap.assetB}}),
		canvasHarnessText("Added the two catalog assets."),
	)

	arrangeEvent := requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	result, ok := arrangeEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("arrange result = %#v", arrangeEvent["result"])
	}
	rawPositions, ok := result["positions"].([]any)
	if !ok || len(rawPositions) != 2 {
		t.Fatalf("positions = %#v", result["positions"])
	}
	gotIDs := make([]string, 0, len(rawPositions))
	for _, raw := range rawPositions {
		position, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("position = %#v", raw)
		}
		gotIDs = append(gotIDs, fmt.Sprint(position["cardId"]))
	}
	if !reflect.DeepEqual(gotIDs, []string{bootstrap.assetA, bootstrap.assetB}) {
		t.Fatalf("position card IDs = %#v", gotIDs)
	}
}

func TestCanvasHarnessNativeEmptyFallsBackToActionBlocks(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"find assets",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		llm.ChatResponse{Content: "", InputTokens: 100, OutputTokens: 91, DurationMs: 5},
		canvasHarnessText("```action\n{\"tool\":\"search_assets\",\"params\":{\"q\":\"img\",\"limit\":1},\"description\":\"Search\",\"impact\":\"Finds one asset\"}\n```"),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected native empty retry, got %d requests", len(requests))
	}
	if len(requests[0].Tools) == 0 {
		t.Fatal("first request should include native tools")
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	if strings.Contains(requests[0].Messages[0].Content, "## Available Tools") {
		t.Fatalf("native request duplicated text tool block:\n%s", requests[0].Messages[0].Content)
	}
	if len(requests[1].Tools) != 0 {
		t.Fatalf("fallback request should omit native tools, got %d", len(requests[1].Tools))
	}
	requireCanvasHarnessToolChoice(t, requests[1], "")
	if !strings.Contains(requests[1].Messages[0].Content, "## Available Tools") {
		t.Fatalf("fallback request missing text tool block:\n%s", requests[1].Messages[0].Content)
	}
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["toolUseSource"] != "native_empty" {
		t.Fatalf("first toolUseSource = %#v", firstStat["toolUseSource"])
	}
	if firstStat["nextReason"] != canvasLoopReasonNativeEmptyFallback {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonNativeEmptyFallback {
		t.Fatalf("second reason = %#v", secondStat["reason"])
	}
	if got := requireCanvasHarnessStatNumber(t, secondStat, "fallbackActionCount"); got != 1 {
		t.Fatalf("fallbackActionCount = %v", got)
	}
}

func TestCanvasHarnessFallbackActionFormats(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	cases := map[string]string{
		"action fence":         "```action\n{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140},\"description\":\"Move\",\"impact\":\"Moves card\"}\n```",
		"json fence":           "```json\n[{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140}}]\n```",
		"gemma":                "<|tool_call>call{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140}}<tool_call|>",
		"plain call":           "call:move_card{cardId:<|\"|>card-a<|\"|>,x:120,y:140}",
		"codex bracket action": "[action: move_card]\ndescription: Move card.\nimpact: Moves the card on the canvas.\ncardId: card-a\nx: 120\ny: 140",
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			events, _ := runCanvasToolUseHarness(
				t,
				"move this card",
				canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
				canvasHarnessText(content),
			)
			requireCanvasHarnessEvent(t, events, "action_result", "move_card")
			stat := requireCanvasHarnessLoopStat(t, events, 0)
			if stat["toolUseSource"] != "fallback_parse" {
				t.Fatalf("toolUseSource = %#v", stat["toolUseSource"])
			}
			if got := requireCanvasHarnessStatNumber(t, stat, "fallbackActionCount"); got != 1 {
				t.Fatalf("fallbackActionCount = %v", got)
			}
		})
	}
}

func TestCanvasHarnessFallbackBracketActionsExecuteMultipleTools(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"move these cards nearby",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessText(`[action: focus_card]
description: Focus the first selected card.
impact: Moves the cursor to the first card.
cardId: card-a

[action: arrange_cards]
description: Move both cards into a nearby column.
impact: Places both selected cards close together.
cards:
• cardId: card-a
  x: 120
  y: 140
• cardId: card-b
  x: 120
  y: 280`),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if stat["toolUseSource"] != "fallback_parse" {
		t.Fatalf("toolUseSource = %#v", stat["toolUseSource"])
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "fallbackActionCount"); got != 2 {
		t.Fatalf("fallbackActionCount = %v", got)
	}
}

func TestCanvasHarnessFallbackActionHeaderMoveCardsAlias(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"move humans away",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessText(`Action: focus_card
description: Focus the first card.
impact: Cursor moves to the first card.
cardId: card-a

Action: move_cards
description: Move all identified cards farther away.
impact: card-a moves to x=120, y=1540; card-b moves to x=120, y=2050.
cardIds: card-a, card-b`),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if stat["toolUseSource"] != "fallback_parse" {
		t.Fatalf("toolUseSource = %#v", stat["toolUseSource"])
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "fallbackActionCount"); got != 2 {
		t.Fatalf("fallbackActionCount = %v", got)
	}
}

func TestCanvasHarnessNativeFocusOnlyRepairsToNonFocusAction(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"move the tree card next to the cluster",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a", "label": "Tree card"}),
		canvasHarnessToolCall("move_card", map[string]any{"cardId": "card-a", "x": "120", "y": "140"}),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "status", "")
	requireCanvasHarnessEvent(t, events, "action_result", "move_card")
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected focus-only repair follow-up request, got %d", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	rejectCanvasHarnessRequestTool(t, requests[1], "focus_card")
	rejectCanvasHarnessRequestTool(t, requests[1], "select_cards")
	rejectCanvasHarnessRequestTool(t, requests[1], "inspect_canvas")
	requireCanvasHarnessRequestTool(t, requests[1], "move_card")
	requireCanvasHarnessRequestTool(t, requests[1], "resize_card")
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["toolUseSource"] != "native_tool_call" {
		t.Fatalf("first toolUseSource = %#v", firstStat["toolUseSource"])
	}
	if firstStat["nextReason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("second reason = %#v", secondStat["reason"])
	}
	if secondStat["toolUseSource"] != "native_tool_call" {
		t.Fatalf("second toolUseSource = %#v", secondStat["toolUseSource"])
	}
}

func TestCanvasHarnessNativePreparatoryActionsRepairUntilConcreteAction(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"resize the tree and move the donkey to empty space",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a", "label": "Tree card"}),
		canvasHarnessToolCall("resize_card", map[string]any{"cardId": "card-a", "width": "420"}),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	status := requireCanvasHarnessEvent(t, events, "status", "")
	if !strings.Contains(fmt.Sprint(status["content"]), "Confirming") {
		t.Fatalf("status content = %#v", status["content"])
	}
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected preparatory repair request, got %d", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	rejectCanvasHarnessRequestTool(t, requests[1], "focus_card")
	rejectCanvasHarnessRequestTool(t, requests[1], "select_cards")
	requireCanvasHarnessRequestTool(t, requests[1], "resize_card")
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("second reason = %#v", secondStat["reason"])
	}
}

func TestRefineCanvasActionTargetsKeepsAmbiguousLayoutActions(t *testing.T) {
	canvas := canvasHarnessGenericRecoverySnapshot()
	actions := []canvasAction{
		{
			Tool: "arrange_cards",
			Params: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-primary", "x": float64(1200), "y": float64(960)},
				map[string]any{"cardId": "card-secondary", "x": float64(1200), "y": float64(1320)},
			}},
		},
	}

	refined := refineCanvasActionTargets(actions, canvas, "move selected cards to empty space")

	if len(refined) != 1 {
		t.Fatalf("refined actions = %#v", refined)
	}
	got := canvasActionPositionCardIDs(refined[0])
	if !reflect.DeepEqual(got, []string{"card-primary", "card-secondary"}) {
		t.Fatalf("position card IDs = %#v", got)
	}
}

func TestCanvasHarnessUnknownNativeToolIsIgnored(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"use unknown tool",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("unknown_tool", map[string]any{"value": "ignored"}),
	)
	rejectCanvasHarnessEvent(t, events, "action_result", "unknown_tool")
	rejectCanvasHarnessEvent(t, events, "proposal", "unknown_tool")
	requireCanvasHarnessEvent(t, events, "done", "")
}

func TestCanvasHarnessBlocksUnrequestedComment(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"what is this image",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessText(`[action: create_comment]
description: Leave an unsolicited note.
impact: Adds a canvas comment.
anchorCardId: card-a
text: This is an unsolicited comment.`),
		canvasHarnessText("This image is a test asset."),
	)
	rejectCanvasHarnessEvent(t, events, "action_result", "create_comment")
	requireCanvasHarnessEvent(t, events, "text", "")
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if got := requireCanvasHarnessStatNumber(t, stat, "blockedCommentCount"); got != 1 {
		t.Fatalf("blockedCommentCount = %v", got)
	}
	if stat["nextReason"] != canvasLoopReasonBlockedComment {
		t.Fatalf("nextReason = %#v", stat["nextReason"])
	}
}

func TestCanvasHarnessUsesHighImageDetailForCanvasVision(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	_, provider := runCanvasToolUseHarness(
		t,
		"Where is the peach in this image? Circle it.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
	)
	requests := provider.Requests()
	if len(requests) == 0 {
		t.Fatal("provider received no requests")
	}
	if requests[0].ImageDetail != "high" {
		t.Fatalf("ImageDetail = %q, want high", requests[0].ImageDetail)
	}
}

func TestCanvasHarnessEnglishFollowupCopyPeachesCommentsGetsTools(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"Copy this image and find the peachs and then add commends",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessToolCall("duplicate_cards", map[string]any{"cardIds": []any{"card-a"}, "count": float64(1), "layout": "nearby"}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "Peach is on the headband.",
			"region":       map[string]any{"x": 0.4, "y": 0.22, "width": 0.2, "height": 0.12},
		}),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	requests := provider.Requests()
	if len(requests) == 0 {
		t.Fatal("provider received no requests")
	}
	requireCanvasHarnessRequestTools(t, requests[0], "duplicate_cards", "create_comment")
}

func TestCanvasHarnessAllowsNativeRequestedCommentWithoutBackendLanguageFallback(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"幫我在這張圖需要注意的地方留一個註解，標出可讀性問題。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "Readability issue: text is too small against the background.",
			"region":       map[string]any{"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.3},
		}),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	textEvent := requireCanvasHarnessEvent(t, events, "text", "")
	if !strings.Contains(fmt.Sprint(textEvent["content"]), "Added 1 comment.") {
		t.Fatalf("comment answer text missing: %#v", textEvent)
	}
}

func TestCanvasHarnessAllowsActionBlockRequestedCommentWithoutBackendLanguageFallback(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"請把圖片上桃子的地方圈起來，並在註解說桃子在哪裡",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessText(`[action: create_comment]
description: Add peach marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The peach is on the headband.
regionX: 0.29
regionY: 0.19
regionWidth: 0.11
regionHeight: 0.08
visualCueTargetDescription: small pink peach icon
visualCueColorHex: #f26aa0`),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
}

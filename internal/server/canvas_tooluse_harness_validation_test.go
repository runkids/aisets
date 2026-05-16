package server

import (
	"reflect"
	"strings"
	"testing"
)

func TestCanvasHarnessBlocksUnrequestedUnsafeProposal(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"what is this image",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("delete_asset", canvasHarnessDefaultArgs("delete_asset", bootstrap.assetA, bootstrap.assetB)),
	)
	rejectCanvasHarnessEvent(t, events, "proposal", "delete_asset")
	rejectCanvasHarnessEvent(t, events, "action_result", "delete_asset")
	requireCanvasHarnessEvent(t, events, "done", "")
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if got := requireCanvasHarnessStatNumber(t, stat, "blockedProposalCount"); got != 1 {
		t.Fatalf("blockedProposalCount = %v", got)
	}
	if _, exists := stat["proposalCount"]; exists {
		t.Fatalf("proposalCount should be omitted for blocked proposal: %#v", stat)
	}
}

func TestCanvasHarnessExpandsMultiSelectedAssetTargets(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"update tags on selected assets",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		canvasHarnessToolCall("update_tags", map[string]any{"tags": []any{"selected", "batch"}}),
	)
	proposal := requireCanvasHarnessEvent(t, events, "proposal", "update_tags")
	rawIDs, ok := proposal["targetAssetIds"].([]any)
	if !ok {
		t.Fatalf("targetAssetIds = %#v", proposal["targetAssetIds"])
	}
	got := make([]string, 0, len(rawIDs))
	for _, raw := range rawIDs {
		if id, ok := raw.(string); ok {
			got = append(got, id)
		}
	}
	want := []string{bootstrap.assetA, bootstrap.assetB}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("targetAssetIds = %#v, want %#v", got, want)
	}
}

func TestCanvasActionNormalizationCoercesCommonModelShapes(t *testing.T) {
	actions, issues := normalizeCanvasActions([]canvasAction{{
		Tool: "rotate_image",
		Params: map[string]any{
			"asset_id":      "asset-a",
			"rotateDegrees": "90",
			"output_format": "png",
		},
	}}, true)
	if len(issues) > 0 {
		t.Fatalf("unexpected issues: %#v", issues)
	}
	if len(actions) != 1 {
		t.Fatalf("actions = %#v", actions)
	}
	params := actions[0].Params
	if params["assetId"] != "asset-a" {
		t.Fatalf("assetId = %#v", params["assetId"])
	}
	if params["degrees"] != float64(90) {
		t.Fatalf("degrees = %#v", params["degrees"])
	}
	if _, exists := params["rotateDegrees"]; exists {
		t.Fatalf("rotateDegrees alias should be normalized away: %#v", params)
	}

	actions, issues = normalizeCanvasActions([]canvasAction{{
		Tool:   "select_cards",
		Params: map[string]any{"cardIds": "card-a"},
	}}, true)
	if len(issues) > 0 {
		t.Fatalf("unexpected scalar-array issues: %#v", issues)
	}
	cardIDs, ok := actions[0].Params["cardIds"].([]any)
	if !ok || len(cardIDs) != 1 || cardIDs[0] != "card-a" {
		t.Fatalf("cardIds = %#v", actions[0].Params["cardIds"])
	}

	actions, issues = normalizeCanvasActions([]canvasAction{{
		Tool:   "align_cards",
		Params: map[string]any{"card_id": "card-a", "axis": "top"},
	}}, true)
	if len(issues) > 0 {
		t.Fatalf("unexpected align card_id issues: %#v", issues)
	}
	cardIDs, ok = actions[0].Params["cardIds"].([]any)
	if !ok || len(cardIDs) != 1 || cardIDs[0] != "card-a" {
		t.Fatalf("aligned cardIds = %#v", actions[0].Params["cardIds"])
	}

	actions, issues = normalizeCanvasActions([]canvasAction{{
		Tool:   "add_assets_to_canvas",
		Params: map[string]any{"assetIds": "asset-a, asset-b\nasset-c"},
	}}, true)
	if len(issues) > 0 {
		t.Fatalf("unexpected comma-separated assetIds issues: %#v", issues)
	}
	assetIDs, ok := actions[0].Params["assetIds"].([]any)
	if !ok || !reflect.DeepEqual(assetIDs, []any{"asset-a", "asset-b", "asset-c"}) {
		t.Fatalf("assetIds = %#v", actions[0].Params["assetIds"])
	}
}

func TestCanvasActionValidationRejectsMissingAndInvalidArgs(t *testing.T) {
	_, issues := normalizeCanvasActions([]canvasAction{{
		Tool:   "move_card",
		Params: map[string]any{"cardId": "card-a", "x": "120"},
	}}, true)
	if len(issues) != 1 || !strings.Contains(issues[0].Reason, "move_card.y is required") {
		t.Fatalf("missing y issues = %#v", issues)
	}

	_, issues = normalizeCanvasActions([]canvasAction{{
		Tool:   "convert_image",
		Params: map[string]any{"assetId": "asset-a", "outputFormat": "gif"},
	}}, true)
	if len(issues) != 1 || !strings.Contains(issues[0].Reason, "outputFormat") {
		t.Fatalf("invalid enum issues = %#v", issues)
	}
}

func TestCanvasHarnessInvalidArgsTriggerRepairLoop(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"move this card",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("move_card", map[string]any{"cardId": "card-a", "x": "120"}),
		canvasHarnessToolCall("move_card", map[string]any{"cardId": "card-a", "x": "120", "y": "140"}),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "move_card")
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected repair loop to call provider at least twice, got %d", len(requests))
	}
	if !strings.Contains(requests[1].Messages[len(requests[1].Messages)-1].Content, canvasLoopReasonInvalidAction) {
		t.Fatalf("repair prompt missing invalid action reason:\n%s", requests[1].Messages[len(requests[1].Messages)-1].Content)
	}
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if got := requireCanvasHarnessStatNumber(t, firstStat, "invalidActionCount"); got != 1 {
		t.Fatalf("invalidActionCount = %v", got)
	}
	if firstStat["nextReason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("nextReason = %#v", firstStat["nextReason"])
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("second loop reason = %#v", secondStat["reason"])
	}
	if secondStat["repairLoop"] != true {
		t.Fatalf("repairLoop = %#v", secondStat["repairLoop"])
	}
}

func TestCanvasHarnessNormalizedArgsReachFrontendContract(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"select this card",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("select_cards", map[string]any{"card_id": "card-a", "label": "single target"}),
	)
	resultEvent := requireCanvasHarnessEvent(t, events, "action_result", "select_cards")
	result, ok := resultEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("result = %#v", resultEvent["result"])
	}
	cardIDs, ok := result["cardIds"].([]any)
	if !ok || len(cardIDs) != 1 || cardIDs[0] != "card-a" {
		t.Fatalf("normalized cardIds = %#v", result["cardIds"])
	}
}

func TestCanvasHarnessNormalizesImageVariantParams(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"rotate this asset",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("rotate_image", map[string]any{
			"asset_id":       bootstrap.assetA,
			"rotate_degrees": "90",
			"output_format":  "png",
		}),
	)
	resultEvent := requireCanvasHarnessEvent(t, events, "action_result", "rotate_image")
	params, ok := resultEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("result = %#v", resultEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(params["assetIds"]); !reflect.DeepEqual(got, []string{bootstrap.assetA}) {
		t.Fatalf("normalized assetIds = %#v", got)
	}
	if params["degrees"] != float64(90) || params["outputFormat"] != "png" {
		t.Fatalf("normalized image variant params = %#v", params)
	}
	if _, exists := params["rotate_degrees"]; exists {
		t.Fatalf("raw alias leaked into action result params: %#v", params)
	}
}

func TestCanvasHarnessRejectsImageVariantWithoutAssetTargets(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"rotate this asset",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessText(`[action: rotate_image]
description: Rotate an unspecified image.
impact: Creates a rotated variant.
degrees: 90

[action: mirror_image]
description: Mirror an unspecified image.
impact: Creates a mirrored variant.
flip: horizontal`),
		canvasHarnessText("I need asset IDs before creating variants."),
	)

	rejectCanvasHarnessEvent(t, events, "action_result", "rotate_image")
	rejectCanvasHarnessEvent(t, events, "action_result", "mirror_image")
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if stat["nextReason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("nextReason = %#v, want %s", stat["nextReason"], canvasLoopReasonInvalidAction)
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "invalidActionCount"); got != 2 {
		t.Fatalf("invalidActionCount = %v", got)
	}
}

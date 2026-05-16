package server

import (
	"aisets/internal/agent"
	"aisets/internal/config"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestCanvasHarnessAgentActionBlockSupportsUpdateCommentRegion(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	enabled := true
	model := "gpt-fixture"
	backend := "agent:codex"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:     &enabled,
		AgentModel:       &model,
		VLMBackendCanvas: &backend,
	}); err != nil {
		t.Fatal(err)
	}
	agentProvider := &canvasHarnessAgentProvider{result: agent.ChatResult{
		Content:      "```action\n{\"tool\":\"update_comment\",\"params\":{\"commentCardId\":\"comment-a\",\"region\":{\"x\":110,\"y\":80,\"width\":55,\"height\":40},\"visualCue\":{\"targetDescription\":\"small pink target mark\",\"colorHex\":\"#f26aa0\"}},\"description\":\"Correct annotation region\",\"impact\":\"updates the visible annotation marker\"}\n```",
		InputTokens:  7,
		OutputTokens: 5,
	}}
	bootstrap.server.agentProviders["codex"] = agentProvider
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "comment-a")
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"把圈選區域改到真正的目標上。",
		snapshot,
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "update_comment")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("update_comment result = %#v", event["result"])
	}
	region, ok := result["region"].(map[string]any)
	if !ok {
		t.Fatalf("region = %#v", result["region"])
	}
	if region["x"] != 0.5 || region["y"] != 0.5 || region["width"] != 0.25 || region["height"] != 0.25 {
		t.Fatalf("agent action-block region = %#v", region)
	}
	requests := agentProvider.Requests()
	if len(requests) != 1 {
		t.Fatalf("agent requests = %d, want 1", len(requests))
	}
	for _, want := range []string{"update_comment", "create_comment", "capture_selected", "copy_asset"} {
		if !strings.Contains(requests[0].SystemPrompt, want) {
			t.Fatalf("agent action-block prompt missing %s:\n%s", want, requests[0].SystemPrompt)
		}
	}
	if strings.Contains(requests[0].SystemPrompt, "Chinese fallback") {
		t.Fatalf("agent prompt should not mention fallback logic:\n%s", requests[0].SystemPrompt)
	}
}

func TestCanvasHarnessAgentRepairsTextOnlyFalseCompletionForAnnotation(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	enabled := true
	model := "gpt-fixture"
	backend := "agent:codex"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:     &enabled,
		AgentModel:       &model,
		VLMBackendCanvas: &backend,
	}); err != nil {
		t.Fatal(err)
	}
	agentProvider := &canvasHarnessAgentProvider{results: []agent.ChatResult{
		{
			Content:      "Already circled it and added a comment. The peach is on the headband.",
			InputTokens:  7,
			OutputTokens: 5,
		},
		{
			Content: `[action: create_comment]
description: Add peach marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The peach is on the headband.
regionX: 0.29
regionY: 0.19
regionWidth: 0.11
regionHeight: 0.08
visualCueTargetDescription: small pink peach icon
visualCueColorHex: #f26aa0`,
			InputTokens:  8,
			OutputTokens: 6,
		},
	}}
	bootstrap.server.agentProviders["codex"] = agentProvider
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Where is the peach in this image? Circle it and add a comment.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	requests := agentProvider.Requests()
	if len(requests) < 2 {
		t.Fatalf("agent requests = %d, want repair request", len(requests))
	}
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonTextOnlyDeferredWork {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	if !strings.Contains(requests[0].SystemPrompt, "[action: create_comment]") || !strings.Contains(requests[0].SystemPrompt, "regionX") {
		t.Fatalf("agent prompt missing bracket region format:\n%s", requests[0].SystemPrompt)
	}
	if !strings.Contains(requests[1].Prompt, "Reply with only tool calls or action blocks") {
		t.Fatalf("repair prompt missing action-only instruction:\n%s", requests[1].Prompt)
	}
}

func TestCanvasHarnessAgentRepairsOCRTextWorkflowIntoComments(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writeCanvasRedTextWithWhiteDistractorPNG(t, filepath.Join(bootstrap.root, "img", "a.png"))
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
	})
	enabled := true
	model := "gpt-fixture"
	backend := "agent:codex"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:     &enabled,
		AgentModel:       &model,
		VLMBackendCanvas: &backend,
	}); err != nil {
		t.Fatal(err)
	}
	agentProvider := &canvasHarnessAgentProvider{results: []agent.ChatResult{
		{
			Content: `[action: search_assets]
description: Find text-bearing assets.
impact: Returns assets with readable OCR text.
q:
limit: 12
hasText: true`,
			InputTokens:  7,
			OutputTokens: 5,
		},
		{
			Content: fmt.Sprintf(`[action: add_assets_to_canvas]
description: Add the text-bearing asset.
impact: Shows the asset on the canvas.
assetIds: %s`, bootstrap.assetA),
			InputTokens:  8,
			OutputTokens: 6,
		},
		{
			Content: fmt.Sprintf(`[action: extract_ocr_text]
description: Extract OCR text before annotating.
impact: Returns OCR text for follow-up annotations.
assetIds: %s
mode: vlm
saveToMetadata: false`, bootstrap.assetA),
			InputTokens:  9,
			OutputTokens: 7,
		},
		{
			Content: fmt.Sprintf(`[action: create_comment]
description: Annotate the visible OCR text.
impact: Adds a pinned text comment.
anchorCardId: %s
text: SALE
regionX: 0.1
regionY: 0.2
regionWidth: 0.2
regionHeight: 0.1
visualCueTargetDescription: white text characters
visualCueColorHex: #ffffff`, bootstrap.assetA),
			InputTokens:  10,
			OutputTokens: 8,
		},
	}}
	bootstrap.server.agentProviders["codex"] = agentProvider
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly on the canvas, and annotate the text area with what it says.",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "extract_ocr_text", "create_comment")
	event := requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("comment result = %#v", event["result"])
	}
	region, ok := canvasRegionFromValue(result["region"])
	if !ok {
		t.Fatalf("region = %#v", result["region"])
	}
	if canvasRegionLooksGenericPlaceholder(region) || region.Y > 0.25 {
		t.Fatalf("agent OCR text region was not refined: %#v", result["region"])
	}
	requests := agentProvider.Requests()
	if len(requests) < 4 {
		t.Fatalf("agent requests = %d, want OCR annotation loop", len(requests))
	}
	if !strings.Contains(requests[0].SystemPrompt, "[action: create_comment]") || strings.Contains(requests[0].SystemPrompt, "bare JSON") == false {
		t.Fatalf("agent prompt missing strict bracket action format:\n%s", requests[0].SystemPrompt)
	}
	if !strings.Contains(requests[3].Prompt, "ocr_text_annotation") || !strings.Contains(requests[3].Prompt, "Reply with only tool calls or action blocks") {
		t.Fatalf("agent OCR annotation repair prompt missing action-only instruction:\n%s", requests[3].Prompt)
	}
}

func TestCanvasHarnessAgentFillsCopyProposalDestPathsFromOCR(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writeCanvasRedTextWithWhiteDistractorPNG(t, filepath.Join(bootstrap.root, "img", "a.png"))
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE/50",
	})
	enabled := true
	model := "gpt-fixture"
	backend := "agent:codex"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:     &enabled,
		AgentModel:       &model,
		VLMBackendCanvas: &backend,
	}); err != nil {
		t.Fatal(err)
	}
	agentProvider := &canvasHarnessAgentProvider{results: []agent.ChatResult{
		{
			Content: `[action: search_assets]
description: Find text-bearing assets.
impact: Returns assets with readable OCR text.
q:
limit: 12
hasText: true`,
		},
		{
			Content: fmt.Sprintf(`[action: add_assets_to_canvas]
description: Add the text-bearing asset.
impact: Shows the asset on the canvas.
assetIds: %s`, bootstrap.assetA),
		},
		{
			Content: fmt.Sprintf(`[action: extract_ocr_text]
description: Extract OCR text before annotating.
impact: Returns OCR text for follow-up annotations.
assetIds: %s
mode: vlm
saveToMetadata: false`, bootstrap.assetA),
		},
		{
			Content: fmt.Sprintf(`[action: create_comment]
description: Annotate the visible OCR text.
impact: Adds a pinned text comment.
anchorCardId: %s
text: SALE/50
regionX: 0.1
regionY: 0.2
regionWidth: 0.2
regionHeight: 0.1
visualCueTargetDescription: white text characters
visualCueColorHex: #ffffff

[action: copy_asset]
description: Copy the text-bearing file.
impact: Creates a proposal using OCR text as the filename.
assetIds: %s`, bootstrap.assetA, bootstrap.assetA),
		},
	}}
	bootstrap.server.agentProviders["codex"] = agentProvider
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly, annotate the text area, then copy each file using the text content as the filename.",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "extract_ocr_text", "create_comment")
	proposal := requireCanvasHarnessEvent(t, events, "proposal", "copy_asset")
	targetIDs := canvasHarnessEventStringSlice(proposal["targetAssetIds"])
	if !reflect.DeepEqual(targetIDs, []string{bootstrap.assetA}) {
		t.Fatalf("copy proposal targetAssetIds = %#v", targetIDs)
	}
	params, ok := proposal["params"].(map[string]any)
	if !ok {
		t.Fatalf("proposal params = %#v", proposal["params"])
	}
	rows, ok := params["perAssetDestPaths"].([]any)
	if !ok || len(rows) != 1 {
		t.Fatalf("perAssetDestPaths = %#v", params["perAssetDestPaths"])
	}
	row, ok := rows[0].(map[string]any)
	if !ok || row["destPath"] != "SALE_50.png" {
		t.Fatalf("perAssetDestPaths row = %#v", rows[0])
	}
	rejectCanvasHarnessEvent(t, events, "action_result", "copy_asset")
}

func TestCanvasHarnessAgentRepairsImageRegionActionWithoutVisualCue(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	enabled := true
	model := "gpt-fixture"
	backend := "agent:codex"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{
		AgentEnabled:     &enabled,
		AgentModel:       &model,
		VLMBackendCanvas: &backend,
	}); err != nil {
		t.Fatal(err)
	}
	agentProvider := &canvasHarnessAgentProvider{results: []agent.ChatResult{
		{
			Content: `[action: create_comment]
description: Add peach marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The peach is on the headband.
regionX: 0.38
regionY: 0.28
regionWidth: 0.16
regionHeight: 0.17`,
			InputTokens:  7,
			OutputTokens: 5,
		},
		{
			Content: `[action: create_comment]
description: Add peach marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The peach is on the headband.
regionX: 0.29
regionY: 0.19
regionWidth: 0.11
regionHeight: 0.08
visualCueTargetDescription: small pink peach icon
visualCueColorHex: #f26aa0`,
			InputTokens:  8,
			OutputTokens: 6,
		},
	}}
	bootstrap.server.agentProviders["codex"] = agentProvider
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Where is the peach in this image? Circle it and add a comment.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
	)
	commentResults := 0
	for _, event := range events {
		if event["type"] != "action_result" || event["tool"] != "create_comment" {
			continue
		}
		commentResults++
		result := event["result"].(map[string]any)
		region := result["region"].(map[string]any)
		if region["x"] == 0.38 && region["y"] == 0.28 {
			t.Fatalf("missing-visualCue region should have been blocked before execution: %#v", result)
		}
	}
	if commentResults != 1 {
		t.Fatalf("create_comment results = %d, want only repaired action in %#v", commentResults, events)
	}
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	requests := agentProvider.Requests()
	if len(requests) < 2 {
		t.Fatalf("agent requests = %d, want repair request", len(requests))
	}
	if !strings.Contains(requests[1].Prompt, "visualCue.targetDescription") || !strings.Contains(requests[1].Prompt, "visualCue.colorHex") {
		t.Fatalf("repair prompt missing visualCue issue:\n%s", requests[1].Prompt)
	}
}

func TestCanvasHarnessDedupesFallbackTextCommentsForSameRegion(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Asset.OcrText = "日本一"
	events, _ := runCanvasToolUseHarness(
		t,
		"Circle the peach and the visible text, then explain both in comments.",
		snapshot,
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
visualCueColorHex: #f26aa0

[action: create_comment]
description: Add first text marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The visible text reads 日本一; this is the first character.
regionX: 0.70
regionY: 0.06
regionWidth: 0.24
regionHeight: 0.47
visualCueTargetDescription: white text characters
visualCueColorHex: #ffffff

[action: create_comment]
description: Add second text marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The visible text reads 日本一; this is the second character.
regionX: 0.70
regionY: 0.06
regionWidth: 0.24
regionHeight: 0.47
visualCueTargetDescription: white text characters
visualCueColorHex: #ffffff

[action: create_comment]
description: Add last text marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: The visible text reads 日本一; this is the last character.
regionX: 0.70
regionY: 0.06
regionWidth: 0.24
regionHeight: 0.47
visualCueTargetDescription: white text characters
visualCueColorHex: #ffffff`),
	)
	commentResults := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "create_comment" {
			commentResults++
		}
	}
	if commentResults != 2 {
		t.Fatalf("create_comment results = %d, want peach plus one text comment in %#v", commentResults, events)
	}
	requireCanvasHarnessToolEventOrder(t, events, "create_comment", "create_comment")
}

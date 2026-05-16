package server

import (
	"aisets/internal/llm"
	"fmt"
	"strings"
	"testing"
)

func TestCanvasHarnessPhotoStagingArrangesAndCaptures(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
		canvasHarnessToolCall("inspect_canvas", map[string]any{"reason": "Check composition, spacing, and focal balance before staging all visible images."}),
		canvasHarnessToolCall("resize_card", map[string]any{"cardId": "card-a", "width": float64(320)}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
			map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
		}}),
		canvasHarnessToolCall("capture_canvas", map[string]any{"transparent": false}),
		canvasHarnessText("Done."),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"請你像專業攝影師一樣幫我把畫布上的所有圖片擺拍得漂亮一點，最後幫我截圖。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
	)

	requireCanvasHarnessToolEventOrder(t, events, "inspect_canvas", "resize_card", "arrange_cards", "capture_canvas")
	arrangeEvent := requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	arrangeResult, ok := arrangeEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("arrange result = %#v", arrangeEvent["result"])
	}
	positions, ok := arrangeResult["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("photo staging should arrange both visible image cards, positions = %#v", arrangeResult["positions"])
	}
	captureEvent := requireCanvasHarnessEvent(t, events, "action_result", "capture_canvas")
	captureResult, ok := captureEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("capture result = %#v", captureEvent["result"])
	}
	if captureResult["transparent"] != false {
		t.Fatalf("capture should keep normal background unless requested transparent: %#v", captureResult)
	}
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if skills, ok := stat["selectedSkillIds"].([]any); !ok || !canvasHarnessAnyString(skills, canvasSkillPhotoStaging) {
		t.Fatalf("selectedSkillIds = %#v, missing %s", stat["selectedSkillIds"], canvasSkillPhotoStaging)
	}
}

func TestCanvasHarnessPhotoStagingMovesFromInspectToLayoutBeforeCapture(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("inspect_canvas", map[string]any{"reason": "Assess the current layout before staging."}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
			map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
		}}),
		canvasHarnessToolCall("capture_canvas", map[string]any{"transparent": false}),
		canvasHarnessText("擺拍理念是以畢業合照作為主題，使用主視覺與輔助圖片建立層次，並用留白和水平動線讓畫面更穩定。"),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"請像專業攝影師與美術指導一樣，將畫布上所有可見圖片擺成一個精緻構圖，保留平衡間距、主視覺與輔助圖片的比例，以及清楚的視覺動線，然後截取擺拍後的畫布。截圖完成後，請回覆擺拍理念與理由。\n擺拍風格: 學校畢業",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		[]string{canvasSkillPhotoStaging},
	)

	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("first loop nextReason = %#v, want %s", firstStat["nextReason"], canvasLoopReasonFocusOnlyNeedsAnswer)
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("second loop reason = %#v, want %s", secondStat["reason"], canvasLoopReasonFocusOnlyNeedsAnswer)
	}
	requireCanvasHarnessToolEventOrder(t, events, "inspect_canvas", "arrange_cards", "capture_canvas")
	var finalText string
	for _, event := range events {
		if event["type"] == "text" {
			finalText += fmt.Sprint(event["content"])
		}
	}
	if !strings.Contains(finalText, "Completed the staged layout") || !strings.Contains(finalText, "screenshot") {
		t.Fatalf("missing staging rationale text: %q", finalText)
	}
	requests := bootstrap.provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected photo staging follow-up prompt, got %d requests", len(requests))
	}
	followupPrompt := requests[1].Messages[len(requests[1].Messages)-1].Content
	for _, want := range []string{
		"professional photographer and art director",
		"requested style direction",
		"rigid equal-size grid",
		"mirror_image or rotate_image",
		"any integer-degree angle",
		"bring_cards_to_front",
		"z-index",
	} {
		if !strings.Contains(followupPrompt, want) {
			t.Fatalf("photo staging follow-up prompt missing %q:\n%s", want, followupPrompt)
		}
	}
}

func TestCanvasPhotoStagingPromptStaysCompactForLocalLLM(t *testing.T) {
	canvas := canvasHarnessSnapshotWithManyImages("asset-a", "asset-b", 20)
	prompt := buildCanvasUserPrompt(
		[]canvasChatMessage{{Role: "user", Content: "Stage all images like a Japanese lifestyle breakfast-table magazine cover, then capture the result."}},
		canvas,
		canvasChatOptions{CanvasImageAttached: true, PhotoStagingWorkflow: true},
		"en",
	)
	if len(prompt) > 12000 {
		t.Fatalf("photo staging user prompt too large for local LLMs: len=%d\n%s", len(prompt), prompt)
	}
	for _, want := range []string{
		"Photo Staging Cards JSON",
		"card-19",
		"resize_card",
		"mirror_image",
		"rotate_image",
		"bring_cards_to_front",
		"z-index",
		"rigid equal-size grid",
		"do not use transforms merely to show capability",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("photo staging prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, forbidden := range []string{
		"AI-Readable Canvas Cards JSON",
		"thumbnailUrl",
		"visual.url",
		"\"visual\"",
		"\"asset\":",
		"usedBy",
		"Image optimization advice is OFF",
	} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("photo staging prompt should stay compact and omit %q:\n%s", forbidden, prompt)
		}
	}

	followup := buildCanvasFollowupPrompt(
		canvasLoopReasonFocusOnlyNeedsAnswer,
		"Stage all images like a Japanese lifestyle breakfast-table magazine cover, then capture the result.",
		canvas,
		nil,
		nil,
		[]string{"inspect_canvas"},
		"",
		true,
	)
	if len(followup) > 10000 {
		t.Fatalf("photo staging follow-up prompt too large for local LLMs: len=%d\n%s", len(followup), followup)
	}
	if strings.Contains(followup, "thumbnailUrl") || strings.Contains(followup, "\"visual\"") || strings.Contains(followup, "\"asset\":") {
		t.Fatalf("photo staging follow-up prompt should use compact card JSON:\n%s", followup)
	}
	if !strings.Contains(followup, "Aesthetic staging matters more than demonstrating every available tool") ||
		!strings.Contains(followup, "Use mirror_image or rotate_image only for a small number of deliberate PNG variants") ||
		!strings.Contains(followup, "any integer-degree angle") {
		t.Fatalf("photo staging follow-up prompt missing creative transform guidance:\n%s", followup)
	}
}

func TestCanvasHarnessPhotoStagingRejectsPartialLayoutBeforeCapture(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("inspect_canvas", map[string]any{"reason": "Assess all visible images before staging."}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
			map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
		}}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
			map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
			map[string]any{"cardId": "card-c", "x": float64(840), "y": float64(80)},
		}}),
		canvasHarnessToolCall("capture_canvas", map[string]any{"transparent": false}),
		canvasHarnessText("擺拍理念是把所有可見圖片納入同一個動物森友會式的島嶼合照構圖。"),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"請像專業攝影師與美術指導一樣，將畫布上所有可見圖片擺成一個精緻構圖，保留平衡間距、主視覺與輔助圖片的比例，以及清楚的視覺動線，然後截取擺拍後的畫布。截圖完成後，請回覆擺拍理念與理由。\n擺拍風格: 集合啦動物森友會",
		canvasHarnessSnapshotWithThirdImage(bootstrap.assetA, bootstrap.assetB),
		[]string{canvasSkillPhotoStaging},
	)

	partialStat := requireCanvasHarnessLoopStat(t, events, 1)
	if partialStat["nextReason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("partial layout nextReason = %#v, want %s", partialStat["nextReason"], canvasLoopReasonInvalidAction)
	}
	requireCanvasHarnessToolEventOrder(t, events, "inspect_canvas", "arrange_cards", "capture_canvas")
	arrangeEvent := requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	arrangeResult, ok := arrangeEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("arrange result = %#v", arrangeEvent["result"])
	}
	positions, ok := arrangeResult["positions"].([]any)
	if !ok || len(positions) != 3 {
		t.Fatalf("photo staging should repair to arrange all visible image cards, positions = %#v", arrangeResult["positions"])
	}
}

func TestCanvasHarnessPhotoStagingDefersCaptureUntilAfterStaging(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("capture_canvas", map[string]any{"transparent": false}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
			map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
		}}),
		canvasHarnessToolCall("capture_canvas", map[string]any{"transparent": false}),
		canvasHarnessText("The staging concept uses one hero image, a supporting image, balanced spacing, and a clear visual flow for the requested birthday family portrait style."),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"請把畫布上的圖片擺拍成生日家族合照風格，最後截圖，並說明擺拍理念。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		[]string{canvasSkillPhotoStaging},
	)

	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if stat["nextReason"] != canvasLoopReasonCaptureOnlyWork {
		t.Fatalf("first loop nextReason = %#v, want %s", stat["nextReason"], canvasLoopReasonCaptureOnlyWork)
	}
	seenArrange := false
	captureCount := 0
	for _, event := range events {
		if event["type"] != "action_result" {
			continue
		}
		switch event["tool"] {
		case "arrange_cards":
			seenArrange = true
		case "capture_canvas":
			if !seenArrange {
				t.Fatalf("capture_canvas ran before staging work: %#v", events)
			}
			captureCount++
		}
	}
	if captureCount != 1 {
		t.Fatalf("capture_canvas count = %d, events = %#v", captureCount, events)
	}
	requireCanvasHarnessToolEventOrder(t, events, "arrange_cards", "capture_canvas")
	var finalText string
	for _, event := range events {
		if event["type"] == "text" {
			finalText += fmt.Sprint(event["content"])
		}
	}
	if !strings.Contains(finalText, "Completed the staged layout") || !strings.Contains(finalText, "screenshot") {
		t.Fatalf("missing staging rationale text: %q", finalText)
	}
}

func TestCanvasHarnessPhotoStagingRejectsCaptureAfterOnlyTransformsAndLayering(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "select_cards", Arguments: map[string]any{"cardIds": []any{"card-a", "card-b"}}},
			llm.ChatToolCall{Name: "rotate_image", Arguments: map[string]any{"assetIds": []any{bootstrap.assetA}, "degrees": float64(90), "outputFormat": "png"}},
			llm.ChatToolCall{Name: "mirror_image", Arguments: map[string]any{"assetIds": []any{bootstrap.assetB}, "flip": "horizontal", "outputFormat": "png"}},
			llm.ChatToolCall{Name: "bring_cards_to_front", Arguments: map[string]any{"cardIds": []any{"card-a", "card-b"}}},
			llm.ChatToolCall{Name: "capture_canvas", Arguments: map[string]any{"transparent": false}},
		),
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "arrange_cards", Arguments: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
				map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
			}}},
			llm.ChatToolCall{Name: "capture_canvas", Arguments: map[string]any{"transparent": false}},
		),
		canvasHarnessText("The staging concept uses deliberate transforms as accents, then relies on the actual arrangement before capture."),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"Stage every visible image like a vintage cafe editorial cover, optionally using rotation, mirroring, and z-index when they help, then capture and explain the staging concept.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		[]string{canvasSkillPhotoStaging},
	)

	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonCaptureOnlyWork {
		t.Fatalf("first loop nextReason = %#v, want %s", firstStat["nextReason"], canvasLoopReasonCaptureOnlyWork)
	}
	seenArrange := false
	captureCount := 0
	for _, event := range events {
		if event["type"] != "action_result" {
			continue
		}
		switch event["tool"] {
		case "arrange_cards":
			seenArrange = true
		case "capture_canvas":
			if !seenArrange {
				t.Fatalf("capture_canvas ran before actual layout work: %#v", events)
			}
			captureCount++
		}
	}
	if captureCount != 1 {
		t.Fatalf("capture_canvas count = %d, events = %#v", captureCount, events)
	}
	requireCanvasHarnessToolEventOrder(t, events, "rotate_image", "mirror_image", "bring_cards_to_front", "arrange_cards", "capture_canvas")
}

func TestCanvasHarnessPhotoStagingBlocksCaptureWhenSameLoopHasInvalidActions(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "inspect_canvas", Arguments: map[string]any{}},
			llm.ChatToolCall{Name: "resize_card", Arguments: map[string]any{"width": float64(360)}},
			llm.ChatToolCall{Name: "rotate_image", Arguments: map[string]any{"degrees": float64(90), "outputFormat": "png"}},
			llm.ChatToolCall{Name: "select_cards", Arguments: map[string]any{"cardIds": []any{"card-a", "card-b"}}},
			llm.ChatToolCall{Name: "arrange_cards", Arguments: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-a", "x": float64(80), "y": float64(80)},
				map[string]any{"cardId": "card-b", "x": float64(460), "y": float64(140)},
			}}},
			llm.ChatToolCall{Name: "capture_canvas", Arguments: map[string]any{"transparent": false}},
		),
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "resize_card", Arguments: map[string]any{"cardId": "card-a", "width": float64(340)}},
			llm.ChatToolCall{Name: "arrange_cards", Arguments: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-a", "x": float64(120), "y": float64(110)},
				map[string]any{"cardId": "card-b", "x": float64(520), "y": float64(180)},
			}}},
			llm.ChatToolCall{Name: "capture_canvas", Arguments: map[string]any{"transparent": false}},
		),
		canvasHarnessText("The staging concept uses a hero image, a supporting image, and deliberate spacing before the final screenshot."),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"Stage every visible image like a vintage toy-store magazine spread, use scale and light layering only when useful, then capture and explain the staging concept.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		[]string{canvasSkillPhotoStaging},
	)

	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonInvalidAction {
		t.Fatalf("first loop nextReason = %#v, want %s", firstStat["nextReason"], canvasLoopReasonInvalidAction)
	}
	arrangeCount := 0
	captureCount := 0
	for _, event := range events {
		if event["type"] != "action_result" {
			continue
		}
		switch event["tool"] {
		case "arrange_cards":
			arrangeCount++
		case "capture_canvas":
			if arrangeCount < 1 {
				t.Fatalf("capture_canvas ran before invalid staging calls were repaired: %#v", events)
			}
			captureCount++
		}
	}
	if arrangeCount != 1 {
		t.Fatalf("arrange_cards count = %d, want only the repaired layout; events = %#v", arrangeCount, events)
	}
	if captureCount != 1 {
		t.Fatalf("capture_canvas count = %d, events = %#v", captureCount, events)
	}
}

func TestCanvasHarnessPhotoStagingStopsAfterCapture(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "resize_card", Arguments: map[string]any{"cardId": "card-a", "width": float64(340)}},
			llm.ChatToolCall{Name: "arrange_cards", Arguments: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-a", "x": float64(120), "y": float64(110)},
				map[string]any{"cardId": "card-b", "x": float64(520), "y": float64(180)},
			}}},
			llm.ChatToolCall{Name: "capture_canvas", Arguments: map[string]any{"transparent": false}},
		),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(4000), "y": float64(4000)},
			map[string]any{"cardId": "card-b", "x": float64(4500), "y": float64(4000)},
		}}),
	}

	events := runCanvasToolUseHarnessWithHarnessAndSkills(
		t,
		bootstrap,
		"Stage every visible image like a relaxed family birthday photo, then capture and explain the staging concept.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		[]string{canvasSkillPhotoStaging},
	)

	arrangeCount := 0
	captureCount := 0
	var finalText string
	for _, event := range events {
		switch event["type"] {
		case "action_result":
			switch event["tool"] {
			case "arrange_cards":
				arrangeCount++
			case "capture_canvas":
				captureCount++
			}
		case "text":
			finalText += fmt.Sprint(event["content"])
		}
	}
	if arrangeCount != 1 {
		t.Fatalf("arrange_cards count = %d, want 1; events = %#v", arrangeCount, events)
	}
	if captureCount != 1 {
		t.Fatalf("capture_canvas count = %d, events = %#v", captureCount, events)
	}
	if strings.TrimSpace(finalText) == "" {
		t.Fatalf("missing final photo-staging rationale text: %#v", events)
	}
	requests := bootstrap.provider.Requests()
	if len(requests) != 1 {
		t.Fatalf("photo staging should stop after capture instead of asking for more layout, requests = %d", len(requests))
	}
}

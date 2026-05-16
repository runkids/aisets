package server

import (
	"aisets/internal/llm"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestCanvasHarnessAdvancedTextAssetsAnnotateAndCopyProposal(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
		bootstrap.assetB: "LOGO",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "", "limit": float64(18), "hasText": true}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA, bootstrap.assetB}}),
		canvasHarnessToolCall("arrange_cards", map[string]any{"positions": []any{
			map[string]any{"cardId": bootstrap.assetA, "x": float64(120), "y": float64(160)},
			map[string]any{"cardId": bootstrap.assetB, "x": float64(460), "y": float64(160)},
		}}),
		canvasHarnessToolCalls(
			llm.ChatToolCall{
				Name: "create_comment",
				Arguments: map[string]any{
					"anchorCardId": bootstrap.assetA,
					"text":         "Text reads: SALE",
					"region":       map[string]any{"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.25},
				},
			},
			llm.ChatToolCall{
				Name: "create_comment",
				Arguments: map[string]any{
					"anchorCardId": bootstrap.assetB,
					"text":         "Text reads: LOGO",
					"region":       map[string]any{"x": 0.25, "y": 0.25, "width": 0.45, "height": 0.25},
				},
			},
			llm.ChatToolCall{
				Name: "copy_asset",
				Arguments: map[string]any{
					"assetIds": []any{bootstrap.assetA, bootstrap.assetB},
					"perAssetDestPaths": []any{
						map[string]any{"assetId": bootstrap.assetA, "destPath": "exports/SALE.png"},
						map[string]any{"assetId": bootstrap.assetB, "destPath": "exports/LOGO.png"},
					},
				},
			},
		),
		canvasHarnessToolCall("duplicate_cards", map[string]any{"cardIds": []any{"card-a"}, "count": float64(1)}),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"請幫我把所有有文字的圖展示出來，且要平均擺放在畫布上，並用註解把文字的地方圈起來說明他寫了什麼，然後最後把這些檔案複製一份後用文字內容作為檔名",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "arrange_cards", "create_comment", "create_comment")

	searchEvent := requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	searchResult, ok := searchEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("search result = %#v", searchEvent["result"])
	}
	items, ok := searchResult["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("search items = %#v", searchResult["items"])
	}

	proposal := requireCanvasHarnessEvent(t, events, "proposal", "copy_asset")
	targetIDs := canvasHarnessEventStringSlice(proposal["targetAssetIds"])
	if !reflect.DeepEqual(targetIDs, []string{bootstrap.assetA, bootstrap.assetB}) {
		t.Fatalf("copy proposal targetAssetIds = %#v", targetIDs)
	}
	params, ok := proposal["params"].(map[string]any)
	if !ok {
		t.Fatalf("proposal params = %#v", proposal["params"])
	}
	rows, ok := params["perAssetDestPaths"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatalf("perAssetDestPaths = %#v", params["perAssetDestPaths"])
	}
	rejectCanvasHarnessEvent(t, events, "action_result", "copy_asset")
}

func TestCanvasHarnessOCRAnnotationRoundAllowsCopyProposal(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "text", "limit": float64(12)}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA}}),
		canvasHarnessToolCall("extract_ocr_text", map[string]any{"assetIds": []any{bootstrap.assetA}, "mode": "vlm", "saveToMetadata": false}),
		canvasHarnessToolCalls(
			llm.ChatToolCall{
				Name: "create_comment",
				Arguments: map[string]any{
					"anchorCardId": bootstrap.assetA,
					"text":         "SALE",
					"region":       map[string]any{"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.25},
					"visualCue": map[string]any{
						"targetDescription": "text characters",
						"colorHex":          "#ffffff",
					},
				},
			},
			llm.ChatToolCall{
				Name: "copy_asset",
				Arguments: map[string]any{
					"assetIds": []any{bootstrap.assetA},
					"perAssetDestPaths": []any{
						map[string]any{"assetId": bootstrap.assetA, "destPath": "exports/SALE.png"},
					},
				},
			},
		),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, annotate the text area with what it says, then copy each file using the text content as the filename.",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "extract_ocr_text", "create_comment")
	proposal := requireCanvasHarnessEvent(t, events, "proposal", "copy_asset")
	targetIDs := canvasHarnessEventStringSlice(proposal["targetAssetIds"])
	if !reflect.DeepEqual(targetIDs, []string{bootstrap.assetA}) {
		t.Fatalf("copy proposal targetAssetIds = %#v", targetIDs)
	}
	rejectCanvasHarnessEvent(t, events, "action_result", "copy_asset")
	rejectCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
}

func TestCanvasHarnessRepairsOCRTextWorkflowIntoComments(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
		bootstrap.assetB: "",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "", "limit": float64(18), "hasText": true}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA}}),
		canvasHarnessToolCall("extract_ocr_text", map[string]any{"assetIds": []any{bootstrap.assetA}, "mode": "vlm", "saveToMetadata": false}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "Text reads: SALE",
			"region":       map[string]any{"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.25},
			"visualCue": map[string]any{
				"targetDescription": "white text characters",
				"colorHex":          "#ffffff",
			},
		}),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly on the canvas, and annotate the text area with what it says.",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "extract_ocr_text", "create_comment")

	searchEvent := requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	searchResult, ok := searchEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("search result = %#v", searchEvent["result"])
	}
	items, ok := searchResult["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("text search should exclude empty OCR before limit, items = %#v", searchResult["items"])
	}

	ocrEvent := requireCanvasHarnessEvent(t, events, "action_result", "extract_ocr_text")
	ocrResult, ok := ocrEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("OCR result = %#v", ocrEvent["result"])
	}
	if ocrResult["displayToUser"] != false {
		t.Fatalf("OCR intermediate result should be hidden from final chat: %#v", ocrResult)
	}
	addStat := requireCanvasHarnessLoopStat(t, events, 1)
	if addStat["nextReason"] != canvasLoopReasonOCRTextExtraction {
		t.Fatalf("post-add loop nextReason = %#v", addStat["nextReason"])
	}
	stat := requireCanvasHarnessLoopStat(t, events, 2)
	if stat["nextReason"] != canvasLoopReasonOCRTextAnnotation {
		t.Fatalf("OCR loop nextReason = %#v", stat["nextReason"])
	}
	requests := bootstrap.provider.Requests()
	if len(requests) < 4 {
		t.Fatalf("provider requests = %d, want OCR annotation repair request", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[2], "required")
	requireCanvasHarnessRequestTools(t, requests[2], "extract_ocr_text")
	requireCanvasHarnessToolChoice(t, requests[3], "required")
	requireCanvasHarnessRequestTools(t, requests[3], "create_comment", "remove_cards", "arrange_cards")
	requireCanvasHarnessToolRequiredParams(t, requests[3], "create_comment", "anchorCardId", "text", "region", "visualCue")
}

func TestCanvasHarnessRejectsOCRTextCommentWithoutRegion(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "text", "limit": float64(12)}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA}}),
		canvasHarnessToolCall("extract_ocr_text", map[string]any{"assetIds": []any{bootstrap.assetA}, "mode": "vlm", "saveToMetadata": false}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "Text reads: SALE",
		}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "Text reads: SALE",
			"region":       map[string]any{"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.25},
			"visualCue": map[string]any{
				"targetDescription": "white text characters",
				"colorHex":          "#ffffff",
			},
		}),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly on the canvas, and annotate the text area with what it says.",
		canvasSnapshot{},
	)
	requireCanvasHarnessToolEventOrder(t, events, "search_assets", "add_assets_to_canvas", "extract_ocr_text", "create_comment")
	commentEvents := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "create_comment" {
			commentEvents++
			result, _ := event["result"].(map[string]any)
			if result["region"] == nil {
				t.Fatalf("region-less OCR text comment should not execute: %#v", result)
			}
		}
	}
	if commentEvents != 1 {
		t.Fatalf("executed create_comment count = %d, want 1", commentEvents)
	}
	stat := requireCanvasHarnessLoopStat(t, events, 3)
	if stat["nextReason"] != canvasLoopReasonOCRTextAnnotation {
		t.Fatalf("region-less OCR text comment nextReason = %#v", stat["nextReason"])
	}
}

func TestCanvasHarnessRefinesOCRTextCommentFromGenericPlaceholder(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writeCanvasRedTextWithWhiteDistractorPNG(t, filepath.Join(bootstrap.root, "img", "a.png"))
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "text", "limit": float64(12)}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA}}),
		canvasHarnessToolCall("extract_ocr_text", map[string]any{"assetIds": []any{bootstrap.assetA}, "mode": "vlm", "saveToMetadata": false}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "SALE",
			"region":       map[string]any{"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.1},
			"visualCue": map[string]any{
				"targetDescription": "white text characters",
				"colorHex":          "#ffffff",
			},
		}),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly on the canvas, and annotate the text area with what it says.",
		canvasSnapshot{},
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("comment result = %#v", event["result"])
	}
	rawRegion, ok := result["region"].(map[string]any)
	if !ok {
		t.Fatalf("region = %#v", result["region"])
	}
	region, ok := canvasRegionFromValue(rawRegion)
	if !ok {
		t.Fatalf("region parse failed: %#v", rawRegion)
	}
	if canvasRegionLooksGenericPlaceholder(region) || region.Y > 0.25 || region.Width < 0.35 {
		t.Fatalf("generic OCR text placeholder was not refined to the red title: %#v", rawRegion)
	}
}

func TestCanvasHarnessRejectsGenericOCRTextPlaceholderAfterFailedRefinement(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "text", "limit": float64(12)}),
		canvasHarnessToolCall("add_assets_to_canvas", map[string]any{"assetIds": []any{bootstrap.assetA}}),
		canvasHarnessToolCall("extract_ocr_text", map[string]any{"assetIds": []any{bootstrap.assetA}, "mode": "vlm", "saveToMetadata": false}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "SALE",
			"region":       map[string]any{"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.1},
			"visualCue": map[string]any{
				"targetDescription": "white text characters",
				"colorHex":          "#ffffff",
			},
		}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "SALE",
			"region":       map[string]any{"x": 0.3, "y": 0.15, "width": 0.35, "height": 0.18},
			"visualCue": map[string]any{
				"targetDescription": "text characters",
				"colorHex":          "#d62622",
			},
		}),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show every image that contains visible text, arrange them evenly on the canvas, and annotate the text area with what it says.",
		canvasSnapshot{},
	)
	commentEvents := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "create_comment" {
			commentEvents++
			result, _ := event["result"].(map[string]any)
			region, _ := canvasRegionFromValue(result["region"])
			if canvasRegionLooksGenericPlaceholder(region) {
				t.Fatalf("generic OCR text placeholder should not execute: %#v", result)
			}
		}
	}
	if commentEvents != 1 {
		t.Fatalf("executed create_comment count = %d, want 1", commentEvents)
	}
	stat := requireCanvasHarnessLoopStat(t, events, 3)
	if stat["nextReason"] != canvasLoopReasonIncompleteTextAnnotation {
		t.Fatalf("generic placeholder nextReason = %#v", stat["nextReason"])
	}
}

func TestCanvasHarnessNativeToolResultsCanContinueLayoutChain(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"把目前選取的所有卡片平均水平排列，並讓上緣對齊。",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
		canvasHarnessToolCall("select_cards", map[string]any{"cardIds": []any{"card-a", "card-b"}}),
		canvasHarnessToolCall("distribute_cards", map[string]any{"cardIds": []any{"card-a", "card-b"}, "direction": "horizontal", "gap": float64(80)}),
		canvasHarnessToolCall("align_cards", map[string]any{"cardIds": []any{"card-a", "card-b"}, "axis": "top"}),
		canvasHarnessText("Done."),
	)
	requireCanvasHarnessToolEventOrder(t, events, "select_cards", "distribute_cards", "align_cards")

	requests := provider.Requests()
	if len(requests) < 3 {
		t.Fatalf("expected native tool-result follow-up loop, got %d requests", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	requireCanvasHarnessToolChoice(t, requests[1], "")
	requireCanvasHarnessToolChoice(t, requests[2], "")
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonToolResults {
		t.Fatalf("second reason = %#v", secondStat["reason"])
	}
	thirdStat := requireCanvasHarnessLoopStat(t, events, 2)
	if thirdStat["reason"] != canvasLoopReasonToolResults {
		t.Fatalf("third reason = %#v", thirdStat["reason"])
	}
}

func TestCanvasHarnessRepairsRequiredNativeTextOnlyAnnotation(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"Where is the peach in this image? Circle it.",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a"),
		canvasHarnessText("The peach is on the headband, but I cannot directly circle it here."),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband.",
			"region":       map[string]any{"x": 0.4, "y": 0.22, "width": 0.2, "height": 0.12},
		}),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	textEvent := requireCanvasHarnessEvent(t, events, "text", "")
	if !strings.Contains(fmt.Sprint(textEvent["content"]), "Added 1 comment.") {
		t.Fatalf("terminal comment answer missing: %#v", textEvent)
	}
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected repair round, got %d requests", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[0], "required")
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["reason"] != canvasLoopReasonTextOnlyDeferredWork {
		t.Fatalf("repair reason = %#v", secondStat["reason"])
	}
}

func TestCanvasHarnessRepairsIncompleteTextAnnotationMentionedByComment(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Asset.OcrText = "日本一"
	events, provider := runCanvasToolUseHarness(
		t,
		"Circle the peach and the visible text, then explain both in comments.",
		snapshot,
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband. The visible text reads 日本一.",
			"region":       map[string]any{"x": 0.29, "y": 0.19, "width": 0.11, "height": 0.08},
			"visualCue":    map[string]any{"targetDescription": "small pink peach icon", "colorHex": "#f26aa0"},
		}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband. The visible text reads 日本一.",
			"region":       map[string]any{"x": 0.29, "y": 0.19, "width": 0.11, "height": 0.08},
			"visualCue":    map[string]any{"targetDescription": "small pink peach icon", "colorHex": "#f26aa0"},
		}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The banner text reads 日本一.",
			"region":       map[string]any{"x": 0.64, "y": 0.1, "width": 0.2, "height": 0.36},
			"visualCue":    map[string]any{"targetDescription": "white text glyphs", "colorHex": "#ffffff"},
		}),
	)
	requireCanvasHarnessToolEventOrder(t, events, "create_comment", "create_comment")
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected incomplete text annotation repair, got %d requests", len(requests))
	}
	commentResults := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "create_comment" {
			commentResults++
		}
	}
	if commentResults != 2 {
		t.Fatalf("expected repeated non-text comment to be blocked, got %d create_comment results in %#v", commentResults, events)
	}
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonIncompleteTextAnnotation {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	if !strings.Contains(requests[1].Messages[len(requests[1].Messages)-1].Content, "actual visible characters") {
		t.Fatalf("repair prompt should demand a separate text region:\n%s", requests[1].Messages[len(requests[1].Messages)-1].Content)
	}
}

func TestCanvasHarnessBlocksUnverifiableOCRMentionBeforeRepair(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Asset.OcrText = "日本一"
	events, provider := runCanvasToolUseHarness(
		t,
		"Circle the peach and the visible text, then explain both in comments.",
		snapshot,
		canvasHarnessToolCalls(
			llm.ChatToolCall{
				Name: "create_comment",
				Arguments: map[string]any{
					"anchorCardId": "card-a",
					"text":         "The peach is on the headband. The visible text reads 日本一.",
					"region":       map[string]any{"x": 0.29, "y": 0.19, "width": 0.11, "height": 0.08},
					"visualCue":    map[string]any{"targetDescription": "small pink peach icon", "colorHex": "#f26aa0"},
				},
			},
			llm.ChatToolCall{
				Name: "create_comment",
				Arguments: map[string]any{
					"anchorCardId": "card-a",
					"text":         "The picture has a peach on the left side and the text reads 日本一.",
					"region":       map[string]any{"x": 0.1, "y": 0.2, "width": 0.15, "height": 0.1},
				},
			},
		),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The banner text reads 日本一.",
			"region":       map[string]any{"x": 0.64, "y": 0.1, "width": 0.2, "height": 0.36},
			"visualCue":    map[string]any{"targetDescription": "white text glyphs", "colorHex": "#ffffff"},
		}),
	)
	requireCanvasHarnessToolEventOrder(t, events, "create_comment", "create_comment")
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonIncompleteTextAnnotation {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	commentResults := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "create_comment" {
			commentResults++
			result := event["result"].(map[string]any)
			if strings.Contains(fmt.Sprint(result["text"]), "left side") {
				t.Fatalf("unverifiable OCR mention should be blocked before UI execution: %#v", result)
			}
		}
	}
	if commentResults != 2 {
		t.Fatalf("expected only verified peach plus repaired text comments, got %d in %#v", commentResults, events)
	}
	requests := provider.Requests()
	if len(requests) < 2 {
		t.Fatalf("expected repair request after blocking unverifiable text mention, got %d", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[1], "required")
}

func TestCanvasHarnessKeepsIncompleteTextAnnotationRepairSticky(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Asset.OcrText = "日本一"
	events, provider := runCanvasToolUseHarness(
		t,
		"Circle the peach and the visible text, then explain both in comments.",
		snapshot,
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband. The visible text reads 日本一.",
			"region":       map[string]any{"x": 0.29, "y": 0.19, "width": 0.11, "height": 0.08},
			"visualCue":    map[string]any{"targetDescription": "small pink peach icon", "colorHex": "#f26aa0"},
		}),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The picture has a peach on the left side and the text reads 日本一.",
			"region":       map[string]any{"x": 0.2, "y": 0.3, "width": 0.15, "height": 0.15},
		}),
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The banner text reads 日本一.",
			"region":       map[string]any{"x": 0.64, "y": 0.1, "width": 0.2, "height": 0.36},
			"visualCue":    map[string]any{"targetDescription": "white text glyphs", "colorHex": "#ffffff"},
		}),
	)
	requireCanvasHarnessToolEventOrder(t, events, "create_comment", "create_comment")
	for _, index := range []int{1, 2, 3} {
		stat := requireCanvasHarnessLoopStat(t, events, index)
		if stat["nextReason"] != canvasLoopReasonIncompleteTextAnnotation {
			t.Fatalf("loop %d nextReason = %#v, want sticky incomplete text repair", index, stat["nextReason"])
		}
	}
	commentResults := 0
	for _, event := range events {
		if event["type"] != "action_result" || event["tool"] != "create_comment" {
			continue
		}
		commentResults++
		result := event["result"].(map[string]any)
		if strings.Contains(fmt.Sprint(result["text"]), "left side") {
			t.Fatalf("sticky repair should block wrong non-text OCR comment: %#v", result)
		}
	}
	if commentResults != 2 {
		t.Fatalf("expected verified peach plus repaired text comments, got %d in %#v", commentResults, events)
	}
	requests := provider.Requests()
	if len(requests) != 5 {
		t.Fatalf("requests = %d, want 5", len(requests))
	}
	requireCanvasHarnessToolChoice(t, requests[1], "required")
	requireCanvasHarnessToolChoice(t, requests[2], "required")
	requireCanvasHarnessToolChoice(t, requests[3], "required")
	requireCanvasHarnessToolChoice(t, requests[4], "required")
	for _, index := range []int{2, 3, 4} {
		requireCanvasHarnessRequestTool(t, requests[index], "create_comment")
		rejectCanvasHarnessRequestTool(t, requests[index], "focus_card")
		rejectCanvasHarnessRequestTool(t, requests[index], "select_cards")
		rejectCanvasHarnessRequestTool(t, requests[index], "inspect_canvas")
		if len(requests[index].Tools) != 1 {
			t.Fatalf("request %d repair tools = %d, want only create_comment: %#v", index, len(requests[index].Tools), requests[index].Tools)
		}
	}
}

func TestCanvasHarnessDoesNotFinishWithProseWhileTextAnnotationPending(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Asset.OcrText = "日本一"
	events, provider := runCanvasToolUseHarness(
		t,
		"Circle the peach and the visible text, then explain both in comments.",
		snapshot,
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband. The visible text reads 日本一.",
			"region":       map[string]any{"x": 0.29, "y": 0.19, "width": 0.11, "height": 0.08},
			"visualCue":    map[string]any{"targetDescription": "small pink peach icon", "colorHex": "#f26aa0"},
		}),
		canvasHarnessText("The visible text reads 日本一 on the banner."),
		canvasHarnessText("The visible text reads 日本一 on the banner."),
		canvasHarnessText("The visible text reads 日本一 on the banner."),
		canvasHarnessText("The visible text reads 日本一 on the banner."),
	)
	requireCanvasHarnessToolEventOrder(t, events, "create_comment")
	rejectCanvasHarnessEvent(t, events, "text", "")

	requests := provider.Requests()
	if len(requests) != 5 {
		t.Fatalf("requests = %d, want 5", len(requests))
	}
	for _, index := range []int{1, 2, 3, 4} {
		stat := requireCanvasHarnessLoopStat(t, events, index)
		if stat["reason"] != canvasLoopReasonIncompleteTextAnnotation {
			t.Fatalf("loop %d reason = %#v, want sticky incomplete text repair", index, stat["reason"])
		}
		requireCanvasHarnessToolChoice(t, requests[index], "required")
		requireCanvasHarnessRequestTool(t, requests[index], "create_comment")
		rejectCanvasHarnessRequestTool(t, requests[index], "focus_card")
	}
}

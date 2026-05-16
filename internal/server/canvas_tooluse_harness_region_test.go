package server

import (
	"aisets/internal/llm"
	"context"
	"image/color"
	"path/filepath"
	"testing"
)

func TestCanvasHarnessNormalizesPixelCommentRegion(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	snapshot.Cards[0].Width = 400
	snapshot.Cards[0].Height = 300
	events, _ := runCanvasToolUseHarness(
		t,
		"幫我在這張圖需要注意的地方留一個註解，標出可讀性問題。",
		snapshot,
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "Readability issue: text is too small against the background.",
			"region":       map[string]any{"x": float64(300), "y": float64(150), "width": float64(200), "height": float64(90)},
		}),
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("comment result = %#v", event["result"])
	}
	region, ok := result["region"].(map[string]any)
	if !ok {
		t.Fatalf("region = %#v", result["region"])
	}
	if region["x"] != 0.5 || region["y"] != 0.5 || region["width"] != 0.5 || region["height"] != 0.3 {
		t.Fatalf("normalized pixel region = %#v", region)
	}
}

func TestCanvasHarnessRefinesCommentRegionWithVisualCueColor(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writeCanvasRegionFixturePNG(t, filepath.Join(bootstrap.root, "img", "a.png"))
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a")
	probe := normalizeCanvasImageRegionAction(canvasAction{
		Tool: "create_comment",
		Params: map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband.",
			"region":       map[string]any{"x": 0.42, "y": 0.18, "width": 0.06, "height": 0.05},
			"visualCue": map[string]any{
				"targetDescription": "small pink peach icon",
				"colorHex":          "#f26aa0",
			},
		},
	}, snapshot)
	probe = bootstrap.server.refineCanvasImageRegionAction(context.Background(), probe, snapshot)
	probeRegion, _ := canvasRegionFromValue(probe.Params["region"])
	if probeRegion.X < 0.30 || probeRegion.X > 0.34 {
		t.Fatalf("direct refined region = %#v", probe.Params["region"])
	}
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("create_comment", map[string]any{
			"anchorCardId": "card-a",
			"text":         "The peach is on the headband.",
			"region":       map[string]any{"x": 0.42, "y": 0.18, "width": 0.06, "height": 0.05},
			"visualCue": map[string]any{
				"targetDescription": "small pink peach icon",
				"colorHex":          "#f26aa0",
			},
		}),
	}
	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Where is the small peach? Circle it.",
		snapshot,
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "create_comment")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("comment result = %#v", event["result"])
	}
	region, ok := result["region"].(map[string]any)
	if !ok {
		t.Fatalf("region = %#v", result["region"])
	}
	x := region["x"].(float64)
	y := region["y"].(float64)
	width := region["width"].(float64)
	height := region["height"].(float64)
	if x < 0.29 || x > 0.34 || y < 0.18 || y > 0.23 || width < 0.08 || height < 0.08 {
		t.Fatalf("refined region = %#v, want near pink target", region)
	}
}

func TestCanvasHarnessRefinesCommentRegionForNewAssetIDAnchor(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writeCanvasRegionFixturePNG(t, filepath.Join(bootstrap.root, "img", "a.png"))
	probe := normalizeCanvasImageRegionAction(canvasAction{
		Tool: "create_comment",
		Params: map[string]any{
			"anchorCardId": bootstrap.assetA,
			"text":         "The peach is on the headband.",
			"region":       map[string]any{"x": 0.42, "y": 0.18, "width": 0.06, "height": 0.05},
			"visualCue": map[string]any{
				"targetDescription": "small pink peach icon",
				"colorHex":          "#f26aa0",
			},
		},
	}, canvasSnapshot{})
	probe = bootstrap.server.refineCanvasImageRegionAction(context.Background(), probe, canvasSnapshot{})
	region, _ := canvasRegionFromValue(probe.Params["region"])
	if region.X < 0.29 || region.X > 0.34 || region.Y < 0.18 || region.Y > 0.23 || region.Width < 0.08 || region.Height < 0.08 {
		t.Fatalf("asset-id anchored refined region = %#v", probe.Params["region"])
	}
}

func TestRefineCanvasRegionByColor(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fixture.png")
	writeCanvasRegionFixturePNG(t, path)
	region, ok := refineCanvasRegionByColor(
		path,
		canvasRegion{X: 0.42, Y: 0.18, Width: 0.06, Height: 0.05},
		canvasRegionVisualCue{
			TargetDescription: "small pink peach icon",
			Color:             color.RGBA{R: 242, G: 106, B: 160, A: 255},
			HasColor:          true,
		},
	)
	if !ok {
		t.Fatal("expected region refinement")
	}
	if region.X < 0.29 || region.X > 0.34 || region.Y < 0.18 || region.Y > 0.23 {
		t.Fatalf("refined region = %#v", region)
	}
}

func TestRefineCanvasTextRegionByColorSearchesFullImage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "text-fixture.png")
	writeCanvasTextRegionFixturePNG(t, path)
	region, ok := refineCanvasRegionByColor(
		path,
		canvasRegion{X: 0.2, Y: 0.4, Width: 0.2, Height: 0.2},
		canvasRegionVisualCue{
			TargetDescription: "white text characters",
			Color:             color.RGBA{R: 255, G: 255, B: 255, A: 255},
			HasColor:          true,
		},
	)
	if !ok {
		t.Fatal("expected text region refinement")
	}
	if region.X < 0.58 || region.X > 0.72 || region.Y > 0.2 || region.Height < 0.5 {
		t.Fatalf("refined text region = %#v, want sign text cluster", region)
	}
}

func TestRefineCanvasTextRegionInfersTextColorWhenCueColorIsWrong(t *testing.T) {
	path := filepath.Join(t.TempDir(), "red-text-fixture.png")
	writeCanvasRedTextWithWhiteDistractorPNG(t, path)
	region, ok := refineCanvasRegionByColor(
		path,
		canvasRegion{X: 0.1, Y: 0.2, Width: 0.2, Height: 0.1},
		canvasRegionVisualCue{
			TargetDescription: "white text characters",
			Color:             color.RGBA{R: 255, G: 255, B: 255, A: 255},
			HasColor:          true,
		},
	)
	if !ok {
		t.Fatal("expected text region refinement despite wrong cue color")
	}
	if canvasRegionLooksGenericPlaceholder(region) || region.Y > 0.25 || region.Width < 0.35 {
		t.Fatalf("refined text region = %#v, want red title text cluster", region)
	}
}

func TestCanvasHarnessUpdatesCommentRegionWithNativeToolCall(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "comment-a")
	snapshot.Cards[0].Width = 400
	snapshot.Cards[0].Height = 300
	events, _ := runCanvasToolUseHarness(
		t,
		"Correct the selected annotation region so it points to the target.",
		snapshot,
		canvasHarnessToolCall("update_comment", map[string]any{
			"commentCardId": "comment-a",
			"region":        map[string]any{"x": float64(300), "y": float64(150), "width": float64(80), "height": float64(45)},
		}),
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
	if region["x"] != 0.75 || region["y"] != 0.5 || region["width"] != 0.2 || region["height"] != 0.15 {
		t.Fatalf("normalized update_comment region = %#v", region)
	}
	if _, ok := result["text"]; !ok {
		t.Fatalf("update_comment should preserve optional text key for frontend contract: %#v", result)
	}
}

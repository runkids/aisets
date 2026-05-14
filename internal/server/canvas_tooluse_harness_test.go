package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"aisets/internal/aitag"
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

type canvasToolUseScriptedProvider struct {
	fakeEmbedProvider
	mu        sync.Mutex
	responses []llm.ChatResponse
	requests  []llm.ChatRequest
}

func (p *canvasToolUseScriptedProvider) Chat(_ context.Context, req llm.ChatRequest) (llm.ChatResponse, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, req)
	if len(p.responses) == 0 {
		return llm.ChatResponse{Content: "ok"}, nil
	}
	resp := p.responses[0]
	p.responses = p.responses[1:]
	return resp, nil
}

func (p *canvasToolUseScriptedProvider) Requests() []llm.ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]llm.ChatRequest, len(p.requests))
	copy(out, p.requests)
	return out
}

type canvasToolUseHarness struct {
	server   *Server
	provider *canvasToolUseScriptedProvider
	root     string
	assetA   string
	assetB   string
}

type canvasHarnessEvent map[string]any

func newCanvasToolUseHarness(t *testing.T, responses ...llm.ChatResponse) canvasToolUseHarness {
	t.Helper()
	root := resolvedTempDir(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(t.TempDir(), "cache"))
	writePNG(t, filepath.Join(root, "img", "a.png"))
	writePNG(t, filepath.Join(root, "img", "b.png"))

	store, err := config.OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	enabled := true
	providerName := "ollama"
	model := "fixture-vlm"
	if _, err := store.UpdateSettings(config.SettingsUpdate{
		LLMEnabled:     &enabled,
		LLMProvider:    &providerName,
		LLMVisionModel: &model,
	}); err != nil {
		t.Fatal(err)
	}

	assetA := serverScanAsset(root, "img/a.png", 5000, "hash-a", 1)
	assetB := serverScanAsset(root, "img/b.png", 6000, "hash-b", 0)
	assetA.AITag = &aitag.Result{Category: "icon", Tags: []string{"alpha"}, Description: "First test asset"}
	assetB.AITag = &aitag.Result{Category: "photo", Tags: []string{"beta"}, Description: "Second test asset"}
	assetA.Duplicates = []string{assetB.ID}
	assetB.Similar = []string{assetA.ID}
	if _, err := store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-14T00:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: root}},
		Items:       []scanner.AssetItem{assetA, assetB},
		Stats:       scanner.CatalogStats{TotalFiles: 2},
	}); err != nil {
		t.Fatal(err)
	}

	s, err := New(Options{Store: store, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	provider := &canvasToolUseScriptedProvider{responses: responses}
	s.llmProvider = provider
	return canvasToolUseHarness{
		server:   s,
		provider: provider,
		root:     root,
		assetA:   assetA.ID,
		assetB:   assetB.ID,
	}
}

func canvasHarnessSnapshot(assetA, assetB string, selected ...string) canvasSnapshot {
	return canvasSnapshot{
		Viewport:        canvasViewport{X: 0, Y: 0, Scale: 1},
		SelectedCardIDs: selected,
		Cards: []canvasCardSnapshot{
			{
				ID:         "card-a",
				Kind:       "asset",
				X:          10,
				Y:          20,
				Width:      220,
				Height:     160,
				LayerIndex: 0,
				Asset: &canvasAssetSnapshot{
					ID:          assetA,
					RepoPath:    "img/a.png",
					Ext:         ".png",
					Width:       8,
					Height:      8,
					Bytes:       5000,
					Tags:        []string{"alpha"},
					Description: "First test asset",
					UsedByCount: 1,
				},
			},
			{
				ID:         "card-b",
				Kind:       "asset",
				X:          280,
				Y:          20,
				Width:      220,
				Height:     160,
				LayerIndex: 1,
				Asset: &canvasAssetSnapshot{
					ID:          assetB,
					RepoPath:    "img/b.png",
					Ext:         ".png",
					Width:       8,
					Height:      8,
					Bytes:       6000,
					Tags:        []string{"beta"},
					Description: "Second test asset",
					UsedByCount: 0,
				},
			},
			{
				ID:         "comment-a",
				Kind:       "comment",
				X:          10,
				Y:          240,
				Width:      180,
				Height:     80,
				LayerIndex: 2,
				AnchorID:   "card-a",
				Text:       "Existing note",
			},
		},
	}
}

func runCanvasToolUseHarness(t *testing.T, message string, snapshot canvasSnapshot, responses ...llm.ChatResponse) ([]canvasHarnessEvent, *canvasToolUseScriptedProvider) {
	t.Helper()
	h := newCanvasToolUseHarness(t, responses...)
	if len(snapshot.Cards) == 0 {
		snapshot = canvasHarnessSnapshot(h.assetA, h.assetB)
	}
	body, err := json.Marshal(canvasChatRequest{
		Messages: []canvasChatMessage{{Role: "user", Content: message}},
		Canvas:   snapshot,
		Locale:   "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/canvas/chat", bytes.NewReader(body))
	h.server.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("canvas chat = %d %s", rec.Code, rec.Body.String())
	}
	return decodeCanvasHarnessEvents(t, rec.Body.String()), h.provider
}

func decodeCanvasHarnessEvents(t *testing.T, body string) []canvasHarnessEvent {
	t.Helper()
	var events []canvasHarnessEvent
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event canvasHarnessEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode event %q: %v", line, err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}

func firstCanvasHarnessEvent(events []canvasHarnessEvent, eventType, tool string) (canvasHarnessEvent, bool) {
	for _, event := range events {
		if event["type"] != eventType {
			continue
		}
		if tool != "" && event["tool"] != tool {
			continue
		}
		return event, true
	}
	return nil, false
}

func requireCanvasHarnessEvent(t *testing.T, events []canvasHarnessEvent, eventType, tool string) canvasHarnessEvent {
	t.Helper()
	event, ok := firstCanvasHarnessEvent(events, eventType, tool)
	if !ok {
		t.Fatalf("missing event type=%s tool=%s in %#v", eventType, tool, events)
	}
	return event
}

func rejectCanvasHarnessEvent(t *testing.T, events []canvasHarnessEvent, eventType, tool string) {
	t.Helper()
	if event, ok := firstCanvasHarnessEvent(events, eventType, tool); ok {
		t.Fatalf("unexpected event type=%s tool=%s: %#v", eventType, tool, event)
	}
}

func requireCanvasHarnessLoopStat(t *testing.T, events []canvasHarnessEvent, index int) map[string]any {
	t.Helper()
	done := requireCanvasHarnessEvent(t, events, "done", "")
	rawStats, ok := done["loopStats"].([]any)
	if !ok {
		t.Fatalf("loopStats = %#v", done["loopStats"])
	}
	if index < 0 || index >= len(rawStats) {
		t.Fatalf("loopStats[%d] missing in %#v", index, rawStats)
	}
	stat, ok := rawStats[index].(map[string]any)
	if !ok {
		t.Fatalf("loopStats[%d] = %#v", index, rawStats[index])
	}
	return stat
}

func requireCanvasHarnessStatNumber(t *testing.T, stat map[string]any, key string) float64 {
	t.Helper()
	value, ok := stat[key].(float64)
	if !ok {
		t.Fatalf("stat[%s] = %#v", key, stat[key])
	}
	return value
}

func canvasHarnessToolCall(tool string, args map[string]any) llm.ChatResponse {
	return llm.ChatResponse{
		Content: "native content should not be rendered after tool execution",
		ToolCalls: []llm.ChatToolCall{{
			Name:      tool,
			Arguments: args,
		}},
		InputTokens:  3,
		OutputTokens: 4,
		DurationMs:   5,
	}
}

func canvasHarnessText(content string) llm.ChatResponse {
	return llm.ChatResponse{Content: content, InputTokens: 1, OutputTokens: 1, DurationMs: 1}
}

func canvasHarnessDefaultArgs(tool, assetA, assetB string) map[string]any {
	switch tool {
	case "focus_card":
		return map[string]any{"cardId": "card-a", "label": "Focus asset A"}
	case "search_assets":
		return map[string]any{"q": "img", "limit": float64(2)}
	case "add_assets_to_canvas":
		return map[string]any{"assetIds": []any{assetA}, "label": "Add asset A"}
	case "extract_ocr_text":
		return map[string]any{"assetIds": []any{assetA}, "mode": "vlm", "saveToMetadata": false}
	case "get_asset_detail":
		return map[string]any{"assetId": assetA}
	case "create_comment":
		return map[string]any{"anchorCardId": "card-a", "text": "Mark this region", "region": map[string]any{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}}
	case "update_comment":
		return map[string]any{"commentCardId": "comment-a", "text": "Updated note"}
	case "delete_comment":
		return map[string]any{"commentCardId": "comment-a"}
	case "select_cards", "remove_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b"}, "label": "Target both cards"}
	case "duplicate_cards":
		return map[string]any{"cardIds": []any{"card-a"}, "count": float64(2), "layout": "row", "label": "Duplicate asset A"}
	case "move_card":
		return map[string]any{"cardId": "card-a", "x": float64(400), "y": float64(120)}
	case "arrange_cards":
		return map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(20), "y": float64(20)},
			map[string]any{"cardId": "card-b", "x": float64(360), "y": float64(20)},
		}}
	case "align_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b"}, "axis": "top", "label": "Align tops"}
	case "distribute_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b", "comment-a"}, "direction": "horizontal", "gap": float64(80), "label": "Distribute cards"}
	case "resize_card":
		return map[string]any{"cardId": "card-a", "width": float64(320)}
	case "bring_cards_to_front":
		return map[string]any{"cardIds": []any{"card-a"}, "afterCardId": "card-b", "label": "Layer asset A above asset B"}
	case "inspect_canvas":
		return map[string]any{"reason": "Check spacing"}
	case "capture_viewport", "capture_canvas", "capture_selected":
		return map[string]any{"transparent": true}
	case "compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text":
		args := map[string]any{"assetIds": []any{assetA, assetB}}
		if tool == "find_similar_assets" {
			args["limit"] = float64(5)
		}
		if tool == "generate_alt_text" {
			args["style"] = "concise"
		}
		return args
	case "compress_image":
		return map[string]any{"assetIds": []any{assetA}, "outputFormat": "webp", "quality": float64(82)}
	case "resize_image":
		return map[string]any{"assetIds": []any{assetA}, "maxDimensionPx": float64(1200)}
	case "convert_image":
		return map[string]any{"assetIds": []any{assetA}, "outputFormat": "jpg"}
	case "mirror_image":
		return map[string]any{"assetIds": []any{assetA}, "flip": "horizontal", "outputFormat": "png"}
	case "rotate_image":
		return map[string]any{"assetIds": []any{assetA}, "degrees": float64(90), "outputFormat": "png"}
	case "update_tags":
		return map[string]any{"assetIds": []any{assetA}, "tags": []any{"hero", "test"}}
	case "batch_update_tags":
		return map[string]any{"assetIds": []any{assetA, assetB}, "tags": []any{"batch", "test"}}
	case "update_description":
		return map[string]any{"assetIds": []any{assetA}, "description": "Updated description"}
	case "update_ocr_text":
		return map[string]any{"assetIds": []any{assetA}, "text": "Updated OCR text"}
	case "rename_asset":
		return map[string]any{"assetId": assetA, "newName": "renamed.png"}
	case "move_asset":
		return map[string]any{"assetIds": []any{assetA}, "destDir": "assets/icons"}
	case "copy_asset":
		return map[string]any{"assetIds": []any{assetA}, "destPath": "exports/a.png"}
	case "delete_asset":
		return map[string]any{"assetIds": []any{assetA}}
	case "favorite_asset":
		return map[string]any{"assetIds": []any{assetA}, "favorite": true}
	case "batch_favorite_assets":
		return map[string]any{"assetIds": []any{assetA, assetB}, "favorite": true}
	case "export_asset":
		return map[string]any{"assetIds": []any{assetA}, "outputDir": "exports"}
	default:
		return map[string]any{}
	}
}

func canvasHarnessMessageForTool(tool string) string {
	switch tool {
	case "create_comment":
		return "annotate this image"
	case "compress_image":
		return "compress this asset to webp"
	case "resize_image":
		return "resize this asset"
	case "convert_image":
		return "convert this asset to jpg"
	case "mirror_image":
		return "mirror this asset"
	case "rotate_image":
		return "rotate this asset"
	case "update_tags", "batch_update_tags":
		return "update tags on these assets"
	case "update_description":
		return "save a description for this asset"
	case "update_ocr_text":
		return "save OCR text for this asset"
	case "rename_asset":
		return "rename this asset"
	case "move_asset":
		return "move this asset"
	case "copy_asset":
		return "copy this asset"
	case "delete_asset":
		return "delete this asset"
	case "favorite_asset", "batch_favorite_assets":
		return "favorite this asset"
	case "export_asset":
		return "export this asset"
	default:
		return "use the canvas tool"
	}
}

func TestCanvasToolSchemaParity(t *testing.T) {
	registry := canvasToolRegistry()
	llmTools := canvasLLMTools()
	if len(registry) != len(llmTools) {
		t.Fatalf("tool count mismatch: registry=%d llm=%d", len(registry), len(llmTools))
	}
	llmByName := map[string]llm.ChatTool{}
	for _, tool := range llmTools {
		llmByName[tool.Name] = tool
	}
	for _, tool := range registry {
		t.Run(tool.Name, func(t *testing.T) {
			if tool.Description == "" || tool.Cardinality == "" {
				t.Fatalf("incomplete registry entry: %#v", tool)
			}
			schema := tool.Parameters
			if schema == nil {
				t.Fatal("missing native parameters schema")
			}
			if schema["type"] != "object" {
				t.Fatalf("schema type = %#v", schema["type"])
			}
			if _, ok := schema["properties"].(map[string]any); !ok {
				t.Fatalf("schema properties = %#v", schema["properties"])
			}
			if schema["additionalProperties"] != false {
				t.Fatalf("schema should be closed: %#v", schema)
			}
			llmTool, ok := llmByName[tool.Name]
			if !ok {
				t.Fatalf("missing llm tool for %s", tool.Name)
			}
			if !reflect.DeepEqual(llmTool.Parameters, tool.Parameters) {
				t.Fatalf("llm schema mismatch:\n%#v\n%#v", llmTool.Parameters, tool.Parameters)
			}
			paramsText := canvasToolParamsText(tool.Parameters)
			if paramsText == "" {
				t.Fatal("empty derived params text")
			}
			wantDescription := fmt.Sprintf("%s Params: %s Cardinality: %s Safety: %s.", tool.Description, paramsText, tool.Cardinality, canvasToolSafetyLabel(tool.Safe))
			if llmTool.Description != wantDescription {
				t.Fatalf("llm description should be derived from schema:\n%s\nwant:\n%s", llmTool.Description, wantDescription)
			}
		})
	}
}

func TestCanvasToolPromptParamsDerivedFromSchema(t *testing.T) {
	paramsText := canvasToolParamsText(canvasToolParameters("align_cards"))
	for _, want := range []string{
		`"cardIds": [string] (required; Canvas card IDs.)`,
		`"axis": left|center|right|top|middle|bottom (required; Alignment axis.)`,
	} {
		if !strings.Contains(paramsText, want) {
			t.Fatalf("derived params text %q missing %q", paramsText, want)
		}
	}

	toolsBlock := canvasToolsBlock()
	if !strings.Contains(toolsBlock, "params: "+paramsText) {
		t.Fatalf("tools block does not use derived params text:\n%s", toolsBlock)
	}
}

func TestCanvasHarnessNativeToolCallsCoverRegistry(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	snapshot := canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB)
	for _, tool := range canvasToolRegistry() {
		t.Run(tool.Name, func(t *testing.T) {
			responses := []llm.ChatResponse{
				canvasHarnessToolCall(tool.Name, canvasHarnessDefaultArgs(tool.Name, bootstrap.assetA, bootstrap.assetB)),
			}
			if tool.Name == "extract_ocr_text" {
				responses = append(responses, canvasHarnessText(`{"text":"Harness OCR text","languages":["en"]}`))
			}
			events, _ := runCanvasToolUseHarness(t, canvasHarnessMessageForTool(tool.Name), snapshot, responses...)
			if tool.Safe {
				if tool.Name == "focus_card" {
					requireCanvasHarnessEvent(t, events, "focus", "")
					return
				}
				requireCanvasHarnessEvent(t, events, "action_result", tool.Name)
				rejectCanvasHarnessEvent(t, events, "proposal", tool.Name)
				return
			}
			requireCanvasHarnessEvent(t, events, "proposal", tool.Name)
			rejectCanvasHarnessEvent(t, events, "action_result", tool.Name)
		})
	}
}

func TestCanvasHarnessNativeToolCallsSuppressStaleText(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"find assets",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("search_assets", canvasHarnessDefaultArgs("search_assets", bootstrap.assetA, bootstrap.assetB)),
	)
	requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	for _, event := range events {
		if event["type"] == "text" && strings.Contains(event["content"].(string), "native content should not be rendered") {
			t.Fatalf("stale native content leaked into text events: %#v", events)
		}
	}
	requests := provider.Requests()
	if len(requests) == 0 {
		t.Fatal("provider received no requests")
	}
	wantToolCount := len(canvasLLMToolsForSkills([]string{canvasSkillSearch}))
	if len(requests[0].Tools) != wantToolCount {
		t.Fatalf("request did not include gated native canvas tools: got %d want %d", len(requests[0].Tools), wantToolCount)
	}
	stat := requireCanvasHarnessLoopStat(t, events, 0)
	if got := requireCanvasHarnessStatNumber(t, stat, "selectedToolCount"); got != float64(wantToolCount) {
		t.Fatalf("selectedToolCount = %v, want %d", got, wantToolCount)
	}
	if skills, ok := stat["selectedSkillIds"].([]any); !ok || len(skills) != 1 || skills[0] != canvasSkillSearch {
		t.Fatalf("selectedSkillIds = %#v", stat["selectedSkillIds"])
	}
	if stat["toolUseSource"] != "native_tool_call" {
		t.Fatalf("toolUseSource = %#v", stat["toolUseSource"])
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "nativeToolCallCount"); got != 1 {
		t.Fatalf("nativeToolCallCount = %v", got)
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "actionCount"); got != 1 {
		t.Fatalf("actionCount = %v", got)
	}
	if got := requireCanvasHarnessStatNumber(t, stat, "safeActionCount"); got != 1 {
		t.Fatalf("safeActionCount = %v", got)
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
	if strings.Contains(requests[0].Messages[0].Content, "## Available Tools") {
		t.Fatalf("native request duplicated text tool block:\n%s", requests[0].Messages[0].Content)
	}
	if len(requests[1].Tools) != 0 {
		t.Fatalf("fallback request should omit native tools, got %d", len(requests[1].Tools))
	}
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
		"action fence": "```action\n{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140},\"description\":\"Move\",\"impact\":\"Moves card\"}\n```",
		"json fence":   "```json\n[{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140}}]\n```",
		"gemma":        "<|tool_call>call{\"tool\":\"move_card\",\"params\":{\"cardId\":\"card-a\",\"x\":120,\"y\":140}}<tool_call|>",
		"plain call":   "call:move_card{cardId:<|\"|>card-a<|\"|>,x:120,y:140}",
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
		canvasHarnessToolCall("create_comment", canvasHarnessDefaultArgs("create_comment", bootstrap.assetA, bootstrap.assetB)),
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

func TestCanvasHarnessNormalizesUnsafeProposalParams(t *testing.T) {
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
	proposal := requireCanvasHarnessEvent(t, events, "proposal", "rotate_image")
	params, ok := proposal["params"].(map[string]any)
	if !ok {
		t.Fatalf("params = %#v", proposal["params"])
	}
	if params["assetId"] != bootstrap.assetA || params["degrees"] != float64(90) || params["outputFormat"] != "png" {
		t.Fatalf("normalized proposal params = %#v", params)
	}
	if _, exists := params["rotate_degrees"]; exists {
		t.Fatalf("raw alias leaked into proposal params: %#v", params)
	}
}

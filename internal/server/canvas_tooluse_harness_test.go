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
	for _, result := range []aitag.Result{
		{
			ProjectID:     assetA.ProjectID,
			RepoPath:      assetA.RepoPath,
			ContentHash:   assetA.ContentHash,
			HashAlgorithm: assetA.HashAlgorithm,
			ProviderName:  providerName,
			ModelName:     model,
			Status:        aitag.StatusReady,
			Category:      "icon",
			Tags:          []string{"alpha"},
			Description:   "First test asset",
		},
		{
			ProjectID:     assetB.ProjectID,
			RepoPath:      assetB.RepoPath,
			ContentHash:   assetB.ContentHash,
			HashAlgorithm: assetB.HashAlgorithm,
			ProviderName:  providerName,
			ModelName:     model,
			Status:        aitag.StatusReady,
			Category:      "photo",
			Tags:          []string{"beta"},
			Description:   "Second test asset",
		},
	} {
		if err := store.UpsertAITagResult(result); err != nil {
			t.Fatal(err)
		}
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

func canvasHarnessTreeDonkeySnapshot(assetA, assetB string) canvasSnapshot {
	return canvasSnapshot{
		Viewport: canvasViewport{X: 0, Y: 0, Scale: 1},
		Cards: []canvasCardSnapshot{
			{
				ID:         "card-family",
				Kind:       "asset",
				X:          80,
				Y:          820,
				Width:      300,
				Height:     235,
				LayerIndex: 0,
				Asset: &canvasAssetSnapshot{
					ID:          "asset-family",
					RepoPath:    "family_danran.png",
					Ext:         ".png",
					Width:       500,
					Height:      392,
					Tags:        []string{"family", "group"},
					Description: "Family group scene",
				},
			},
			{
				ID:         "card-tree",
				Kind:       "asset",
				X:          700,
				Y:          960,
				Width:      320,
				Height:     320,
				LayerIndex: 1,
				Asset: &canvasAssetSnapshot{
					ID:          assetA,
					RepoPath:    "monogatari_suppai_budou.png",
					Ext:         ".png",
					Width:       180,
					Height:      180,
					Tags:        []string{"fox", "tree", "grapes", "cartoon"},
					Description: "A cartoon fox sitting under a tree with grapes.",
					SearchTagsI18n: map[string][]string{
						"zh-TW": {"狐狸", "樹木", "葡萄", "卡通"},
					},
					SearchDescriptionI18n: map[string]string{
						"zh-TW": "一隻卡通狐狸坐在葡萄樹下。",
					},
				},
			},
			{
				ID:         "card-donkey",
				Kind:       "asset",
				X:          560,
				Y:          1210,
				Width:      320,
				Height:     379,
				LayerIndex: 2,
				Asset: &canvasAssetSnapshot{
					ID:          assetB,
					RepoPath:    "animal_raba.png",
					Ext:         ".png",
					Width:       337,
					Height:      400,
					Tags:        []string{"驢", "donkey", "cartoon"},
					Description: "一隻棕色的可愛卡通驢子。",
				},
			},
			{
				ID:         "card-fish-book",
				Kind:       "asset",
				X:          1040,
				Y:          980,
				Width:      300,
				Height:     372,
				LayerIndex: 3,
				Asset: &canvasAssetSnapshot{
					ID:          "asset-fish-book",
					RepoPath:    "book_zukan_fish.png",
					Ext:         ".png",
					Width:       201,
					Height:      250,
					Tags:        []string{"魚", "兒童讀物", "圖鑑"},
					Description: "一本介紹魚類的兒童圖鑑書。",
				},
			},
		},
	}
}

func canvasHarnessGenericRecoverySnapshot() canvasSnapshot {
	return canvasSnapshot{
		Viewport: canvasViewport{X: 0, Y: 0, Scale: 1},
		Cards: []canvasCardSnapshot{
			{
				ID:         "card-primary",
				Kind:       "asset",
				X:          120,
				Y:          160,
				Width:      320,
				Height:     240,
				LayerIndex: 0,
				Asset: &canvasAssetSnapshot{
					ID:                "asset-primary",
					RepoPath:          "primary-subject.png",
					Ext:               ".png",
					Width:             320,
					Height:            240,
					SearchTags:        []string{"primary-subject"},
					SearchDescription: "Primary target asset for recovery tests.",
				},
			},
			{
				ID:         "card-secondary",
				Kind:       "asset",
				X:          520,
				Y:          160,
				Width:      320,
				Height:     240,
				LayerIndex: 1,
				Asset: &canvasAssetSnapshot{
					ID:                "asset-secondary",
					RepoPath:          "secondary-subject.png",
					Ext:               ".png",
					Width:             320,
					Height:            240,
					SearchTags:        []string{"secondary-subject"},
					SearchDescription: "Secondary target asset for recovery tests.",
				},
			},
			{
				ID:         "card-decoy",
				Kind:       "asset",
				X:          920,
				Y:          160,
				Width:      320,
				Height:     240,
				LayerIndex: 2,
				Asset: &canvasAssetSnapshot{
					ID:                "asset-decoy",
					RepoPath:          "decoy-subject.png",
					Ext:               ".png",
					Width:             320,
					Height:            240,
					SearchTags:        []string{"decoy-subject"},
					SearchDescription: "Decoy asset that must not be touched unless requested.",
				},
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

func canvasHarnessEventStringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func requireCanvasHarnessStatusContaining(t *testing.T, events []canvasHarnessEvent, text string) {
	t.Helper()
	for _, event := range events {
		if event["type"] == "status" && strings.Contains(fmt.Sprint(event["content"]), text) {
			return
		}
	}
	t.Fatalf("missing status containing %q in %#v", text, events)
}

func requireCanvasActionTool(t *testing.T, actions []canvasAction, tool string) canvasAction {
	t.Helper()
	for _, action := range actions {
		if action.Tool == tool {
			return action
		}
	}
	t.Fatalf("missing action tool=%s in %#v", tool, actions)
	return canvasAction{}
}

func canvasHarnessRequestHasTool(req llm.ChatRequest, name string) bool {
	for _, tool := range req.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func requireCanvasHarnessRequestTool(t *testing.T, req llm.ChatRequest, name string) {
	t.Helper()
	if !canvasHarnessRequestHasTool(req, name) {
		t.Fatalf("request missing tool %s in %#v", name, req.Tools)
	}
}

func rejectCanvasHarnessRequestTool(t *testing.T, req llm.ChatRequest, name string) {
	t.Helper()
	if canvasHarnessRequestHasTool(req, name) {
		t.Fatalf("request should not include tool %s in %#v", name, req.Tools)
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

func canvasHarnessToolCalls(calls ...llm.ChatToolCall) llm.ChatResponse {
	return llm.ChatResponse{
		Content:      "native content should not be rendered after tool execution",
		ToolCalls:    calls,
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

func TestCanvasHarnessFallbackCatalogSearchWhenModelDoesNotUseTool(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"搜尋 alpha 相關素材，加入 1 張到畫布，排成一列",
		canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessText("ok"),
	)
	event := requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	result, ok := event["result"].(map[string]any)
	if !ok {
		t.Fatalf("search result = %#v", event["result"])
	}
	items, ok := result["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("search items = %#v", result["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok || item["id"] != bootstrap.assetA {
		t.Fatalf("first search item = %#v, want assetA %s", items[0], bootstrap.assetA)
	}
	if result["q"] != "alpha" {
		t.Fatalf("search q = %#v, want alpha", result["q"])
	}
	requests := provider.Requests()
	if len(requests) != 1 {
		t.Fatalf("fallback search should not require extra model loops, got %d", len(requests))
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

func TestCanvasHarnessEmptyLocalModelUsesDeterministicFallback(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"把樹放大，然後樹下有一隻驢子。複製兩張也移到空的地方",
		canvasHarnessTreeDonkeySnapshot(bootstrap.assetA, bootstrap.assetB),
		llm.ChatResponse{Content: "", InputTokens: 100, OutputTokens: 91, DurationMs: 5},
		llm.ChatResponse{Content: "", InputTokens: 100, OutputTokens: 91, DurationMs: 5},
	)
	requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	duplicateEvent := requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	result, ok := duplicateEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("duplicate result = %#v", duplicateEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(result["cardIds"]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
	if got := len(provider.Requests()); got != 2 {
		t.Fatalf("requests = %d, want 2", got)
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
	requireCanvasHarnessRequestTool(t, requests[1], "focus_card")
	requireCanvasHarnessRequestTool(t, requests[1], "select_cards")
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
		canvasHarnessToolCall("select_cards", map[string]any{"cardIds": []any{"card-a"}, "label": "Tree card"}),
		canvasHarnessToolCall("resize_card", map[string]any{"cardId": "card-a", "width": "420"}),
	)
	requireCanvasHarnessEvent(t, events, "focus", "")
	requireCanvasHarnessEvent(t, events, "action_result", "select_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	status := requireCanvasHarnessEvent(t, events, "status", "")
	if !strings.Contains(fmt.Sprint(status["content"]), "Confirming") {
		t.Fatalf("status content = %#v", status["content"])
	}
	requests := provider.Requests()
	if len(requests) < 3 {
		t.Fatalf("expected repeated preparatory repair requests, got %d", len(requests))
	}
	requireCanvasHarnessRequestTool(t, requests[1], "focus_card")
	requireCanvasHarnessRequestTool(t, requests[1], "select_cards")
	requireCanvasHarnessRequestTool(t, requests[2], "focus_card")
	requireCanvasHarnessRequestTool(t, requests[2], "select_cards")
	requireCanvasHarnessRequestTool(t, requests[2], "resize_card")
	firstStat := requireCanvasHarnessLoopStat(t, events, 0)
	if firstStat["nextReason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("first nextReason = %#v", firstStat["nextReason"])
	}
	secondStat := requireCanvasHarnessLoopStat(t, events, 1)
	if secondStat["nextReason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("second nextReason = %#v", secondStat["nextReason"])
	}
	thirdStat := requireCanvasHarnessLoopStat(t, events, 2)
	if thirdStat["reason"] != canvasLoopReasonFocusOnlyNeedsAnswer {
		t.Fatalf("third reason = %#v", thirdStat["reason"])
	}
}

func TestCanvasHarnessPreparatoryLoopFallsBackToConcreteManipulation(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, provider := runCanvasToolUseHarness(
		t,
		"把樹放大，然後樹下有一隻驢子也移到空的地方",
		canvasHarnessTreeDonkeySnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-tree", "label": "Tree card"}),
		canvasHarnessToolCall("select_cards", map[string]any{"cardIds": []any{"card-tree", "card-donkey"}, "label": "Tree and donkey group"}),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-tree", "label": "Tree and donkey group"}),
	)
	requireCanvasHarnessStatusContaining(t, events, "Confirmation complete")
	resizeEvent := requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	resizeResult, ok := resizeEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("resize result = %#v", resizeEvent["result"])
	}
	if resizeResult["cardId"] != "card-tree" {
		t.Fatalf("resize cardId = %#v", resizeResult["cardId"])
	}
	if width, ok := resizeResult["width"].(float64); !ok || width <= 320 {
		t.Fatalf("resize width = %#v", resizeResult["width"])
	}
	arrangeEvent := requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	arrangeResult, ok := arrangeEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("arrange result = %#v", arrangeEvent["result"])
	}
	rawPositions, ok := arrangeResult["positions"].([]any)
	if !ok || len(rawPositions) != 2 {
		t.Fatalf("positions = %#v", arrangeResult["positions"])
	}
	gotIDs := make([]string, 0, len(rawPositions))
	for _, raw := range rawPositions {
		position, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("position = %#v", raw)
		}
		gotIDs = append(gotIDs, fmt.Sprint(position["cardId"]))
	}
	if !reflect.DeepEqual(gotIDs, []string{"card-tree", "card-donkey"}) {
		t.Fatalf("position card IDs = %#v", gotIDs)
	}
	requests := provider.Requests()
	if len(requests) != 3 {
		t.Fatalf("expected fallback after three preparatory requests, got %d requests", len(requests))
	}
}

func TestCanvasHarnessFallbackUsesConfirmedTargetsAndExactMetadata(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"把樹放大，然後樹下有一隻驢子。複製兩張也移到空的地方 旋轉封面是魚的書 把 family 鏡像處理",
		canvasHarnessTreeDonkeySnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-tree", "label": "Tree card"}),
		canvasHarnessToolCall("select_cards", map[string]any{"cardIds": []any{"card-tree", "card-donkey"}, "label": "Tree and donkey group"}),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-tree", "label": "Tree and donkey group"}),
	)

	resizeEvent := requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	resizeResult, ok := resizeEvent["result"].(map[string]any)
	if !ok || resizeResult["cardId"] != "card-tree" {
		t.Fatalf("resize result = %#v", resizeEvent["result"])
	}

	duplicateEvent := requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
	duplicateResult, ok := duplicateEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("duplicate result = %#v", duplicateEvent["result"])
	}
	positions, ok := duplicateResult["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("duplicate positions = %#v", duplicateResult["positions"])
	}

	rotateEvent := requireCanvasHarnessEvent(t, events, "action_result", "rotate_image")
	rotateResult, ok := rotateEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("rotate result = %#v", rotateEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(rotateResult["assetIds"]); !reflect.DeepEqual(got, []string{"asset-fish-book"}) {
		t.Fatalf("rotate assetIds = %#v", got)
	}
	mirrorEvent := requireCanvasHarnessEvent(t, events, "action_result", "mirror_image")
	mirrorResult, ok := mirrorEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("mirror result = %#v", mirrorEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(mirrorResult["assetIds"]); !reflect.DeepEqual(got, []string{"asset-family"}) {
		t.Fatalf("mirror assetIds = %#v", got)
	}
}

func TestCanvasFallbackRelationClauseUsesMostRecentTarget(t *testing.T) {
	actions := fallbackCanvasManipulationActions(
		"把樹放大，然後樹下有一隻驢子。複製兩張也移到空的地方",
		canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey"),
		[]string{"card-tree"},
	)
	var duplicate canvasAction
	for _, action := range actions {
		if action.Tool == "duplicate_cards" {
			duplicate = action
			break
		}
	}
	got := canvasActionCardIDs(duplicate)
	if !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
}

func TestCanvasFallbackDuplicateCopyPositionsIgnoreRemoteOutliers(t *testing.T) {
	canvas := canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey")
	canvas.Cards = append(canvas.Cards, canvasCardSnapshot{
		ID:     "card-remote",
		Kind:   "asset",
		X:      4900,
		Y:      1040,
		Width:  320,
		Height: 320,
		Asset: &canvasAssetSnapshot{
			ID:          "asset-remote",
			RepoPath:    "remote.png",
			Description: "A remote outlier left from a previous operation.",
		},
	})

	positions := canvasFallbackDuplicateCopyPositions(
		"複製兩張也移到空的地方",
		canvas,
		[]string{"copy-a", "copy-b"},
		[]string{"card-donkey"},
	)

	if got := canvasActionPositionCardIDs(canvasAction{Tool: "arrange_cards", Params: map[string]any{"positions": positions}}); !reflect.DeepEqual(got, []string{"copy-a", "copy-b"}) {
		t.Fatalf("position cardIds = %#v", got)
	}
	for _, raw := range positions {
		position, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("position = %#v", raw)
		}
		x, _ := position["x"].(float64)
		if x >= 3000 {
			t.Fatalf("copy position used remote outlier x=%v positions=%#v", x, positions)
		}
	}
	firstPosition := positions[0].(map[string]any)
	firstY, _ := firstPosition["y"].(float64)
	if firstY <= 1210 {
		t.Fatalf("first copy should be placed below the source card, y=%v positions=%#v", firstY, positions)
	}
}

func TestCanvasFallbackExplicitTextOverridesConfirmedRemoteCopy(t *testing.T) {
	canvas := canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey")
	remoteDonkey := func(id string, x float64, y float64) canvasCardSnapshot {
		source := *canvas.Cards[2].Asset
		return canvasCardSnapshot{
			ID:     id,
			Kind:   "asset",
			X:      x,
			Y:      y,
			Width:  320,
			Height: 379,
			Asset:  &source,
		}
	}
	canvas.Cards = append(
		canvas.Cards,
		remoteDonkey("card-remote-donkey-a", 5360, 0),
		remoteDonkey("card-remote-donkey-b", 5420, 360),
	)

	actions := fallbackCanvasManipulationActions(
		"把樹放大，樹下那隻驢子複製兩張，三張一起移到空的地方。",
		canvas,
		[]string{"card-remote-donkey-a"},
	)

	var resize, duplicate, arrange canvasAction
	for _, action := range actions {
		switch action.Tool {
		case "resize_card":
			resize = action
		case "duplicate_cards":
			duplicate = action
		case "arrange_cards":
			arrange = action
		}
	}
	if got := strings.TrimSpace(fmt.Sprint(resize.Params["cardId"])); got != "card-tree" {
		t.Fatalf("resize cardId = %q", got)
	}
	if got := canvasActionCardIDs(duplicate); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
	if got := canvasActionPositionCardIDs(arrange); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("arrange cardIds = %#v", got)
	}
}

func TestRefineCanvasActionTargetsUsesTextOverSelectedRemoteCopies(t *testing.T) {
	canvas := canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey")
	remoteDonkey := func(id string, x float64, y float64) canvasCardSnapshot {
		source := *canvas.Cards[2].Asset
		return canvasCardSnapshot{
			ID:     id,
			Kind:   "asset",
			X:      x,
			Y:      y,
			Width:  320,
			Height: 379,
			Asset:  &source,
		}
	}
	canvas.Cards = append(
		canvas.Cards,
		remoteDonkey("card-remote-donkey-a", 5360, 0),
		remoteDonkey("card-remote-donkey-b", 5420, 360),
	)
	canvas.SelectedCardIDs = []string{"card-remote-donkey-a", "card-remote-donkey-b"}
	actions := []canvasAction{
		{
			Tool: "duplicate_cards",
			Params: map[string]any{
				"cardIds": []any{"card-remote-donkey-a", "card-remote-donkey-b"},
				"count":   float64(2),
			},
		},
		{
			Tool: "arrange_cards",
			Params: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-remote-donkey-a", "x": float64(5960), "y": float64(0)},
				map[string]any{"cardId": "card-remote-donkey-b", "x": float64(6020), "y": float64(440)},
			}},
		},
	}

	refined := refineCanvasActionTargets(actions, canvas, "把樹放大，樹下那隻驢子複製兩張，三張一起移到空的地方。")

	if got := canvasActionCardIDs(refined[0]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
	if got := canvasActionPositionCardIDs(refined[1]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("arrange cardIds = %#v", got)
	}
}

func TestCanvasHarnessRefinesNativeSelectedRemoteCopyActions(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	canvas := canvasHarnessTreeDonkeySnapshot(bootstrap.assetA, bootstrap.assetB)
	remoteDonkey := func(id string, x float64, y float64) canvasCardSnapshot {
		source := *canvas.Cards[2].Asset
		return canvasCardSnapshot{
			ID:     id,
			Kind:   "asset",
			X:      x,
			Y:      y,
			Width:  320,
			Height: 379,
			Asset:  &source,
		}
	}
	canvas.Cards = append(
		canvas.Cards,
		remoteDonkey("card-remote-donkey-a", 5360, 0),
		remoteDonkey("card-remote-donkey-b", 5420, 360),
	)
	canvas.SelectedCardIDs = []string{"card-remote-donkey-a", "card-remote-donkey-b"}

	events, _ := runCanvasToolUseHarness(
		t,
		"把樹放大，樹下那隻驢子複製兩張，三張一起移到空的地方。",
		canvas,
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-remote-donkey-a", "label": "Remote donkey"}),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-remote-donkey-a", "label": "Remote donkey"}),
		canvasHarnessToolCalls(
			llm.ChatToolCall{Name: "select_cards", Arguments: map[string]any{"cardIds": []any{"card-remote-donkey-a", "card-remote-donkey-b"}, "label": "Remote donkeys"}},
			llm.ChatToolCall{Name: "duplicate_cards", Arguments: map[string]any{"cardIds": []any{"card-remote-donkey-a", "card-remote-donkey-b"}, "count": float64(2)}},
			llm.ChatToolCall{Name: "move_card", Arguments: map[string]any{"cardId": "card-remote-donkey-a", "x": float64(50), "y": float64(50)}},
		),
	)

	duplicateEvent := requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
	result, ok := duplicateEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("duplicate result = %#v", duplicateEvent["result"])
	}
	if got := canvasHarnessEventStringSlice(result["cardIds"]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
}

func TestRefineCanvasActionTargetsUsesFallbackLayoutTargets(t *testing.T) {
	canvas := canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey")
	canvas.Cards = append(canvas.Cards, canvasCardSnapshot{
		ID:         "card-cat",
		Kind:       "asset",
		X:          1320,
		Y:          960,
		Width:      320,
		Height:     320,
		LayerIndex: 4,
		Asset: &canvasAssetSnapshot{
			ID:                "asset-cat",
			RepoPath:          "monogatari_alice_cheshire_neko.png",
			Ext:               ".png",
			Width:             400,
			Height:            400,
			SearchTags:        []string{"cat"},
			SearchDescription: "A cat illustration that should not be touched.",
		},
	})
	actions := []canvasAction{
		{
			Tool: "resize_card",
			Params: map[string]any{
				"cardId": "card-cat",
				"width":  float64(640),
			},
		},
		{
			Tool: "duplicate_cards",
			Params: map[string]any{
				"cardIds": []any{"card-tree", "card-cat", "card-donkey"},
				"count":   float64(2),
			},
		},
		{
			Tool: "arrange_cards",
			Params: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-tree", "x": float64(1800), "y": float64(960)},
				map[string]any{"cardId": "card-cat", "x": float64(1800), "y": float64(1320)},
				map[string]any{"cardId": "card-donkey", "x": float64(1800), "y": float64(1680)},
			}},
		},
	}

	refined := refineCanvasActionTargets(actions, canvas, "把樹放大，然後樹下有一隻驢子。複製兩張也移到空的地方")

	if got := strings.TrimSpace(fmt.Sprint(refined[0].Params["cardId"])); got != "card-tree" {
		t.Fatalf("resize cardId = %q", got)
	}
	if got := canvasActionCardIDs(refined[1]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("duplicate cardIds = %#v", got)
	}
	if got := refined[1].Params["count"]; got != float64(2) {
		t.Fatalf("duplicate count = %#v", got)
	}
	if got := canvasActionPositionCardIDs(refined[2]); !reflect.DeepEqual(got, []string{"card-donkey"}) {
		t.Fatalf("arrange cardIds = %#v", got)
	}
}

func TestRefineCanvasImageVariantTargetsUsesClauseTargets(t *testing.T) {
	canvas := canvasHarnessTreeDonkeySnapshot("asset-tree", "asset-donkey")
	actions := []canvasAction{
		{
			Tool: "rotate_image",
			Params: map[string]any{
				"assetIds": []any{"asset-tree", "asset-donkey", "asset-family", "asset-fish-book"},
				"degrees":  float64(180),
			},
		},
		{
			Tool: "mirror_image",
			Params: map[string]any{
				"assetIds": []any{"asset-tree", "asset-donkey", "asset-family", "asset-fish-book"},
				"flip":     "horizontal",
			},
		},
	}

	refined := refineCanvasImageVariantTargets(
		actions,
		canvas,
		"旋轉封面是魚的書 把 family 鏡像處理",
	)

	if got := canvasActionAssetIDs(refined[0]); !reflect.DeepEqual(got, []string{"asset-fish-book"}) {
		t.Fatalf("rotate assetIds = %#v", got)
	}
	if got := refined[0].Params["degrees"]; got != float64(90) {
		t.Fatalf("rotate degrees = %#v", got)
	}
	if got := canvasActionAssetIDs(refined[1]); !reflect.DeepEqual(got, []string{"asset-family"}) {
		t.Fatalf("mirror assetIds = %#v", got)
	}
}

func TestRefineCanvasActionTargetsDropsUnmentionedArrangeCards(t *testing.T) {
	canvas := canvasHarnessGenericRecoverySnapshot()
	actions := []canvasAction{
		{
			Tool: "arrange_cards",
			Params: map[string]any{"positions": []any{
				map[string]any{"cardId": "card-primary", "x": float64(1200), "y": float64(960)},
				map[string]any{"cardId": "card-secondary", "x": float64(1200), "y": float64(1320)},
				map[string]any{"cardId": "card-decoy", "x": float64(1200), "y": float64(1680)},
			}},
		},
	}

	refined := refineCanvasActionTargets(actions, canvas, "resize primary-subject and move secondary-subject to empty space")

	if len(refined) != 1 {
		t.Fatalf("refined actions = %#v", refined)
	}
	got := canvasActionPositionCardIDs(refined[0])
	if !reflect.DeepEqual(got, []string{"card-primary", "card-secondary"}) {
		t.Fatalf("position card IDs = %#v", got)
	}
}

func TestRefineCanvasActionTargetsDropsUnmentionedConfirmedFallbackTargets(t *testing.T) {
	canvas := canvasHarnessGenericRecoverySnapshot()
	actions := fallbackCanvasManipulationActions(
		"primary-subject and secondary-subject. duplicate two copies to empty space",
		canvas,
		[]string{"card-primary", "card-secondary", "card-decoy"},
	)
	requireCanvasActionTool(t, actions, "duplicate_cards")

	for _, action := range actions {
		for _, id := range canvasActionCardIDs(action) {
			if id == "card-decoy" {
				t.Fatalf("decoy card leaked through %s params=%#v", action.Tool, action.Params)
			}
		}
		for _, id := range canvasActionPositionCardIDs(action) {
			if id == "card-decoy" {
				t.Fatalf("decoy position leaked through %s params=%#v", action.Tool, action.Params)
			}
		}
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

func TestCanvasHarnessFallbackCompletesMissingToolsAfterPartialNativeActions(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	events, _ := runCanvasToolUseHarness(
		t,
		"把樹放大，然後樹下有一隻驢子。複製兩張也移到空的地方 旋轉封面是魚的書 把 family 鏡像處理",
		canvasHarnessTreeDonkeySnapshot(bootstrap.assetA, bootstrap.assetB),
		canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-tree", "label": "Tree card"}),
		canvasHarnessToolCalls(
			llm.ChatToolCall{
				Name: "select_cards",
				Arguments: map[string]any{
					"cardIds": []any{"card-tree", "card-donkey"},
					"label":   "Tree and donkey group",
				},
			},
			llm.ChatToolCall{
				Name: "duplicate_cards",
				Arguments: map[string]any{
					"cardIds": []any{"card-tree", "card-donkey"},
					"count":   float64(1),
					"label":   "Duplicate confirmed group",
				},
			},
			llm.ChatToolCall{
				Name: "mirror_image",
				Arguments: map[string]any{
					"assetIds":     []any{"asset-family"},
					"flip":         "horizontal",
					"outputFormat": "png",
				},
			},
		),
	)

	requireCanvasHarnessEvent(t, events, "action_result", "duplicate_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "mirror_image")
	requireCanvasHarnessEvent(t, events, "action_result", "resize_card")
	requireCanvasHarnessEvent(t, events, "action_result", "arrange_cards")
	requireCanvasHarnessEvent(t, events, "action_result", "rotate_image")

	duplicateCount := 0
	mirrorCount := 0
	for _, event := range events {
		if event["type"] == "action_result" && event["tool"] == "duplicate_cards" {
			duplicateCount++
		}
		if event["type"] == "action_result" && event["tool"] == "mirror_image" {
			mirrorCount++
		}
	}
	if duplicateCount != 1 {
		t.Fatalf("duplicate_cards event count = %d", duplicateCount)
	}
	if mirrorCount != 1 {
		t.Fatalf("mirror_image action_result count = %d", mirrorCount)
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

package server

import (
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/scanner"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

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
	requireCanvasHarnessToolChoice(t, requests[0], "required")
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

func TestCanvasSearchAssetsFallsBackToSemanticSearch(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	embedModel := "fixture-embed"
	if _, err := bootstrap.server.store.UpdateSettings(config.SettingsUpdate{LLMEmbedModel: &embedModel}); err != nil {
		t.Fatal(err)
	}
	scanID := bootstrap.server.latestScanID()
	for _, entry := range []struct {
		id     string
		vector []float32
	}{
		{id: bootstrap.assetA, vector: []float32{1, 0}},
		{id: bootstrap.assetB, vector: []float32{0, 1}},
	} {
		item, err := bootstrap.server.store.CatalogItem(scanID, entry.id)
		if err != nil {
			t.Fatal(err)
		}
		err = bootstrap.server.store.UpsertEmbedding(config.EmbeddingResult{
			AssetID:       item.ID,
			ProjectID:     item.ProjectID,
			RepoPath:      item.RepoPath,
			ContentHash:   item.ContentHash,
			HashAlgorithm: item.HashAlgorithm,
			EmbedType:     "text",
			ProviderName:  "ollama",
			ModelName:     embedModel,
			Dimensions:    2,
			Status:        "ready",
		}, entry.vector)
		if err != nil {
			t.Fatal(err)
		}
	}
	settings, err := bootstrap.server.store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	result := bootstrap.server.executeCanvasSafeAction(
		httptest.NewRequest(http.MethodPost, "/api/ai/canvas/chat", nil),
		canvasAction{Tool: "search_assets", Params: map[string]any{"q": "semantic visual query", "limit": float64(1)}},
		settings,
		canvasSnapshot{},
	).(map[string]any)
	items, ok := result["items"].([]scanner.AssetItem)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v", result["items"])
	}
	if items[0].ID != bootstrap.assetA {
		t.Fatalf("semantic result asset = %q, want %q", items[0].ID, bootstrap.assetA)
	}
	if result["matchType"] != "semantic" {
		t.Fatalf("matchType = %#v, want semantic", result["matchType"])
	}
}

func TestExpandCanvasCatalogSearchCandidatesAddsLogoSynonyms(t *testing.T) {
	got := expandCanvasCatalogSearchCandidates([]string{"logo"})
	wantOrder := []string{"logo", "mark", "symbol", "icon", "badge", "emblem", "brand", "favicon"}
	if len(got) < len(wantOrder) {
		t.Fatalf("expanded candidates = %#v, want at least %#v", got, wantOrder)
	}
	for i, want := range wantOrder {
		if got[i] != want {
			t.Fatalf("expanded candidates = %#v, want %q at index %d", got, want, i)
		}
	}
}

func TestCanvasSearchAssetsShowsLogoCandidatesForConfirmation(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	writePNG(t, filepath.Join(bootstrap.root, "img", "app_icon.png"))
	iconAsset := serverScanAsset(bootstrap.root, "img/app_icon.png", 5000, "hash-icon", 0)
	if _, err := bootstrap.server.store.RecordScan(scanner.Catalog{
		GeneratedAt: "2026-05-14T01:00:00Z",
		Projects:    []scanner.Project{{ID: "p", Name: "fixture", Path: bootstrap.root}},
		Items:       []scanner.AssetItem{iconAsset},
		Stats:       scanner.CatalogStats{TotalFiles: 1},
	}); err != nil {
		t.Fatal(err)
	}
	settings, err := bootstrap.server.store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	result := bootstrap.server.executeCanvasSafeAction(
		httptest.NewRequest(http.MethodPost, "/api/ai/canvas/chat", nil),
		canvasAction{Tool: "search_assets", Params: map[string]any{"q": "logo", "limit": float64(3)}},
		settings,
		canvasSnapshot{},
	).(map[string]any)
	if needs, _ := result["needsUserConfirmation"].(bool); !needs {
		t.Fatalf("needsUserConfirmation = %#v, want true; result=%#v", result["needsUserConfirmation"], result)
	}
	items, ok := result["items"].([]scanner.AssetItem)
	if !ok || len(items) != 0 {
		t.Fatalf("items = %#v, want no auto-add items", result["items"])
	}
	candidates, ok := result["candidatePreviews"].([]scanner.AssetItem)
	if !ok || len(candidates) != 1 {
		t.Fatalf("candidatePreviews = %#v, want 1 candidate", result["candidatePreviews"])
	}
	if candidates[0].ID != iconAsset.ID {
		t.Fatalf("candidate asset = %q, want %q", candidates[0].ID, iconAsset.ID)
	}
	if result["matchType"] != "catalog_candidate" {
		t.Fatalf("matchType = %#v, want catalog_candidate", result["matchType"])
	}
}

func TestCanvasSearchAssetsCanListTextBearingImages(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
		bootstrap.assetB: "",
	})
	settings, err := bootstrap.server.store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	result := bootstrap.server.executeCanvasSafeAction(
		httptest.NewRequest(http.MethodPost, "/api/ai/canvas/chat", nil),
		canvasAction{Tool: "search_assets", Params: map[string]any{"q": "text", "limit": float64(12), "hasText": true}},
		settings,
		canvasSnapshot{},
	).(map[string]any)
	items, ok := result["items"].([]scanner.AssetItem)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v", result["items"])
	}
	if items[0].ID != bootstrap.assetA {
		t.Fatalf("text-bearing asset = %q, want %q", items[0].ID, bootstrap.assetA)
	}
	if items[0].OCR == nil || items[0].OCR.Text != "SALE" {
		t.Fatalf("OCR text missing from result: %#v", items[0].OCR)
	}
	if result["hasText"] != true {
		t.Fatalf("hasText = %#v, want true", result["hasText"])
	}
}

func TestCanvasHarnessNormalizesGenericTextSearchToOCRFilter(t *testing.T) {
	bootstrap := newCanvasToolUseHarness(t)
	seedCanvasHarnessVLMOCR(t, bootstrap, map[string]string{
		bootstrap.assetA: "SALE",
		bootstrap.assetB: "",
	})
	bootstrap.provider.responses = []llm.ChatResponse{
		canvasHarnessToolCall("search_assets", map[string]any{"q": "text", "limit": float64(12)}),
		canvasHarnessText("Done."),
	}

	events := runCanvasToolUseHarnessWithHarness(
		t,
		bootstrap,
		"Show assets that contain visible text.",
		canvasSnapshot{},
	)
	searchEvent := requireCanvasHarnessEvent(t, events, "action_result", "search_assets")
	searchResult, ok := searchEvent["result"].(map[string]any)
	if !ok {
		t.Fatalf("search result = %#v", searchEvent["result"])
	}
	if searchResult["hasText"] != true {
		t.Fatalf("generic text search should be normalized to hasText=true: %#v", searchResult["hasText"])
	}
	items, ok := searchResult["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("generic text search should exclude empty OCR, items = %#v", searchResult["items"])
	}
}

func TestCanvasHarnessNonEnglishValidationMatrixGetsRequiredNativeTools(t *testing.T) {
	cases := []struct {
		name  string
		input string
		tools []string
	}{
		{
			name:  "search add row",
			input: "幫我搜尋 logo 相關素材，加入最相關的 3 張到畫布，排成一列。",
			tools: []string{"search_assets", "add_assets_to_canvas", "arrange_cards"},
		},
		{
			name:  "detail before add",
			input: "找出一張尺寸最大的 banner 圖，先看詳細資料，再加到畫布旁邊。",
			tools: []string{"search_assets", "get_asset_detail", "add_assets_to_canvas"},
		},
		{
			name:  "selected layout",
			input: "把目前選取的所有卡片平均水平排列，並讓上緣對齊。",
			tools: []string{"select_cards", "distribute_cards", "align_cards"},
		},
		{
			name:  "hero layer",
			input: "把主圖放大，移到中間，然後放到其他圖的最上層。",
			tools: []string{"focus_card", "resize_card", "move_card", "arrange_cards", "bring_cards_to_front"},
		},
		{
			name:  "duplicate cleanup",
			input: "把目前選取的圖各複製兩張，放到空白區；如果多出不相關的候選圖就移除。",
			tools: []string{"duplicate_cards", "arrange_cards", "remove_cards"},
		},
		{
			name:  "ocr",
			input: "讀出目前選取圖片裡的文字，只回答文字，不要寫回 metadata。",
			tools: []string{"extract_ocr_text"},
		},
		{
			name:  "annotation",
			input: "幫我在這張圖需要注意的地方留一個註解，標出可讀性問題。",
			tools: []string{"focus_card", "create_comment"},
		},
		{
			name:  "capture",
			input: "幫我截目前 viewport；再截目前選取的圖片區域，背景透明。",
			tools: []string{"capture_viewport", "capture_selected"},
		},
		{
			name:  "quality alt text",
			input: "比較這兩張圖是否相似，檢查品質問題，最後替第一張產生 alt text。",
			tools: []string{"compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text"},
		},
		{
			name:  "variant and proposal",
			input: "把封面是書的那張旋轉 90 度，family 做水平鏡像，另外把 family 檔名改短一點。",
			tools: []string{"rotate_image", "mirror_image", "rename_asset"},
		},
		{
			name:  "advanced text assets annotate and copy",
			input: "請幫我把所有有文字的圖展示出來，且要平均擺放在畫布上，並用註解把文字的地方圈起來說明他寫了什麼，然後最後把這些檔案複製一份後用文字內容作為檔名",
			tools: []string{"search_assets", "add_assets_to_canvas", "arrange_cards", "create_comment", "copy_asset"},
		},
		{
			name:  "photo staging and capture",
			input: "請你像專業攝影師一樣幫我把畫布上的所有圖片擺拍得漂亮一點，最後幫我截圖。",
			tools: []string{"focus_card", "select_cards", "inspect_canvas", "resize_card", "arrange_cards", "capture_canvas"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bootstrap := newCanvasToolUseHarness(t)
			_, provider := runCanvasToolUseHarness(
				t,
				tc.input,
				canvasHarnessSnapshot(bootstrap.assetA, bootstrap.assetB, "card-a", "card-b"),
				canvasHarnessToolCall("focus_card", map[string]any{"cardId": "card-a"}),
			)
			requests := provider.Requests()
			if len(requests) == 0 {
				t.Fatal("provider received no requests")
			}
			requireCanvasHarnessToolChoice(t, requests[0], "required")
			requireCanvasHarnessRequestTools(t, requests[0], tc.tools...)
		})
	}
}

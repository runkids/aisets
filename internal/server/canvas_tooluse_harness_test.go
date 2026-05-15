package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"aisets/internal/agent"
	"aisets/internal/aitag"
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/ocr"
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

type canvasHarnessAgentProvider struct {
	mu       sync.Mutex
	result   agent.ChatResult
	results  []agent.ChatResult
	index    int
	requests []agent.ChatRequest
}

func (p *canvasHarnessAgentProvider) ChatBatch(_ context.Context, reqs []agent.ChatRequest, onResult func(int, agent.ChatResult)) error {
	p.mu.Lock()
	p.requests = append(p.requests, reqs...)
	result := p.result
	if len(p.results) > 0 {
		result = p.results[min(p.index, len(p.results)-1)]
		p.index++
	}
	p.mu.Unlock()
	for i := range reqs {
		onResult(i, result)
	}
	return nil
}

func (p *canvasHarnessAgentProvider) Requests() []agent.ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]agent.ChatRequest, len(p.requests))
	copy(out, p.requests)
	return out
}

func (p *canvasHarnessAgentProvider) Close() error { return nil }

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
	events := runCanvasToolUseHarnessWithHarness(t, h, message, snapshot)
	return events, h.provider
}

func runCanvasToolUseHarnessWithHarness(t *testing.T, h canvasToolUseHarness, message string, snapshot canvasSnapshot) []canvasHarnessEvent {
	t.Helper()
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
	return decodeCanvasHarnessEvents(t, rec.Body.String())
}

func seedCanvasHarnessVLMOCR(t *testing.T, h canvasToolUseHarness, texts map[string]string) {
	t.Helper()
	scanID := h.server.latestScanID()
	if scanID == 0 {
		t.Fatal("missing scan")
	}
	for assetID, text := range texts {
		item, err := h.server.store.CatalogItem(scanID, assetID)
		if err != nil {
			t.Fatal(err)
		}
		if err := h.server.store.UpsertOCRResult(ocr.Result{
			ProjectID:     item.ProjectID,
			RepoPath:      item.RepoPath,
			ContentHash:   item.ContentHash,
			HashAlgorithm: item.HashAlgorithm,
			EngineName:    "vlm",
			EngineVersion: "ollama/fixture-vlm",
			SettingsHash:  vlmOCRSettingsHash("fixture-vlm"),
			Status:        ocr.StatusReady,
			Text:          text,
			Languages:     []string{"en"},
		}); err != nil {
			t.Fatal(err)
		}
	}
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

func requireCanvasHarnessToolEventOrder(t *testing.T, events []canvasHarnessEvent, tools ...string) {
	t.Helper()
	index := 0
	for _, event := range events {
		if event["type"] != "action_result" || event["tool"] != tools[index] {
			continue
		}
		index++
		if index == len(tools) {
			return
		}
	}
	t.Fatalf("missing ordered action_result tools %v in %#v", tools, events)
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

func requireCanvasHarnessRequestTools(t *testing.T, req llm.ChatRequest, names ...string) {
	t.Helper()
	for _, name := range names {
		requireCanvasHarnessRequestTool(t, req, name)
	}
}

func requireCanvasHarnessToolRequiredParams(t *testing.T, req llm.ChatRequest, name string, params ...string) {
	t.Helper()
	for _, tool := range req.Tools {
		if tool.Name != name {
			continue
		}
		required := map[string]bool{}
		for _, key := range canvasSchemaRequired(tool.Parameters) {
			required[key] = true
		}
		for _, param := range params {
			if !required[param] {
				t.Fatalf("tool %s required params = %#v, missing %s", name, required, param)
			}
		}
		return
	}
	t.Fatalf("request missing tool %s in %#v", name, req.Tools)
}

func requireCanvasHarnessToolChoice(t *testing.T, req llm.ChatRequest, want string) {
	t.Helper()
	if req.ToolChoice != want {
		t.Fatalf("tool choice = %q, want %q", req.ToolChoice, want)
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

func writeCanvasRegionFixturePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	for y := 12; y < 38; y++ {
		for x := 38; x < 58; x++ {
			img.Set(x, y, color.NRGBA{R: 20, G: 25, B: 32, A: 255})
		}
	}
	for y := 12; y < 38; y++ {
		for x := 50; x < 66; x++ {
			img.Set(x, y, color.NRGBA{R: 242, G: 106, B: 160, A: 255})
		}
	}
	for y := 21; y < 28; y++ {
		for x := 32; x < 39; x++ {
			img.Set(x, y, color.NRGBA{R: 242, G: 106, B: 160, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeCanvasTextRegionFixturePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	// Non-text white headband near the wrong model-provided region.
	for y := 42; y < 57; y++ {
		for x := 32; x < 68; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	// Three white glyph-like components on a sign far from the wrong region.
	for y := 16; y < 30; y++ {
		for x := 82; x < 96; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 42; y < 62; y++ {
		for x := 80; x < 100; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 76; y < 84; y++ {
		for x := 82; x < 99; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeCanvasRedTextWithWhiteDistractorPNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	// Wrong-color distractor that should not win when the model guesses white text.
	for y := 58; y < 75; y++ {
		for x := 34; x < 48; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 58; y < 75; y++ {
		for x := 54; x < 68; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	// Tall spine-like decoration must not be mistaken for the title text.
	for _, top := range []int{12, 25, 38, 51, 64, 77, 90} {
		for y := top; y < top+5; y++ {
			for x := 5; x < 11; x++ {
				img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
			}
		}
	}
	// Same-color non-text artwork below the title must not be merged into the text box.
	for y := 64; y < 94; y++ {
		for x := 50; x < 78; x++ {
			img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
		}
	}
	// Red glyph-like title components near the top of the image.
	for _, left := range []int{24, 39, 54, 69} {
		for y := 16; y < 39; y++ {
			for x := left; x < left+11; x++ {
				img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
			}
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
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
		return map[string]any{"commentCardId": "comment-a", "text": "Updated note", "region": map[string]any{"x": 0.2, "y": 0.3, "width": 0.4, "height": 0.2}}
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

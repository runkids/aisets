package server

import (
	"aisets/internal/agent"
	"aisets/internal/aitag"
	"aisets/internal/config"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

type canvasToolUseScriptedProvider struct {
	fakeEmbedProvider
	mu        sync.Mutex
	responses []llm.ChatResponse
	requests  []llm.ChatRequest
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

func canvasHarnessSnapshotWithThirdImage(assetA, assetB string, selected ...string) canvasSnapshot {
	snapshot := canvasHarnessSnapshot(assetA, assetB, selected...)
	third := canvasCardSnapshot{
		ID:         "card-c",
		Kind:       "asset",
		X:          550,
		Y:          20,
		Width:      220,
		Height:     160,
		LayerIndex: 2,
		Asset: &canvasAssetSnapshot{
			ID:          assetA,
			RepoPath:    "img/c.png",
			Ext:         ".png",
			Width:       8,
			Height:      8,
			Bytes:       7000,
			Tags:        []string{"gamma"},
			Description: "Third test asset",
			UsedByCount: 0,
		},
	}
	cards := make([]canvasCardSnapshot, 0, len(snapshot.Cards)+1)
	cards = append(cards, snapshot.Cards[:2]...)
	cards = append(cards, third)
	cards = append(cards, snapshot.Cards[2:]...)
	snapshot.Cards = cards
	return snapshot
}

func canvasHarnessSnapshotWithManyImages(assetA, assetB string, count int) canvasSnapshot {
	snapshot := canvasHarnessSnapshot(assetA, assetB)
	snapshot.Cards = make([]canvasCardSnapshot, 0, count)
	for i := 0; i < count; i++ {
		assetID := assetA
		tags := []string{"breakfast", "prop", fmt.Sprintf("group-%02d", i%4)}
		if i%2 == 1 {
			assetID = assetB
			tags = []string{"room", "lifestyle", fmt.Sprintf("group-%02d", i%4)}
		}
		snapshot.Cards = append(snapshot.Cards, canvasCardSnapshot{
			ID:         fmt.Sprintf("card-%02d", i),
			Kind:       "asset",
			X:          float64((i % 5) * 280),
			Y:          float64((i / 5) * 220),
			Width:      220,
			Height:     160,
			LayerIndex: i,
			Asset: &canvasAssetSnapshot{
				ID:                assetID,
				FileName:          fmt.Sprintf("staging_%02d.png", i),
				RepoPath:          fmt.Sprintf("img/staging_%02d.png", i),
				Ext:               ".png",
				Width:             180,
				Height:            180,
				Bytes:             int64(30000 + i),
				SearchCategory:    "lifestyle",
				SearchTags:        tags,
				SearchDescription: fmt.Sprintf("Photo staging candidate %02d with visual role and scene hints for the composition.", i),
				OcrText:           fmt.Sprintf("label %02d", i),
			},
		})
	}
	return snapshot
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
	return runCanvasToolUseHarnessWithHarnessAndSkills(t, h, message, snapshot, nil)
}

func runCanvasToolUseHarnessWithHarnessAndSkills(t *testing.T, h canvasToolUseHarness, message string, snapshot canvasSnapshot, selectedSkillIDs []string) []canvasHarnessEvent {
	t.Helper()
	if len(snapshot.Cards) == 0 {
		snapshot = canvasHarnessSnapshot(h.assetA, h.assetB)
	}
	body, err := json.Marshal(canvasChatRequest{
		Messages:         []canvasChatMessage{{Role: "user", Content: message}},
		Canvas:           snapshot,
		Locale:           "en",
		SelectedSkillIDs: selectedSkillIDs,
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

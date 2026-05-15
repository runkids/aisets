package server

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"aisets/internal/aitag"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

type roundStatsProvider struct {
	fakeEmbedProvider
}

func (roundStatsProvider) Chat(context.Context, llm.ChatRequest) (llm.ChatResponse, error) {
	return llm.ChatResponse{
		Content:      "ok",
		InputTokens:  3,
		OutputTokens: 4,
		DurationMs:   5,
		ToolCalls:    []llm.ChatToolCall{{Name: "search_assets"}},
	}, nil
}

func TestParseCanvasActions_PlainText(t *testing.T) {
	text, actions := parseCanvasActions("This is a plain text response with no actions.")
	if len(actions) != 0 {
		t.Fatalf("expected 0 actions, got %d", len(actions))
	}
	if text != "This is a plain text response with no actions." {
		t.Fatalf("unexpected text: %q", text)
	}
}

func TestParseCanvasActions_SingleAction(t *testing.T) {
	input := "Let me check this.\n```action\n{\"tool\": \"focus_card\", \"params\": {\"cardId\": \"asset-1\", \"label\": \"Looking...\"}, \"description\": \"Focus\", \"impact\": \"none\"}\n```\nHere is the result."
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(actions))
	}
	if actions[0].Tool != "focus_card" {
		t.Fatalf("expected focus_card, got %s", actions[0].Tool)
	}
	if !strings.Contains(text, "Let me check this") || !strings.Contains(text, "Here is the result") {
		t.Fatalf("text should contain surrounding prose: %q", text)
	}
	if strings.Contains(text, "focus_card") {
		t.Fatal("text should not contain action block content")
	}
}

func TestParseCanvasActions_MultipleActions(t *testing.T) {
	input := "I'll analyze and compress.\n```action\n{\"tool\": \"focus_card\", \"params\": {\"cardId\": \"a1\"}, \"description\": \"d\", \"impact\": \"i\"}\n```\nLooks like a large PNG.\n```action\n{\"tool\": \"compress_image\", \"params\": {\"assetId\": \"x\", \"outputFormat\": \"webp\"}, \"description\": \"Compress\", \"impact\": \"60% smaller\"}\n```\nDone."
	text, actions := parseCanvasActions(input)
	if len(actions) != 2 {
		t.Fatalf("expected 2 actions, got %d", len(actions))
	}
	if actions[0].Tool != "focus_card" {
		t.Fatalf("first action: expected focus_card, got %s", actions[0].Tool)
	}
	if actions[1].Tool != "compress_image" {
		t.Fatalf("second action: expected compress_image, got %s", actions[1].Tool)
	}
	if actions[1].Impact != "60% smaller" {
		t.Fatalf("second action impact: %q", actions[1].Impact)
	}
	if strings.Contains(text, "compress_image") {
		t.Fatal("text should not contain action JSON")
	}
}

func TestCanvasActionBlockLikelyTruncated(t *testing.T) {
	if !canvasActionBlockLikelyTruncated("intro\n```action\n{\"tool\": \"arrange_cards\", \"params\": {") {
		t.Fatal("expected truncated action block")
	}
	if canvasActionBlockLikelyTruncated("```action\n{broken}\n```") {
		t.Fatal("closed action block should not be treated as truncated")
	}
	if canvasActionBlockLikelyTruncated("plain text") {
		t.Fatal("plain text should not be treated as truncated")
	}
}

func TestParseCanvasActions_BadJSON(t *testing.T) {
	input := "Here:\n```action\n{invalid json\n```\nStill works."
	text, actions := parseCanvasActions(input)
	if len(actions) != 0 {
		t.Fatalf("expected 0 actions from bad JSON, got %d", len(actions))
	}
	if !strings.Contains(text, "Still works") {
		t.Fatalf("text should contain surrounding prose: %q", text)
	}
}

func TestParseCanvasActions_MixedGoodBadBlocks(t *testing.T) {
	input := "```action\n{\"tool\": \"focus_card\", \"params\": {}, \"description\": \"\", \"impact\": \"\"}\n```\n```action\n{broken\n```\n```action\n{\"tool\": \"search_assets\", \"params\": {\"q\": \"icon\"}, \"description\": \"search\", \"impact\": \"\"}\n```"
	_, actions := parseCanvasActions(input)
	if len(actions) != 2 {
		t.Fatalf("expected 2 valid actions, got %d", len(actions))
	}
	if actions[0].Tool != "focus_card" || actions[1].Tool != "search_assets" {
		t.Fatalf("unexpected tools: %s, %s", actions[0].Tool, actions[1].Tool)
	}
}

func TestCanvasToolSafe(t *testing.T) {
	safes := []string{"focus_card", "search_assets", "create_comment", "select_cards", "remove_cards", "move_card", "arrange_cards", "resize_card", "bring_cards_to_front", "inspect_canvas", "capture_viewport", "capture_canvas", "capture_selected", "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image"}
	for _, name := range safes {
		if !canvasToolSafe(name) {
			t.Errorf("%s should be safe", name)
		}
	}
	unsafes := []string{"update_tags", "update_description", "update_ocr_text"}
	for _, name := range unsafes {
		if canvasToolSafe(name) {
			t.Errorf("%s should NOT be safe", name)
		}
	}
	if canvasToolSafe("nonexistent") {
		t.Error("unknown tool should not be safe")
	}
}

func TestCanvasToolSuppressesSameTurnText(t *testing.T) {
	if canvasToolSuppressesSameTurnText("focus_card") {
		t.Fatal("focus_card should allow the same-turn assistant text to render")
	}
	for _, tool := range []string{"search_assets", "extract_ocr_text", "compress_image"} {
		if !canvasToolSuppressesSameTurnText(tool) {
			t.Fatalf("%s should suppress same-turn assistant text", tool)
		}
	}
}

func TestFilterCanvasIncidentalCatalogSearchActionsKeepsImageOperation(t *testing.T) {
	actions := filterCanvasIncidentalCatalogSearchActions([]canvasAction{
		{Tool: "compress_image", Params: map[string]any{"assetIds": []any{"asset-a"}}},
		{Tool: "search_assets", Params: map[string]any{"q": "png"}},
	})
	if len(actions) != 1 || actions[0].Tool != "compress_image" {
		t.Fatalf("actions = %#v", actions)
	}

	actions = filterCanvasIncidentalCatalogSearchActions([]canvasAction{
		{Tool: "search_assets", Params: map[string]any{"q": "cat"}},
	})
	if len(actions) != 1 || actions[0].Tool != "search_assets" {
		t.Fatalf("search-only actions should be preserved: %#v", actions)
	}
}

func TestCanvasSystemPrompt_ImageOptimizationAdviceOffRestrictsProposals(t *testing.T) {
	prompt := canvasSystemPrompt("zh-TW", canvasChatOptions{ImageOptimizationAdvice: false})
	for _, want := range []string{
		"Image optimization advice is OFF",
		"Do NOT proactively call image variant tools",
		"Use image/file tools only",
		"latest request explicitly asks",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, forbidden := range []string{
		"Proposes concrete actions (compress, tag, rename) proactively",
		"The existing tags are generic — let me suggest better ones",
		"This is a 640×480 PNG at 58KB. It's large for an icon",
	} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("prompt still contains proactive proposal wording %q:\n%s", forbidden, prompt)
		}
	}
}

func TestCanvasSystemPrompt_AutoLocaleUsesBuiltInLanguages(t *testing.T) {
	cases := map[string]string{
		"en":    "Only natural-language assistant text should be written in English",
		"zh-TW": "Only natural-language assistant text should be written in Traditional Chinese",
		"zh-CN": "Only natural-language assistant text should be written in Simplified Chinese",
		"ja":    "Only natural-language assistant text should be written in Japanese",
		"ko":    "Only natural-language assistant text should be written in Korean",
	}
	for locale, want := range cases {
		prompt := canvasSystemPrompt(locale, canvasChatOptions{AutoLocale: true})
		if !strings.Contains(prompt, want) {
			t.Fatalf("%s prompt missing %q:\n%s", locale, want, prompt)
		}
	}
}

func TestCanvasSystemPrompt_EnglishInstructionsAvoidChineseAliases(t *testing.T) {
	for _, locale := range []string{"en", "zh-TW", "zh-CN", "ja", "ko"} {
		prompt := canvasSystemPrompt(locale, canvasChatOptions{AutoLocale: true})
		if hanTextRe.MatchString(prompt) {
			t.Fatalf("%s canvas system prompt should not contain Chinese aliases:\n%s", locale, prompt)
		}
	}
}

func TestCanvasSystemPrompt_AutoLocaleOffUsesEnglish(t *testing.T) {
	prompt := canvasSystemPrompt("zh-TW", canvasChatOptions{AutoLocale: false})
	if !strings.Contains(prompt, "Only natural-language assistant text should be written in English") {
		t.Fatalf("prompt should default to English when auto locale is off:\n%s", prompt)
	}
}

func TestCanvasSystemPrompt_ImageOptimizationAdviceOnAllowsOptimizationProposals(t *testing.T) {
	prompt := canvasSystemPrompt("en", canvasChatOptions{ImageOptimizationAdvice: true})
	for _, want := range []string{
		"Image optimization advice is ON",
		"proactively inspect selected or visible image assets",
		"compress_image, resize_image, or convert_image",
		"generate new preview images",
		"metadata or file-writing proposals",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasUserPrompt_ImageOptimizationAdviceOff(t *testing.T) {
	prompt := buildCanvasUserPrompt([]canvasChatMessage{{Role: "user", Content: "看看這張圖"}}, canvasSnapshot{}, canvasChatOptions{ImageOptimizationAdvice: false}, "zh-TW")
	if !strings.Contains(prompt, "Image optimization advice is OFF") {
		t.Fatalf("prompt should include OFF state:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Do not proactively call compression, resizing, format conversion, mirroring, or rotation") {
		t.Fatalf("prompt should restrict proactive optimization:\n%s", prompt)
	}
}

func TestBuildCanvasUserPrompt_IncludesCanvasScale(t *testing.T) {
	prompt := buildCanvasUserPrompt([]canvasChatMessage{{Role: "user", Content: "幫我移動這張到右邊"}}, canvasSnapshot{}, canvasChatOptions{}, "zh-TW")
	for _, want := range []string{"100px is a small nudge", "200-350px is a nearby move", "600px+ is a large jump"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasUserPrompt_UsesLatestUserLanguage(t *testing.T) {
	prompt := buildCanvasUserPrompt([]canvasChatMessage{{Role: "user", Content: "再幫我找一張類似家庭照的 family_danran.png"}}, canvasSnapshot{}, canvasChatOptions{}, "en")
	if !strings.Contains(prompt, "Use Traditional Chinese only for natural-language assistant text") {
		t.Fatalf("prompt should override to latest user language:\n%s", prompt)
	}
}

func TestCanvasSearchQueryCandidates(t *testing.T) {
	got := canvasSearchQueryCandidates("再幫我找一張類似家庭照的 family_danran.png")
	want := []string{"再幫我找一張類似家庭照的 family_danran.png", "family_danran"}
	if len(got) < len(want) {
		t.Fatalf("candidates = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate %d = %q, want %q; all=%#v", i, got[i], want[i], got)
		}
	}

	got = canvasSearchQueryCandidates("類似家庭照 family_danran")
	if len(got) < 2 || got[1] != "family_danran" {
		t.Fatalf("stem-only candidates = %#v", got)
	}

	got = canvasSearchQueryCandidates("search cat or kitten related assets, add the most relevant 2 cards to the canvas, then arrange them in a row.")
	if !stringSliceContains(got, "cat") || !stringSliceContains(got, "kitten") {
		t.Fatalf("catalog search candidates should include requested query terms: %#v", got)
	}
}

func TestClassifyCanvasSkillFamilies_UnknownLanguageUsesCompactDefault(t *testing.T) {
	got := classifyCanvasSkillFamilies(canvasSkillClassifyInput{Message: "請處理這些圖片"})
	want := []string{
		canvasSkillLayout,
		canvasSkillSearch,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("default skills = %#v, want %#v", got, want)
	}
	for _, unwanted := range []string{canvasSkillCapture, canvasSkillFileProposals, canvasSkillComments, canvasSkillMetadataProposals} {
		if canvasStringListContains(got, unwanted) {
			t.Fatalf("default skills should stay compact; unexpected %s in %#v", unwanted, got)
		}
	}
	tools := canvasSkillToolNames(got)
	for _, wantTool := range []string{"search_assets", "add_assets_to_canvas"} {
		if !canvasStringListContains(tools, wantTool) {
			t.Fatalf("default tools = %#v, missing %s", tools, wantTool)
		}
	}
}

func TestCanvasNativeToolsDisabledForAgentBackends(t *testing.T) {
	tools := canvasLLMToolsForSkills([]string{canvasSkillSearch})
	if canvasNativeToolsEnabled("agent:codex", tools) {
		t.Fatal("agent backends do not receive native tool schemas and should use action-block prompts")
	}
	if !canvasNativeToolsEnabled("ollama", tools) {
		t.Fatal("non-agent backends with tools should use native tool schemas")
	}
	if canvasNativeToolsEnabled("ollama", nil) {
		t.Fatal("empty tool list should not enable native tool mode")
	}
}

func TestCanvasRankCatalogSearchItemsPrefersExactMetadata(t *testing.T) {
	items := []scanner.AssetItem{
		{
			ID:       "owl",
			RepoPath: "bird_shima_fukurou.png",
			AITag: &aitag.Result{
				Tags:        []string{"貓頭鷹", "illustration"},
				Description: "一隻貓頭鷹坐在樹枝上。",
			},
		},
		{
			ID:       "cat",
			RepoPath: "monogatari_alice_cheshire_neko.png",
			AITag: &aitag.Result{
				Tags:        []string{"cat", "cheshire cat", "cartoon"},
				TagsI18n:    map[string][]string{"zh-TW": []string{"貓", "柴郡貓", "卡通"}},
				Description: "A cartoon cat.",
			},
		},
		{
			ID:       "catfish",
			RepoPath: "fish_text_chinanago_nohi.png",
			AITag: &aitag.Result{
				Tags:        []string{"Catfish", "fish"},
				TagsI18n:    map[string][]string{"zh-TW": []string{"鯰魚", "魚"}},
				Description: "A catfish memorial day asset.",
			},
		},
	}

	if got := canvasRankCatalogSearchItems(items, "cat"); got[0].ID != "cat" {
		t.Fatalf("cat search first result = %s, want cat; all=%#v", got[0].ID, got)
	}
	if got := canvasRankCatalogSearchItems(items, "貓"); got[0].ID != "cat" {
		t.Fatalf("貓 search first result = %s, want cat; all=%#v", got[0].ID, got)
	}
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestCanvasProposalAllowed_BlocksUnsolicitedProposalsWhenAdviceOff(t *testing.T) {
	latest := "review this image for quality issues"
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	for _, tool := range []string{"update_tags", "update_description"} {
		if canvasProposalAllowed(tool, latest, options, false) {
			t.Fatalf("%s should be blocked for a general request when advice is off", tool)
		}
	}
}

func TestCanvasProposalAllowed_AllowsExplicitMetadataRequests(t *testing.T) {
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	if !canvasProposalAllowed("update_tags", "add searchable tags to this image", options, false) {
		t.Fatal("explicit tag update should be allowed")
	}
	if !canvasProposalAllowed("update_description", "write and save a description for this image", options, false) {
		t.Fatal("explicit description update should be allowed")
	}
	if canvasProposalAllowed("update_description", "describe this image to me", options, false) {
		t.Fatal("plain describe request should not create a metadata proposal")
	}
}

func TestCanvasProposalAllowed_AllowsNativeToolProposals(t *testing.T) {
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	if !canvasProposalAllowed("copy_asset", "show text images and copy them with text-derived filenames", options, true) {
		t.Fatal("native file-operation tool call should create a confirmation proposal")
	}
}

func TestCanvasProposalAllowed_AllowsOptimizationWhenAdviceOnOrExplicit(t *testing.T) {
	if !canvasProposalAllowed("compress_image", "review this image for quality issues", canvasChatOptions{ImageOptimizationAdvice: true}, false) {
		t.Fatal("optimization advice on should allow review-driven image variants")
	}
	if !canvasProposalAllowed("compress_image", "give me suggestions", canvasChatOptions{ImageOptimizationAdvice: true}, false) {
		t.Fatal("optimization advice on should allow proactive optimization variants for general advice")
	}
	if !canvasProposalAllowed("compress_image", "compress this image", canvasChatOptions{ImageOptimizationAdvice: false}, false) {
		t.Fatal("explicit optimization request should be allowed even when advice is off")
	}
}

func TestCanvasProposalAllowed_AllowsExplicitImageTransforms(t *testing.T) {
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	if !canvasProposalAllowed("mirror_image", "mirror this image horizontally", options, false) {
		t.Fatal("explicit mirror request should be allowed")
	}
	if !canvasProposalAllowed("mirror_image", "flip this image", options, false) {
		t.Fatal("explicit reverse request should be allowed")
	}
	if !canvasProposalAllowed("rotate_image", "rotate this image 90 degrees", options, false) {
		t.Fatal("explicit rotate request should be allowed")
	}
}

func TestCanvasUserAsksAnnotation(t *testing.T) {
	for _, msg := range []string{"circle the tooth", "add an annotation to this image", "highlight the low contrast area"} {
		if !canvasUserAsksAnnotation(msg) {
			t.Fatalf("expected annotation request: %q", msg)
		}
	}
	for _, msg := range []string{"zoom in because I cannot see the tooth", "does it have cavities", "what is this"} {
		if canvasUserAsksAnnotation(msg) {
			t.Fatalf("should not be annotation request: %q", msg)
		}
	}
}

func TestCanvasImageTempFile_DecodesDataURI(t *testing.T) {
	path, cleanup, err := canvasImageTempFile("data:image/png;base64,AQID")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "\x01\x02\x03" {
		t.Fatalf("unexpected data: %v", data)
	}
}

func TestBuildCanvasUserPrompt_NotesAttachedCanvasImage(t *testing.T) {
	prompt := buildCanvasUserPrompt(nil, canvasSnapshot{}, canvasChatOptions{CanvasImageAttached: true}, "en")
	if !strings.Contains(prompt, "hidden AI-only screenshot") {
		t.Fatalf("prompt should mention attached screenshot:\n%s", prompt)
	}
}

func TestBuildCanvasUserPrompt_IncludesSelectedAssetTargets(t *testing.T) {
	prompt := buildCanvasUserPrompt(nil, canvasSnapshot{
		SelectedCardIDs: []string{"asset-card-1", "asset-card-2"},
		Cards: []canvasCardSnapshot{
			{ID: "asset-card-1", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a1", RepoPath: "assets/a.png"}},
			{ID: "asset-card-2", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a2", RepoPath: "assets/b.png"}},
		},
	}, canvasChatOptions{}, "en")
	for _, want := range []string{"Selected asset targets (2)", "assetId=a1", "assetId=a2"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasUserPrompt_ExplainsSelectedImageCoordinateFrame(t *testing.T) {
	prompt := buildCanvasUserPrompt(nil, canvasSnapshot{
		SelectedCardIDs: []string{"asset-card-1"},
		Cards: []canvasCardSnapshot{{
			ID:    "asset-card-1",
			Kind:  "asset",
			Asset: &canvasAssetSnapshot{ID: "a1", RepoPath: "assets/a.png"},
		}},
	}, canvasChatOptions{CanvasImageAttached: true}, "en")
	for _, want := range []string{"Attached visual inputs", "Image 1 is a selected card image with a coordinate grid overlay", "Image 2 is the plain selected card image", "final attached image is the canvas viewport screenshot", "not the full canvas screenshot", "normalized top-left bounding box"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasCoordinateGridImage(t *testing.T) {
	src := filepath.Join(t.TempDir(), "source.png")
	writePNG(t, src)

	gridPath, cleanup, err := canvasCoordinateGridImage(src)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	f, err := os.Open(gridPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() < 512 || img.Bounds().Dy() < 512 {
		t.Fatalf("grid image should be upscaled for VLM readability, got %dx%d", img.Bounds().Dx(), img.Bounds().Dy())
	}
}

func TestBuildCanvasUserPrompt_IncludesSelectedUploadTargets(t *testing.T) {
	prompt := buildCanvasUserPrompt(nil, canvasSnapshot{
		SelectedCardIDs: []string{"upload-card-1"},
		Cards: []canvasCardSnapshot{
			{ID: "upload-card-1", Kind: "upload", UploadToken: "tok", UploadFileName: "receipt.png", UploadWidth: 640, UploadHeight: 480},
		},
	}, canvasChatOptions{}, "en")
	for _, want := range []string{"Selected upload targets (1)", "card=upload-card-1", "file=receipt.png"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasUserPrompt_IncludesAIReadableCanvasCardsJSON(t *testing.T) {
	prompt := buildCanvasUserPrompt(nil, canvasSnapshot{
		Cards: []canvasCardSnapshot{{
			ID:     "asset-card-1",
			Kind:   "asset",
			X:      12,
			Y:      34,
			Width:  180,
			Height: 120,
			Asset: &canvasAssetSnapshot{
				ID:                "asset-1",
				FileName:          "cover.png",
				ProjectName:       "Books",
				RepoPath:          "books/cover.png",
				Ext:               ".png",
				Width:             201,
				Height:            250,
				ImageFormat:       "png",
				Bytes:             45932,
				URL:               "/api/assets/asset-1",
				ThumbnailURL:      "/api/assets/asset-1/thumb",
				SearchDescription: "Book cover with a lion illustration.",
				SearchLanguages:   []string{"eng"},
			},
		}},
	}, canvasChatOptions{}, "en")
	for _, want := range []string{
		"AI-Readable Canvas Cards JSON",
		`"thumbnailUrl":"/api/assets/asset-1/thumb"`,
		`"description":"Book cover with a lion illustration."`,
		`"fileName":"cover.png"`,
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasUserPrompt_LimitsLargeCanvasToRelevantCards(t *testing.T) {
	cards := make([]canvasCardSnapshot, 0, 16)
	for i := 0; i < 14; i++ {
		cards = append(cards, canvasCardSnapshot{
			ID:   fmt.Sprintf("card-decoy-%02d", i),
			Kind: "asset",
			Asset: &canvasAssetSnapshot{
				ID:          fmt.Sprintf("asset-decoy-%02d", i),
				RepoPath:    fmt.Sprintf("decoy-%02d.png", i),
				Tags:        []string{"decoy"},
				Description: "Unrelated filler card.",
			},
		})
	}
	cards = append(cards,
		canvasCardSnapshot{
			ID:   "card-tree",
			Kind: "asset",
			Asset: &canvasAssetSnapshot{
				ID:          "asset-tree",
				RepoPath:    "tree.png",
				Tags:        []string{"tree"},
				Description: "A tree card.",
			},
		},
		canvasCardSnapshot{
			ID:   "card-donkey",
			Kind: "asset",
			Asset: &canvasAssetSnapshot{
				ID:          "asset-donkey",
				RepoPath:    "donkey.png",
				Tags:        []string{"donkey"},
				Description: "A donkey card.",
			},
		},
	)

	prompt := buildCanvasUserPrompt(
		[]canvasChatMessage{{Role: "user", Content: "make the tree larger and duplicate the donkey"}},
		canvasSnapshot{Cards: cards},
		canvasChatOptions{},
		"en",
	)

	for _, want := range []string{"card-tree", "tree.png", "card-donkey", "donkey.png", "less relevant cards omitted"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "decoy-13.png") {
		t.Fatalf("prompt should omit late unrelated decoy:\n%s", prompt)
	}
}

func TestCanvasCaptureRequested(t *testing.T) {
	for _, input := range []string{
		"arrange this and take a transparent screenshot",
		"export the canvas for preview",
		"export the canvas",
		"download this layout",
	} {
		if !canvasCaptureRequested(input) {
			t.Fatalf("expected capture intent for %q", input)
		}
	}
	if canvasCaptureRequested("arrange this layout") {
		t.Fatal("plain arrange request should not require capture")
	}
}

func TestCanvasFollowupShouldRetainImages(t *testing.T) {
	if !canvasFollowupShouldRetainImages(canvasLoopReasonMissingCapture, "arrange this and capture it") {
		t.Fatal("missing capture repair should retain images")
	}
	if !canvasFollowupShouldRetainImages(canvasLoopReasonCaptureOnlyWork, "arrange storyboard / fight / control / mirror / rotate") {
		t.Fatal("capture-only manipulation repair should retain images")
	}
	if !canvasFollowupShouldRetainImages(canvasLoopReasonFocusOnlyNeedsAnswer, "arrange storyboard / fight / control / mirror / rotate") {
		t.Fatal("focus-only manipulation repair should retain images")
	}
	for _, input := range []string{
		"review this image for quality issues",
		"compare these two character images",
		"analyze this image quality",
	} {
		if !canvasFollowupShouldRetainImages(canvasLoopReasonToolResults, input) {
			t.Fatalf("expected visual request to retain images for %q", input)
		}
	}
	for _, input := range []string{
		"arrange storyboard / fight / control / mirror / rotate",
		"rotate this image 90 degrees",
		"arrange these cards",
	} {
		if canvasFollowupShouldRetainImages(canvasLoopReasonToolResults, input) {
			t.Fatalf("expected manipulation request to drop follow-up images for %q", input)
		}
	}
}

func TestCanvasCaptureRepairPrompt_AsksModelToChooseMode(t *testing.T) {
	prompt := canvasCaptureRepairPrompt("capture the selected cards")
	for _, want := range []string{"capture_viewport", "capture_canvas", "capture_selected", "Reply with exactly one action block"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("repair prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestExpandCanvasMultiSelectedActions_BatchesSinglePerAssetAction(t *testing.T) {
	actions := []canvasAction{{
		Tool:        "update_tags",
		Params:      map[string]any{"assetId": "a1", "tags": []any{"family"}},
		Description: "update tags",
		Impact:      "better search",
	}}
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1", "card-2", "card-3"},
		Cards: []canvasCardSnapshot{
			{ID: "card-1", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a1"}},
			{ID: "card-2", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a2"}},
			{ID: "card-3", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a3"}},
		},
	}

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "add tags to these images")
	if len(expanded) != 1 {
		t.Fatalf("expected 1 batch action, got %d", len(expanded))
	}
	got := canvasActionAssetIDs(expanded[0])
	want := []string{"a1", "a2", "a3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("assetIds = %#v, want %#v", got, want)
	}
}

func TestExpandCanvasMultiSelectedActions_DoesNotFanOutWhenModelAlreadyEmitsPerAsset(t *testing.T) {
	actions := []canvasAction{
		{Tool: "update_tags", Params: map[string]any{"assetId": "a1"}},
		{Tool: "update_tags", Params: map[string]any{"assetId": "a2"}},
	}
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1", "card-2"},
		Cards: []canvasCardSnapshot{
			{ID: "card-1", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a1"}},
			{ID: "card-2", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a2"}},
		},
	}

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "add tags to these images")
	if len(expanded) != 2 {
		t.Fatalf("expected original 2 actions, got %d", len(expanded))
	}
}

func TestExpandCanvasMultiSelectedActions_RespectsExplicitSingleTarget(t *testing.T) {
	actions := []canvasAction{{
		Tool:   "update_tags",
		Params: map[string]any{"assetId": "a1", "tags": []any{"family"}},
	}}
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1", "card-2"},
		Cards: []canvasCardSnapshot{
			{ID: "card-1", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a1"}},
			{ID: "card-2", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a2"}},
		},
	}

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "only process the first image")
	if len(expanded) != 1 {
		t.Fatalf("expected original single action, got %d", len(expanded))
	}
	if got := canvasActionAssetIDs(expanded[0]); !reflect.DeepEqual(got, []string{"a1"}) {
		t.Fatalf("asset IDs = %#v, want [a1]", got)
	}
}

func TestExpandCanvasMultiSelectedActions_DefaultsDuplicateCardsToSelectedImages(t *testing.T) {
	actions := []canvasAction{{
		Tool:   "duplicate_cards",
		Params: map[string]any{"count": float64(5), "layout": "walk"},
	}}
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1", "comment-1"},
		Cards: []canvasCardSnapshot{
			{ID: "card-1", Kind: "asset", Asset: &canvasAssetSnapshot{ID: "a1"}},
			{ID: "comment-1", Kind: "comment"},
		},
	}

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "duplicate five puppies and make them walk")
	if len(expanded) != 1 {
		t.Fatalf("expected one duplicate action, got %d", len(expanded))
	}
	if got := canvasActionCardIDs(expanded[0]); !reflect.DeepEqual(got, []string{"card-1"}) {
		t.Fatalf("card IDs = %#v, want [card-1]", got)
	}
}

func TestExpandCanvasMultiSelectedActions_DefaultsOCRToSelectedUploadCards(t *testing.T) {
	actions := []canvasAction{{
		Tool:   "extract_ocr_text",
		Params: map[string]any{"mode": "vlm", "saveToMetadata": false},
	}}
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"upload-1", "comment-1"},
		Cards: []canvasCardSnapshot{
			{ID: "upload-1", Kind: "upload", UploadToken: "tok", UploadFileName: "receipt.png", UploadWidth: 640, UploadHeight: 480},
			{ID: "comment-1", Kind: "comment"},
		},
	}

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "extract the image text")
	if len(expanded) != 1 {
		t.Fatalf("expected one OCR action, got %d", len(expanded))
	}
	if got := canvasActionCardIDs(expanded[0]); !reflect.DeepEqual(got, []string{"upload-1"}) {
		t.Fatalf("card IDs = %#v, want [upload-1]", got)
	}
}

func TestCanvasActionAssetIDs_NormalizesLegacyAndBatchParams(t *testing.T) {
	act := canvasAction{
		Tool: "delete_asset",
		Params: map[string]any{
			"assetIds": []any{"a1", "a2", "a1", ""},
			"assetId":  "a3",
		},
	}
	got := canvasActionAssetIDs(act)
	want := []string{"a1", "a2", "a3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("asset IDs = %#v, want %#v", got, want)
	}
}

func TestCanvasActionCardIDs_NormalizesLegacyAndBatchParams(t *testing.T) {
	act := canvasAction{
		Tool: "duplicate_cards",
		Params: map[string]any{
			"cardIds": []any{"c1", "c2", "c1", ""},
			"cardId":  "c3",
		},
	}
	got := canvasActionCardIDs(act)
	want := []string{"c1", "c2", "c3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("card IDs = %#v, want %#v", got, want)
	}
}

func TestCanvasOCRDisplayError_ExtractsProviderMessage(t *testing.T) {
	raw := `openai-compat: chat: status 400: {
    "error": {
        "message": "Failed to load model \"qwen/qwen3.6-27b\". Error: Model loading was stopped due to insufficient system resources.",
        "type": "invalid_request_error"
    }
}`
	got := canvasOCRDisplayError(raw)
	want := `Failed to load model "qwen/qwen3.6-27b". Error: Model loading was stopped due to insufficient system resources.`
	if got != want {
		t.Fatalf("display error = %q, want %q", got, want)
	}
}

func TestCanvasCreatedCommentsAnswerTextUsesSummaryWithoutLeakingCommentText(t *testing.T) {
	answer := canvasCreatedCommentsAnswerText([]string{"Text reads: SALE", "Text reads: SALE", "Text reads: LOGO"}, "zh-TW")
	if answer != "Added 3 comments." {
		t.Fatalf("answer = %q", answer)
	}
}

func TestCanvasToolsDeclareCardinality(t *testing.T) {
	for _, tool := range canvasToolRegistry() {
		if tool.Cardinality == "" {
			t.Fatalf("%s missing cardinality", tool.Name)
		}
	}
	if got := canvasToolCardinality("extract_ocr_text"); got != "multi" {
		t.Fatalf("extract_ocr_text cardinality = %q, want multi", got)
	}
	if !canvasToolSafe("extract_ocr_text") {
		t.Fatal("extract_ocr_text should be safe")
	}
}

func TestParseCanvasActions_ToolCallFormat(t *testing.T) {
	input := `<tool_call>call({"tool": "search_assets", "params": {"q": "書", "limit": 12}, "description": "搜尋書籍", "impact": "找到相關圖片"})</tool_call>`
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "search_assets" {
		t.Fatalf("expected search_assets, got %s", actions[0].Tool)
	}
	q, _ := actions[0].Params["q"].(string)
	if q != "書" {
		t.Fatalf("expected q=書, got %q", q)
	}
}

func TestParseCanvasActions_ToolCallNoCall(t *testing.T) {
	input := `<tool_call>{"tool": "focus_card", "params": {"cardId": "abc"}, "description": "look", "impact": "cursor"}</tool_call>`
	_, actions := parseCanvasActions(input)
	if len(actions) != 1 || actions[0].Tool != "focus_card" {
		t.Fatalf("expected focus_card, got %v", actions)
	}
}

func TestParseCanvasActions_RawActionJSON(t *testing.T) {
	input := `{"tool":"search_assets","params":{"q":"老人在刷牙的可愛插畫","limit":1},"description":"搜尋素材","impact":"找相關圖片"}`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected empty text, got %q", text)
	}
	if len(actions) != 1 || actions[0].Tool != "search_assets" {
		t.Fatalf("actions = %#v", actions)
	}
	if actions[0].Params["q"] != "老人在刷牙的可愛插畫" {
		t.Fatalf("unexpected params: %#v", actions[0].Params)
	}
}

func TestCanvasActionsFromToolCalls(t *testing.T) {
	actions := canvasActionsFromToolCalls([]llm.ChatToolCall{
		{Name: "search_assets", Arguments: map[string]any{"q": "dog", "limit": float64(1)}},
		{Name: "unknown_tool", Arguments: map[string]any{"q": "ignored"}},
	})
	if len(actions) != 1 {
		t.Fatalf("expected 1 valid action, got %#v", actions)
	}
	if actions[0].Tool != "search_assets" || actions[0].Params["q"] != "dog" {
		t.Fatalf("unexpected action: %#v", actions[0])
	}
}

func TestCanvasActionsFromToolCallsNestedActionEnvelope(t *testing.T) {
	actions := canvasActionsFromToolCalls([]llm.ChatToolCall{{
		Name: "focus_card",
		Arguments: map[string]any{
			"params":      map[string]any{"cardId": "asset-1", "label": "target"},
			"description": "Focus target",
			"impact":      "Moves cursor",
		},
	}})
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %#v", actions)
	}
	if actions[0].Params["cardId"] != "asset-1" {
		t.Fatalf("params = %#v", actions[0].Params)
	}
	if actions[0].Description != "Focus target" || actions[0].Impact != "Moves cursor" {
		t.Fatalf("metadata = %#v", actions[0])
	}
}

func TestCanvasActionsOnlyFocus(t *testing.T) {
	if canvasActionsOnlyFocus(nil) {
		t.Fatal("empty actions should not be focus-only")
	}
	if !canvasActionsOnlyFocus([]canvasAction{{Tool: "focus_card"}}) {
		t.Fatal("single focus_card should be focus-only")
	}
	if canvasActionsOnlyFocus([]canvasAction{{Tool: "focus_card"}, {Tool: "search_assets"}}) {
		t.Fatal("mixed actions should not be focus-only")
	}
}

func TestCanvasTextOnlyResponseNeedsActionRepair(t *testing.T) {
	planText := `I found the P1 and P2 character images. Now I will plan several storyboard beats. Here is the suggested battle scene:

Scene 1: close combat
• P1 attacks from the left
• P2 blocks on the right and counters`

	if !canvasTextOnlyResponseNeedsActionRepair(planText, false, 0, 3) {
		t.Fatal("deferred canvas work should request an action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair(planText, true, 0, 3) {
		t.Fatal("executed non-focus tools should not request another action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair(planText, false, 2, 3) {
		t.Fatal("last loop should not request another action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair("This image shows P1 in a standing pose.", false, 0, 3) {
		t.Fatal("plain visual answer should not request an action repair")
	}
	imagegenText := "I will use the imagegen skill for this fight request, first treating the selected P1/P2 poses as character consistency references, then generating an interactive battle composition."
	if !canvasTextOnlyResponseNeedsActionRepair(imagegenText, false, 0, 3) {
		t.Fatal("short imagegen promise should request an action repair")
	}
}

func TestCanvasActionBlockTextNeedsActionRepair(t *testing.T) {
	if !canvasActionBlockTextNeedsActionRepair(false, "initial", "Already circled it and added a comment.", 0, false, 0, 3) {
		t.Fatal("agent text-only completion claim should request action-block repair")
	}
	if canvasActionBlockTextNeedsActionRepair(true, "initial", "The answer is here.", 0, false, 0, 3) {
		t.Fatal("native tool mode is handled by native missing-tool logic")
	}
	if canvasActionBlockTextNeedsActionRepair(false, canvasLoopReasonBlockedComment, "This image is a test asset.", 0, false, 1, 3) {
		t.Fatal("blocked-comment answer loop should allow plain explanatory text")
	}
	if canvasActionBlockTextNeedsActionRepair(false, "initial", "Already circled it.", 1, false, 0, 3) {
		t.Fatal("existing action blocks should not request repair")
	}
}

func TestCanvasRequiredNativeToolCallMissing(t *testing.T) {
	if !canvasRequiredNativeToolCallMissing(true, "required", "The answer is here.", 0, false, 0, 3) {
		t.Fatal("required native text-only response should request a repair")
	}
	if canvasRequiredNativeToolCallMissing(true, "", "The answer is here.", 0, false, 0, 3) {
		t.Fatal("optional native text-only response should not request a repair")
	}
	if canvasRequiredNativeToolCallMissing(true, "required", "The answer is here.", 1, false, 0, 3) {
		t.Fatal("existing actions should not request a missing-tool repair")
	}
	if canvasRequiredNativeToolCallMissing(true, "required", "The answer is here.", 0, true, 0, 3) {
		t.Fatal("executed non-focus tools should not request another repair")
	}
}

func TestCanvasActionRepairPromptRequiresGenericToolActions(t *testing.T) {
	prompt := canvasActionRepairPrompt("arrange a few storyboard beats")
	for _, want := range []string{"without producing an executable non-focus action", "Use canvas layout tools", "Use create_comment with region", "built-in imagegen capability", "Reply with only tool calls or action blocks"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("repair prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasFocusOnlyRepairPromptRequiresActionForManipulation(t *testing.T) {
	prompt := canvasFocusOnlyRepairPrompt("arrange storyboard / fight / control / mirror / rotate")
	for _, want := range []string{"requires canvas work", "specific target/layout uncertainty", "Do not repeat the same focus_card", "concrete operation tools", "mirror_image/rotate_image", "no prose"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("focus-only repair prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "answer the user's latest question in prose") {
		t.Fatalf("manipulation repair prompt should not switch to prose answer mode:\n%s", prompt)
	}
}

func TestCanvasFocusOnlyRepairPromptAllowsProseForVisualQuestion(t *testing.T) {
	prompt := canvasFocusOnlyRepairPrompt("what is this image?")
	for _, want := range []string{"did not answer", "answer the user's latest question in prose"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("focus-only answer prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasCaptureOnlyRepairPromptRequiresNonCaptureAction(t *testing.T) {
	prompt := canvasCaptureOnlyRepairPrompt("arrange storyboard / fight / control / mirror / rotate")
	for _, want := range []string{"only captured the canvas", "Do NOT call capture_* again", "non-capture canvas tool action", "mirror_image/rotate_image", "no prose"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("capture-only repair prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestVLMChatRoundStats(t *testing.T) {
	s := &Server{llmProvider: roundStatsProvider{}}
	round := s.chatVLMRound(context.Background(), vlmChatRoundRequest{
		ModelName:  "test-model",
		Prompt:     "hello",
		Purpose:    "canvas",
		Loop:       1,
		PromptKind: vlmPromptKindFollowup,
		LoopReason: canvasLoopReasonToolResults,
		Tools:      []llm.ChatTool{{Name: "search_assets"}},
	})
	if round.Err != nil {
		t.Fatalf("chatVLMRound error: %v", round.Err)
	}
	if round.Content != "ok" {
		t.Fatalf("content = %q", round.Content)
	}
	if round.Stats.Loop != 1 || round.Stats.PromptKind != vlmPromptKindFollowup || round.Stats.Reason != canvasLoopReasonToolResults {
		t.Fatalf("stats identity = %#v", round.Stats)
	}
	if round.Stats.InputTokens != 3 || round.Stats.OutputTokens != 4 || round.Stats.DurationMs != 5 || round.Stats.ToolCallCount != 1 {
		t.Fatalf("stats metrics = %#v", round.Stats)
	}
}

func TestCanvasNextLoopReason(t *testing.T) {
	cases := []struct {
		name string
		in   canvasNextLoopInput
		want string
	}{
		{
			name: "tool results",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, ToolResultCount: 1},
			want: canvasLoopReasonToolResults,
		},
		{
			name: "truncated priority",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, ToolResultCount: 1, TruncatedAction: true},
			want: canvasLoopReasonTruncatedAction,
		},
		{
			name: "missing capture",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, MissingCapture: true},
			want: canvasLoopReasonMissingCapture,
		},
		{
			name: "capture only deferred work",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, CaptureOnlyDeferredWork: true},
			want: canvasLoopReasonCaptureOnlyWork,
		},
		{
			name: "text only deferred work",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, TextOnlyDeferredWork: true},
			want: canvasLoopReasonTextOnlyDeferredWork,
		},
		{
			name: "focus only needs answer",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, FocusOnlyNeedsAnswer: true},
			want: canvasLoopReasonFocusOnlyNeedsAnswer,
		},
		{
			name: "blocked comment",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3, BlockedCommentNeedsAnswer: true},
			want: canvasLoopReasonBlockedComment,
		},
		{
			name: "last loop stops",
			in:   canvasNextLoopInput{Loop: 2, MaxLoops: 3, ToolResultCount: 1},
			want: "",
		},
		{
			name: "no reason stops",
			in:   canvasNextLoopInput{Loop: 0, MaxLoops: 3},
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canvasNextLoopReason(tc.in); got != tc.want {
				t.Fatalf("canvasNextLoopReason() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildCanvasFollowupPromptUsesCompactState(t *testing.T) {
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1"},
		Cards: []canvasCardSnapshot{{
			ID:     "card-1",
			Kind:   "asset",
			X:      10,
			Y:      20,
			Width:  180,
			Height: 120,
			Asset: &canvasAssetSnapshot{
				ID:       "asset-1",
				RepoPath: "sprites/p1.png",
				Ext:      ".png",
				Width:    64,
				Height:   64,
			},
		}},
	}
	results := []canvasCompactToolResult{compactCanvasToolResult("duplicate_cards", map[string]any{
		"cardIds":    []string{"card-1"},
		"newCardIds": []string{"dup-1", "dup-2"},
	})}
	prompt := buildCanvasFollowupPrompt(canvasLoopReasonToolResults, "arrange these", canvas, nil, results, []string{"duplicate_cards"}, "I will arrange them.")
	if strings.Contains(prompt, "## Canvas State") {
		t.Fatalf("follow-up prompt should not include full canvas state:\n%s", prompt)
	}
	for _, want := range []string{"Original User Request", "arrange these", "card-1", "asset-1", "Completed Canvas Tools", "duplicate_cards", "newCardIds", "dup-1", canvasLoopReasonToolResults} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("follow-up prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildCanvasFollowupPromptDuplicateWorkflowKeepsCleanupContext(t *testing.T) {
	canvas := canvasSnapshot{
		SelectedCardIDs: []string{"card-1"},
		Cards: []canvasCardSnapshot{
			{
				ID:     "card-1",
				Kind:   "asset",
				X:      10,
				Y:      20,
				Width:  180,
				Height: 120,
				Asset:  &canvasAssetSnapshot{ID: "asset-1", RepoPath: "sprites/p1.png", Ext: ".png"},
			},
			{
				ID:     "card-decoy",
				Kind:   "asset",
				X:      300,
				Y:      20,
				Width:  180,
				Height: 120,
				Asset:  &canvasAssetSnapshot{ID: "asset-decoy", RepoPath: "sprites/unrelated_candidate.png", Ext: ".png"},
			},
		},
	}
	results := []canvasCompactToolResult{compactCanvasToolResult("duplicate_cards", map[string]any{
		"cardIds":    []string{"card-1"},
		"newCardIds": []string{"dup-1", "dup-2"},
	})}
	prompt := buildCanvasFollowupPrompt(canvasLoopReasonToolResults, "duplicate selected images and remove unrelated candidates", canvas, nil, results, []string{"duplicate_cards"}, "")
	for _, want := range []string{"card-decoy", "unrelated_candidate.png", "do not remove returned newCardIds", "pre-existing unrelated visible cards"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("duplicate follow-up prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasGeneratedImagePathCandidates(t *testing.T) {
	input := `Generated:
![battle](/tmp/aisets battle.png)
Saved file: /private/tmp/aisets-output.webp
Existing asset path assets/sprite.png should be ignored.`
	paths := canvasGeneratedImagePathCandidates(input)
	if !reflect.DeepEqual(paths, []string{"/tmp/aisets battle.png", "/private/tmp/aisets-output.webp"}) {
		t.Fatalf("paths = %#v", paths)
	}

	encoded := "file:///tmp/generated%20image.png"
	paths = canvasGeneratedImagePathCandidates("Result: ![out](" + encoded + ")")
	if !reflect.DeepEqual(paths, []string{"/tmp/generated image.png"}) {
		t.Fatalf("encoded paths = %#v", paths)
	}
}

func TestCompactCanvasToolResultSearchAssetsOmitsFullAssetItem(t *testing.T) {
	compact := compactCanvasToolResult("search_assets", map[string]any{
		"total": float64(1),
		"items": []scanner.AssetItem{{
			ID:          "asset-1",
			RepoPath:    "icons/cat.png",
			LocalPath:   "/private/project/icons/cat.png",
			ContentHash: "hash-should-not-leak",
			Ext:         ".png",
			Bytes:       2048,
		}},
	})
	raw, err := json.Marshal(compact)
	if err != nil {
		t.Fatalf("marshal compact result: %v", err)
	}
	body := string(raw)
	for _, want := range []string{"asset-1", "icons/cat.png"} {
		if !strings.Contains(body, want) {
			t.Fatalf("compact result missing %q: %s", want, body)
		}
	}
	for _, forbidden := range []string{"LocalPath", "localPath", "/private/project", "ContentHash", "contentHash", "hash-should-not-leak"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("compact result leaked %q: %s", forbidden, body)
		}
	}
}

func TestCompactCanvasCardIncludesAIReadableAssetPayload(t *testing.T) {
	compact := compactCanvasCard(canvasCardSnapshot{
		ID:     "card-1",
		Kind:   "asset",
		X:      10,
		Y:      20,
		Width:  200,
		Height: 150,
		Asset: &canvasAssetSnapshot{
			ID:                "asset-1",
			FileName:          "cover.png",
			RepoPath:          "books/cover.png",
			ProjectName:       "Books",
			Ext:               ".png",
			Width:             201,
			Height:            250,
			ImageFormat:       "png",
			Alpha:             true,
			Pages:             1,
			Bytes:             45932,
			URL:               "/api/assets/asset-1",
			ThumbnailURL:      "/api/assets/asset-1/thumb",
			SearchCategory:    "illustration",
			SearchTags:        []string{"book-cover", "lion"},
			SearchDescription: "Book cover with a lion illustration.",
			SearchLanguages:   []string{"eng"},
		},
	})

	if compact["assetId"] != "asset-1" {
		t.Fatalf("top-level assetId = %#v", compact["assetId"])
	}
	asset, ok := compact["asset"].(map[string]any)
	if !ok {
		t.Fatalf("missing nested asset payload: %#v", compact)
	}
	visual, ok := asset["visual"].(map[string]any)
	if !ok || visual["thumbnailUrl"] != "/api/assets/asset-1/thumb" {
		t.Fatalf("visual payload = %#v", asset["visual"])
	}
	image, ok := asset["image"].(map[string]any)
	if !ok || image["width"] != 201 || image["format"] != "png" {
		t.Fatalf("image payload = %#v", asset["image"])
	}
	ai, ok := asset["ai"].(map[string]any)
	if !ok || ai["description"] != "Book cover with a lion illustration." {
		t.Fatalf("ai payload = %#v", asset["ai"])
	}
}

func TestCanvasAddedAssetsAnswerTextUsesLocaleFallbacks(t *testing.T) {
	got := canvasAddedAssetsAnswerText([]scanner.AssetItem{
		{
			ID:       "asset-1",
			RepoPath: "books/cover.png",
			AITag: &aitag.Result{
				Description:     "A book cover with a lion.",
				DescriptionI18n: map[string]string{"zh-Hant": "一本獅子封面的書。"},
			},
		},
	}, "zh-TW")
	if got != "- cover.png: 一本獅子封面的書。" {
		t.Fatalf("answer text = %q", got)
	}
}

func TestCanvasAddedAssetsAnswerTextPrefersRawDescriptionBeforeEnglishForNonEnglishLocale(t *testing.T) {
	got := canvasAddedAssetsAnswerText([]scanner.AssetItem{
		{
			ID:       "asset-1",
			RepoPath: "books/fish.png",
			AITag: &aitag.Result{
				Description:     "一張魚類封面的書。",
				DescriptionI18n: map[string]string{"en": "A book cover with a fish."},
			},
		},
	}, "zh-TW")
	if got != "- fish.png: 一張魚類封面的書。" {
		t.Fatalf("answer text = %q", got)
	}
}

func TestParseCanvasActions_JSONFenceArray(t *testing.T) {
	input := "I will inspect the current canvas.\n```json\n[\n  {\"tool\":\"focus_card\",\"params\":{\"cardId\":\"copy-1\",\"label\":\"target\"}},\n  {\"tool\":\"find_similar_assets\",\"params\":{\"assetIds\":[\"386481964017\"],\"limit\":5}}\n]\n```"
	text, actions := parseCanvasActions(input)
	if len(actions) != 2 {
		t.Fatalf("expected 2 actions, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "focus_card" || actions[1].Tool != "find_similar_assets" {
		t.Fatalf("actions = %#v", actions)
	}
	if strings.Contains(text, "tool") || strings.Contains(text, "find_similar_assets") {
		t.Fatalf("text leaked JSON action payload: %q", text)
	}
}

func TestParseCanvasActions_GemmaFormat(t *testing.T) {
	input := "<|tool_call>call{\"tool\": \"search_assets\", \"params\": {\"q\": \"書\", \"limit\": 12}, \"description\": \"搜尋書\", \"impact\": \"列表\"}<tool_call|>"
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action from Gemma format, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "search_assets" {
		t.Fatalf("expected search_assets, got %s", actions[0].Tool)
	}
}

func TestParseCanvasActions_PlainToolNameCallFormat(t *testing.T) {
	input := `call:focus_card{cardId:<|"|>asset-mp41yi1d-kdk4o2<|"|>,label:<|"|>book_zukan_body.png (第一個圖卡)<|"|>}`
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "focus_card" {
		t.Fatalf("tool = %s", actions[0].Tool)
	}
	if actions[0].Params["cardId"] != "asset-mp41yi1d-kdk4o2" {
		t.Fatalf("cardId = %#v", actions[0].Params["cardId"])
	}
	if actions[0].Params["label"] != "book_zukan_body.png (第一個圖卡)" {
		t.Fatalf("label = %#v", actions[0].Params["label"])
	}
}

func TestParseCanvasActions_PlainToolNameCallConsumesTrailingMetadata(t *testing.T) {
	input := `call:focus_card{cardId:<|"|>asset-1<|"|>,label:<|"|>target<|"|>}, "description": "將游標移動到圖片上。", "impact": "視覺焦點轉移到指定圖片卡片。"`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected no leaked metadata text, got %q", text)
	}
	if len(actions) != 1 || actions[0].Tool != "focus_card" {
		t.Fatalf("actions = %#v", actions)
	}
	if actions[0].Params["cardId"] != "asset-1" {
		t.Fatalf("params = %#v", actions[0].Params)
	}
}

func TestParseCanvasActions_PlainToolNameCallConsumesSentinelMetadata(t *testing.T) {
	input := `call:create_comment{anchorCardId:<|"|>asset-1<|"|>,text:<|"|>note<|"|>},description:<|"|>註解圖片<|"|>,impact:<|"|>新增註解<|"|>`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected no leaked metadata text, got %q", text)
	}
	if len(actions) != 1 || actions[0].Tool != "create_comment" {
		t.Fatalf("actions = %#v", actions)
	}
}

func TestParseCanvasActions_LooseQuotedCallSyntax(t *testing.T) {
	input := `call: "focus_card", "params": {"cardId": "asset-1", "label": "target"}`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected empty text, got %q", text)
	}
	if len(actions) != 1 || actions[0].Tool != "focus_card" {
		t.Fatalf("actions = %#v", actions)
	}
	if actions[0].Params["cardId"] != "asset-1" {
		t.Fatalf("params = %#v", actions[0].Params)
	}
}

func TestParseCanvasActions_BracketActionFormat(t *testing.T) {
	input := `Before.
[action: focus_card]
description: Focus the existing goldfish card before moving it.
impact: Moves the cursor to the fish asset on the canvas.
cardId: asset-mp57knfh-w4tdk9

[action: arrange_cards]
description: Move both fish cards beside the current cluster without placing them far away.
impact: Places book_zukan_fish.png and fish_kingyo2.png to the nearby right side for easier visual separation.
cards:
• cardId: asset-mp57knfi-s689c2
  x: 1040
  y: 1120
• cardId: asset-mp57knfh-w4tdk9
  x: 1040
  y: 1260
After.`
	text, actions := parseCanvasActions(input)
	if len(actions) != 2 {
		t.Fatalf("expected 2 actions, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "focus_card" {
		t.Fatalf("first tool = %s", actions[0].Tool)
	}
	if actions[0].Description != "Focus the existing goldfish card before moving it." {
		t.Fatalf("description = %q", actions[0].Description)
	}
	if actions[0].Params["cardId"] != "asset-mp57knfh-w4tdk9" {
		t.Fatalf("focus params = %#v", actions[0].Params)
	}
	if actions[1].Tool != "arrange_cards" {
		t.Fatalf("second tool = %s", actions[1].Tool)
	}
	positions, ok := actions[1].Params["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("positions = %#v", actions[1].Params["positions"])
	}
	first, ok := positions[0].(map[string]any)
	if !ok {
		t.Fatalf("first position = %#v", positions[0])
	}
	if first["cardId"] != "asset-mp57knfi-s689c2" || first["x"] != float64(1040) || first["y"] != float64(1120) {
		t.Fatalf("first position = %#v", first)
	}
	if strings.Contains(text, "focus_card") || strings.Contains(text, "arrange_cards") || strings.Contains(text, "cardId") {
		t.Fatalf("text leaked bracket action payload: %q", text)
	}
	if !strings.Contains(text, "Before.") || !strings.Contains(text, "After.") {
		t.Fatalf("surrounding prose missing: %q", text)
	}
}

func TestParseCanvasActions_BracketActionImageRegionFields(t *testing.T) {
	input := `[action: create_comment]
description: Add peach marker.
impact: Adds a pinned comment.
anchorCardId: card-a
text: Peach is on the headband.
regionX: 0.29
regionY: 0.19
regionWidth: 0.11
regionHeight: 0.08
visualCueTargetDescription: small pink peach icon
visualCueColorHex: #f26aa0`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected no text, got %q", text)
	}
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(actions))
	}
	region, ok := canvasRegionFromValue(actions[0].Params["region"])
	if !ok {
		t.Fatalf("region = %#v", actions[0].Params["region"])
	}
	if region.X != 0.29 || region.Y != 0.19 || region.Width != 0.11 || region.Height != 0.08 {
		t.Fatalf("region = %#v", region)
	}
	cue, ok := canvasRegionVisualCueFromParams(actions[0].Params)
	if !ok || !cue.HasColor || cue.TargetDescription != "small pink peach icon" {
		t.Fatalf("visual cue = %#v ok=%v", cue, ok)
	}
}

func TestParseCanvasActions_BracketActionInlineJSONArray(t *testing.T) {
	input := `[action: arrange_cards]
description: Place text-bearing cards in one row.
impact: Moves all cards into an even horizontal layout.
positions: [{"cardId":"card-a","x":0,"y":0},{"cardId":"card-b","x":240,"y":0}]`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected no text, got %q", text)
	}
	if len(actions) != 1 || actions[0].Tool != "arrange_cards" {
		t.Fatalf("actions = %#v", actions)
	}
	actions, issues := normalizeCanvasActions(actions, true)
	if len(issues) > 0 {
		t.Fatalf("unexpected issues: %#v", issues)
	}
	positions, ok := actions[0].Params["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("positions = %#v", actions[0].Params["positions"])
	}
	first, ok := positions[0].(map[string]any)
	if !ok || first["cardId"] != "card-a" || first["x"] != float64(0) || first["y"] != float64(0) {
		t.Fatalf("first position = %#v", first)
	}
}

func TestCanvasActionTargetsTextRegionRequiresTextCueAndColor(t *testing.T) {
	withTextButNoColor := canvasAction{
		Tool: "create_comment",
		Params: map[string]any{
			"visualCue": map[string]any{
				"targetDescription": "white text characters",
			},
		},
	}
	if canvasActionTargetsTextRegion(withTextButNoColor) {
		t.Fatal("text repair should reject text cues without a target pixel color")
	}
	withWritingAndColor := canvasAction{
		Tool: "create_comment",
		Params: map[string]any{
			"visualCue": map[string]any{
				"targetDescription": "white writing on the banner",
				"colorHex":          "#ffffff",
			},
		},
	}
	if !canvasActionTargetsTextRegion(withWritingAndColor) {
		t.Fatal("text repair should accept writing cues with a target pixel color")
	}
}

func TestParseCanvasActions_BracketActionIgnoresUnknownHeaders(t *testing.T) {
	input := "[note: focus_card]\ncardId: asset-1\n\n## action: not real\nplain"
	text, actions := parseCanvasActions(input)
	if len(actions) != 0 {
		t.Fatalf("expected no actions, got %#v", actions)
	}
	if !strings.Contains(text, "[note: focus_card]") || !strings.Contains(text, "plain") {
		t.Fatalf("unexpected text = %q", text)
	}
}

func TestParseCanvasActions_ActionHeaderMoveCardsAlias(t *testing.T) {
	input := `Action: focus_card
description: Focus the family human card before repositioning the human assets.
impact: Cursor moves to family_danran.png.
cardId: asset-mp57knfi-eooitm

Action: move_cards
description: Move all identified human cards farther away from the animal and fish cluster.
impact: family_danran.png moves to x=120, y=1540; sleep_ofuton_dive_man.png moves to x=120, y=2050.
cardIds: asset-mp57knfi-eooitm, asset-mp57knfi-t2kq3w`
	text, actions := parseCanvasActions(input)
	if text != "" {
		t.Fatalf("expected action text to be consumed, got %q", text)
	}
	if len(actions) != 2 {
		t.Fatalf("expected 2 actions, got %#v", actions)
	}
	if actions[0].Tool != "focus_card" {
		t.Fatalf("first tool = %s", actions[0].Tool)
	}
	if actions[1].Tool != "arrange_cards" {
		t.Fatalf("move_cards should normalize to arrange_cards, got %s", actions[1].Tool)
	}
	positions, ok := actions[1].Params["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("positions = %#v", actions[1].Params["positions"])
	}
	first, ok := positions[0].(map[string]any)
	if !ok {
		t.Fatalf("first position = %#v", positions[0])
	}
	if first["cardId"] != "asset-mp57knfi-eooitm" || first["x"] != float64(120) || first["y"] != float64(1540) {
		t.Fatalf("first position = %#v", first)
	}
	second, ok := positions[1].(map[string]any)
	if !ok {
		t.Fatalf("second position = %#v", positions[1])
	}
	if second["cardId"] != "asset-mp57knfi-t2kq3w" || second["x"] != float64(120) || second["y"] != float64(2050) {
		t.Fatalf("second position = %#v", second)
	}
}

func TestParseCanvasActions_PlainCallFormat(t *testing.T) {
	input := "call: {\"tool\": \"create_comment\", \"params\": {\"anchorCardId\": \"asset-1\", \"text\": \"圈出紅色印章\", \"region\": {\"x\": 0.3, \"y\": 0.5, \"width\": 0.4, \"height\": 0.2}}, \"description\": \"註解印章\", \"impact\": \"標記圖片區域\"}\n已經註解。"
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action from plain call format, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "create_comment" {
		t.Fatalf("expected create_comment, got %s", actions[0].Tool)
	}
	if strings.Contains(text, "create_comment") || strings.Contains(text, "call:") {
		t.Fatalf("text should not contain raw tool call: %q", text)
	}
	region, ok := actions[0].Params["region"].(map[string]any)
	if !ok || region["x"] != 0.3 {
		t.Fatalf("expected parsed region, got %#v", actions[0].Params["region"])
	}
}

func TestParseCanvasActions_BareCallJSONFormat(t *testing.T) {
	input := "call\n{\"tool\":\"search_assets\",\"params\":{\"q\":\"老人在刷牙的可愛插畫\",\"limit\":1},\"description\":\"搜尋素材\",\"impact\":\"找相關圖片\"}"
	text, actions := parseCanvasActions(input)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action from bare call JSON format, got %d; text=%q", len(actions), text)
	}
	if actions[0].Tool != "search_assets" {
		t.Fatalf("expected search_assets, got %s", actions[0].Tool)
	}
	if text != "" {
		t.Fatalf("text should not contain raw call payload: %q", text)
	}
	if actions[0].Params["q"] != "老人在刷牙的可愛插畫" {
		t.Fatalf("unexpected params: %#v", actions[0].Params)
	}
}

func TestSplitParagraphs(t *testing.T) {
	ps := splitParagraphs("Hello\n\nWorld\n\nDone")
	if len(ps) != 3 {
		t.Fatalf("expected 3 paragraphs, got %d", len(ps))
	}
	ps = splitParagraphs("Single line")
	if len(ps) != 1 || ps[0] != "Single line" {
		t.Fatalf("unexpected: %v", ps)
	}
	ps = splitParagraphs("")
	if len(ps) != 0 {
		t.Fatalf("empty string should give 0 paragraphs, got %d", len(ps))
	}
}

func TestCanvasChatRequest_AttachmentTokens(t *testing.T) {
	body := `{"messages":[],"canvas":{"cards":[]},"attachmentTokens":["tok1","tok2"]}`
	var req canvasChatRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(req.AttachmentTokens) != 2 {
		t.Fatalf("expected 2 tokens, got %d", len(req.AttachmentTokens))
	}
	if req.AttachmentTokens[0] != "tok1" || req.AttachmentTokens[1] != "tok2" {
		t.Fatalf("unexpected tokens: %v", req.AttachmentTokens)
	}
}

func TestCanvasChatRequest_NoAttachmentTokens(t *testing.T) {
	body := `{"messages":[],"canvas":{"cards":[]}}`
	var req canvasChatRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(req.AttachmentTokens) != 0 {
		t.Fatalf("expected 0 tokens, got %d", len(req.AttachmentTokens))
	}
}

func TestCanvasRequestedCount(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{in: "duplicate 5 copies", want: 5},
		{in: "duplicate four copies", want: 4},
		{in: "duplicate seven copies", want: 7},
	}
	for _, tc := range cases {
		if got := canvasRequestedCount(tc.in); got != tc.want {
			t.Fatalf("canvasRequestedCount(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeCanvasCopyAssetDestPathsDedupesFilenames(t *testing.T) {
	act := normalizeCanvasCopyAssetDestPaths(canvasAction{
		Tool: "copy_asset",
		Params: map[string]any{
			"assetIds": []any{"a1", "a2", "a3"},
			"perAssetDestPaths": []any{
				map[string]any{"assetId": "a1", "destPath": "ずかん.png"},
				map[string]any{"assetId": "a2", "destPath": "ずかん.png"},
				map[string]any{"assetId": "a3", "destPath": "ずかん-2.png"},
			},
		},
	})
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) != 3 {
		t.Fatalf("perAssetDestPaths = %#v", act.Params["perAssetDestPaths"])
	}
	got := make([]string, 0, len(rows))
	for _, row := range rows {
		values := row.(map[string]any)
		got = append(got, values["destPath"].(string))
	}
	want := []string{"ずかん.png", "ずかん-2.png", "ずかん-2-2.png"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dest paths = %#v, want %#v", got, want)
	}
}

func TestFillCanvasCopyAssetDestPathsFromOCR(t *testing.T) {
	act := fillCanvasCopyAssetDestPathsFromOCR(canvasAction{
		Tool: "copy_asset",
		Params: map[string]any{
			"assetIds": []any{"a1", "a2"},
			"destDir":  "exports",
		},
	}, []canvasOCRAnnotationItem{
		{AssetID: "a1", FileName: "source.png", Text: "SALE/50"},
		{AssetID: "a2", FileName: "book.webp", Text: "ずかん"},
	})
	act = normalizeCanvasCopyAssetDestPaths(act)
	if !canvasCopyAssetProposalHasDestination(act) {
		t.Fatalf("copy proposal should have derived destinations: %#v", act.Params)
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatalf("perAssetDestPaths = %#v", act.Params["perAssetDestPaths"])
	}
	got := make([]string, 0, len(rows))
	for _, row := range rows {
		values := row.(map[string]any)
		got = append(got, values["destPath"].(string))
	}
	want := []string{"exports/SALE_50.png", "exports/ずかん.webp"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dest paths = %#v, want %#v", got, want)
	}
}

func TestSanitizeCanvasCopyAssetDestPathsFromOCRKeepsIntentionalDirs(t *testing.T) {
	items := []canvasOCRAnnotationItem{
		{AssetID: "a1", FileName: "parking.png", Text: "PARKING 60min/●●●"},
		{AssetID: "a2", FileName: "sale.png", Text: "SALE"},
	}
	act := sanitizeCanvasCopyAssetDestPathsFromOCR(canvasAction{
		Tool: "copy_asset",
		Params: map[string]any{
			"assetIds": []any{"a1", "a2"},
			"perAssetDestPaths": []any{
				map[string]any{"assetId": "a1", "destPath": "PARKING 60min/●●●.png"},
				map[string]any{"assetId": "a2", "destPath": "exports/SALE.png"},
			},
		},
	}, items)
	rows := act.Params["perAssetDestPaths"].([]any)
	got := []string{
		rows[0].(map[string]any)["destPath"].(string),
		rows[1].(map[string]any)["destPath"].(string),
	}
	want := []string{"PARKING 60min_●●●.png", "exports/SALE.png"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dest paths = %#v, want %#v", got, want)
	}
}

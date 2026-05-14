package server

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

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
	safes := []string{"focus_card", "search_assets", "create_comment", "select_cards", "remove_cards", "move_card", "arrange_cards", "resize_card", "bring_cards_to_front", "inspect_canvas", "capture_viewport", "capture_canvas", "capture_selected"}
	for _, name := range safes {
		if !canvasToolSafe(name) {
			t.Errorf("%s should be safe", name)
		}
	}
	unsafes := []string{"compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image", "update_tags", "update_description", "update_ocr_text"}
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

func TestCanvasSystemPrompt_ImageOptimizationAdviceOffRestrictsProposals(t *testing.T) {
	prompt := canvasSystemPrompt("zh-TW", canvasChatOptions{ImageOptimizationAdvice: false})
	for _, want := range []string{
		"Image optimization advice is OFF",
		"Do NOT proactively create NEEDS_CONFIRMATION proposal cards",
		"Use SAFE tools only",
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
		"en":    "Respond in English",
		"zh-TW": "Respond in Traditional Chinese",
		"zh-CN": "Respond in Simplified Chinese",
		"ja":    "Respond in Japanese",
		"ko":    "Respond in Korean",
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
	if !strings.Contains(prompt, "Respond in English") {
		t.Fatalf("prompt should default to English when auto locale is off:\n%s", prompt)
	}
}

func TestCanvasSystemPrompt_ImageOptimizationAdviceOnAllowsOptimizationProposals(t *testing.T) {
	prompt := canvasSystemPrompt("en", canvasChatOptions{ImageOptimizationAdvice: true})
	for _, want := range []string{
		"Image optimization advice is ON",
		"proactively inspect selected or visible image assets",
		"compress_image, resize_image, or convert_image",
		"Keep non-optimization proposals",
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
	if !strings.Contains(prompt, "Do not proactively propose compression, resizing, format conversion, mirroring, or rotation") {
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
	if !strings.Contains(prompt, "Respond in Traditional Chinese") {
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
}

func TestCanvasProposalAllowed_BlocksUnsolicitedProposalsWhenAdviceOff(t *testing.T) {
	latest := "幫我看看這張圖有什麼問題"
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	for _, tool := range []string{"compress_image", "resize_image", "convert_image", "update_tags", "update_description"} {
		if canvasProposalAllowed(tool, latest, options) {
			t.Fatalf("%s should be blocked for a general request when advice is off", tool)
		}
	}
}

func TestCanvasProposalAllowed_AllowsExplicitMetadataRequests(t *testing.T) {
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	if !canvasProposalAllowed("update_tags", "幫這張圖加上搜尋標籤", options) {
		t.Fatal("explicit tag update should be allowed")
	}
	if !canvasProposalAllowed("update_description", "幫這張圖補充描述並儲存", options) {
		t.Fatal("explicit description update should be allowed")
	}
	if canvasProposalAllowed("update_description", "描述這張圖給我聽", options) {
		t.Fatal("plain describe request should not create a metadata proposal")
	}
}

func TestCanvasProposalAllowed_AllowsOptimizationWhenAdviceOnOrExplicit(t *testing.T) {
	if !canvasProposalAllowed("compress_image", "幫我看看這張圖有沒有品質問題", canvasChatOptions{ImageOptimizationAdvice: true}) {
		t.Fatal("optimization advice on should allow review-driven optimization proposals")
	}
	if !canvasProposalAllowed("compress_image", "給我建議吧", canvasChatOptions{ImageOptimizationAdvice: true}) {
		t.Fatal("optimization advice on should allow proactive optimization proposals for general advice")
	}
	if canvasProposalAllowed("compress_image", "這是啥", canvasChatOptions{ImageOptimizationAdvice: true}) {
		t.Fatal("visual identification should not create optimization proposals")
	}
	if canvasProposalAllowed("compress_image", "他在做啥", canvasChatOptions{ImageOptimizationAdvice: true}) {
		t.Fatal("activity identification should not create optimization proposals")
	}
	if !canvasProposalAllowed("compress_image", "幫我壓縮這張圖", canvasChatOptions{ImageOptimizationAdvice: false}) {
		t.Fatal("explicit optimization request should be allowed even when advice is off")
	}
}

func TestCanvasProposalAllowed_AllowsExplicitImageTransforms(t *testing.T) {
	options := canvasChatOptions{ImageOptimizationAdvice: false}
	if !canvasProposalAllowed("mirror_image", "幫這張圖做水平鏡像", options) {
		t.Fatal("explicit mirror request should be allowed")
	}
	if !canvasProposalAllowed("mirror_image", "幫這張圖左右反轉", options) {
		t.Fatal("explicit reverse request should be allowed")
	}
	if !canvasProposalAllowed("mirror_image", "幫這張圖靚相", options) {
		t.Fatal("common mirror typo should be allowed")
	}
	if !canvasProposalAllowed("rotate_image", "把這張圖旋轉 90 度", options) {
		t.Fatal("explicit rotate request should be allowed")
	}
	if canvasProposalAllowed("rotate_image", "幫我看看這張圖", options) {
		t.Fatal("plain review request should not create a rotate proposal")
	}
}

func TestCanvasUserAsksAnnotation(t *testing.T) {
	for _, msg := range []string{"幫我圈出牙齒", "在這張圖加註解", "highlight the low contrast area"} {
		if !canvasUserAsksAnnotation(msg) {
			t.Fatalf("expected annotation request: %q", msg)
		}
	}
	for _, msg := range []string{"放大我看不清楚他的牙齒", "有蛀牙嗎", "這是啥"} {
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

func TestCanvasCaptureRequested(t *testing.T) {
	for _, input := range []string{
		"幫我排版後拍一張去背照",
		"匯出畫布給我看",
		"export the canvas",
		"download this layout",
	} {
		if !canvasCaptureRequested(input) {
			t.Fatalf("expected capture intent for %q", input)
		}
	}
	if canvasCaptureRequested("幫我排版") {
		t.Fatal("plain arrange request should not require capture")
	}
}

func TestCanvasFollowupShouldRetainImages(t *testing.T) {
	if !canvasFollowupShouldRetainImages(canvasLoopReasonMissingCapture, "幫我排版後拍一張") {
		t.Fatal("missing capture repair should retain images")
	}
	if !canvasFollowupShouldRetainImages(canvasLoopReasonCaptureOnlyWork, "安排分鏡 / 對戰 / 操控 / 鏡像 / 旋轉") {
		t.Fatal("capture-only manipulation repair should retain images")
	}
	if !canvasFollowupShouldRetainImages(canvasLoopReasonFocusOnlyNeedsAnswer, "安排分鏡 / 對戰 / 操控 / 鏡像 / 旋轉") {
		t.Fatal("focus-only manipulation repair should retain images")
	}
	for _, input := range []string{
		"幫我看看這張圖有沒有品質問題",
		"比較這兩張角色圖",
		"analyze this image quality",
	} {
		if !canvasFollowupShouldRetainImages(canvasLoopReasonToolResults, input) {
			t.Fatalf("expected visual request to retain images for %q", input)
		}
	}
	for _, input := range []string{
		"安排分鏡 / 對戰 / 操控 / 鏡像 / 旋轉",
		"把這張圖旋轉 90 度",
		"arrange these cards",
	} {
		if canvasFollowupShouldRetainImages(canvasLoopReasonToolResults, input) {
			t.Fatalf("expected manipulation request to drop follow-up images for %q", input)
		}
	}
}

func TestFallbackCanvasCaptureAction(t *testing.T) {
	action := fallbackCanvasCaptureAction("幫我排版後拍一張去背照", canvasSnapshot{})
	if action.Tool != "capture_canvas" {
		t.Fatalf("tool = %s", action.Tool)
	}
	if action.Params["transparent"] != true {
		t.Fatalf("transparent = %#v", action.Params["transparent"])
	}

	action = fallbackCanvasCaptureAction("截取選取範圍", canvasSnapshot{SelectedCardIDs: []string{"a"}})
	if action.Tool != "capture_selected" {
		t.Fatalf("selected tool = %s", action.Tool)
	}
}

func TestCanvasCaptureRepairPrompt_AsksModelToChooseMode(t *testing.T) {
	prompt := canvasCaptureRepairPrompt("幫我截取選取範圍")
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

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "幫這些圖片加標籤")
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

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "幫這些圖片加標籤")
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

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "只處理第一張")
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

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "複製五隻小狗讓牠散步")
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

	expanded := expandCanvasMultiSelectedActions(actions, canvas, "擷取圖片文字")
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
	planText := `我已定位到 P1 和 P2 的角色圖像，現在我將為您規劃幾個分鏡劇情。以下是建議的戰鬥場景構思：

分鏡 1：近身格鬥
• P1 從左側突襲
• P2 在右側防守並反擊`

	if !canvasTextOnlyResponseNeedsActionRepair(planText, false, 0, 3) {
		t.Fatal("deferred canvas work should request an action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair(planText, true, 0, 3) {
		t.Fatal("executed non-focus tools should not request another action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair(planText, false, 2, 3) {
		t.Fatal("last loop should not request another action repair")
	}
	if canvasTextOnlyResponseNeedsActionRepair("這張圖是 P1 角色站立姿勢。", false, 0, 3) {
		t.Fatal("plain visual answer should not request an action repair")
	}
	imagegenText := "我會用 imagegen 技能處理這次「真的打起來」的需求，先把目前圈選的 P1/P2 動作視為角色一致性參考，再產出真正有互動的戰鬥構圖。"
	if !canvasTextOnlyResponseNeedsActionRepair(imagegenText, false, 0, 3) {
		t.Fatal("short imagegen promise should request an action repair")
	}
}

func TestCanvasActionRepairPromptRequiresGenericToolActions(t *testing.T) {
	prompt := canvasActionRepairPrompt("幫我安排幾個分鏡")
	for _, want := range []string{"without producing an executable non-focus action", "Use canvas layout tools", "built-in imagegen capability", "Reply with only tool calls or action blocks"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("repair prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasFocusOnlyRepairPromptRequiresActionForManipulation(t *testing.T) {
	prompt := canvasFocusOnlyRepairPrompt("安排分鏡 / 對戰 / 操控 / 鏡像 / 旋轉")
	for _, want := range []string{"requires canvas work", "Do NOT call focus_card again", "non-focus canvas tool action", "mirror_image/rotate_image", "no prose"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("focus-only repair prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "answer the user's latest question in prose") {
		t.Fatalf("manipulation repair prompt should not switch to prose answer mode:\n%s", prompt)
	}
}

func TestCanvasFocusOnlyRepairPromptAllowsProseForVisualQuestion(t *testing.T) {
	prompt := canvasFocusOnlyRepairPrompt("這張圖是什麼？")
	for _, want := range []string{"did not answer", "answer the user's latest question in prose"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("focus-only answer prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasCaptureOnlyRepairPromptRequiresNonCaptureAction(t *testing.T) {
	prompt := canvasCaptureOnlyRepairPrompt("安排分鏡 / 對戰 / 操控 / 鏡像 / 旋轉")
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
	prompt := buildCanvasFollowupPrompt(canvasLoopReasonToolResults, "arrange these", canvas, nil, results, "I will arrange them.")
	if strings.Contains(prompt, "## Canvas State") {
		t.Fatalf("follow-up prompt should not include full canvas state:\n%s", prompt)
	}
	for _, want := range []string{"Original User Request", "arrange these", "card-1", "asset-1", "newCardIds", "dup-1", canvasLoopReasonToolResults} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("follow-up prompt missing %q:\n%s", want, prompt)
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

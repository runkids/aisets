package server

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

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
	unsafes := []string{"compress_image", "resize_image", "convert_image", "update_tags", "update_description", "update_ocr_text"}
	for _, name := range unsafes {
		if canvasToolSafe(name) {
			t.Errorf("%s should NOT be safe", name)
		}
	}
	if canvasToolSafe("nonexistent") {
		t.Error("unknown tool should not be safe")
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
		"zh-TW": "Respond in Traditional Chinese (繁體中文)",
		"zh-CN": "Respond in Simplified Chinese (简体中文)",
		"ja":    "Respond in Japanese (日本語)",
		"ko":    "Respond in Korean (한국어)",
	}
	for locale, want := range cases {
		prompt := canvasSystemPrompt(locale, canvasChatOptions{AutoLocale: true})
		if !strings.Contains(prompt, want) {
			t.Fatalf("%s prompt missing %q:\n%s", locale, want, prompt)
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
	if !strings.Contains(prompt, "Do not proactively propose compression, resizing, or format conversion") {
		t.Fatalf("prompt should restrict proactive optimization:\n%s", prompt)
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
	if !canvasProposalAllowed("compress_image", "幫我看看這張圖", canvasChatOptions{ImageOptimizationAdvice: true}) {
		t.Fatal("optimization advice on should allow proactive optimization proposals")
	}
	if !canvasProposalAllowed("compress_image", "幫我壓縮這張圖", canvasChatOptions{ImageOptimizationAdvice: false}) {
		t.Fatal("explicit optimization request should be allowed even when advice is off")
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

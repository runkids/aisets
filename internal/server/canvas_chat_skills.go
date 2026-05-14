package server

import (
	"strings"
)

const (
	canvasSkillLayout            = "layout"
	canvasSkillSearch            = "search"
	canvasSkillOCR               = "ocr"
	canvasSkillComments          = "comments"
	canvasSkillCapture           = "capture"
	canvasSkillQuality           = "quality"
	canvasSkillMetadataProposals = "metadata-proposals"
	canvasSkillFileProposals     = "file-proposals"
)

type canvasSkillFamily struct {
	ID          string
	Description string
	Triggers    []string
	Tools       []string
	Rules       string
}

type canvasSkillClassifyInput struct {
	Message string
	Canvas  canvasSnapshot
	Options canvasChatOptions
}

func canvasSkillCatalog() []canvasSkillFamily {
	return []canvasSkillFamily{
		{
			ID:          canvasSkillLayout,
			Description: "Canvas card focus, selection, movement, arrangement, visual sizing, grouping, and layer order.",
			Triggers:    []string{"move", "arrange", "layout", "select", "remove", "duplicate", "clone", "align", "distribute", "resize card", "front", "storyboard", "compose"},
			Tools: []string{
				"focus_card", "select_cards", "remove_cards", "duplicate_cards", "move_card", "arrange_cards",
				"align_cards", "distribute_cards", "resize_card", "bring_cards_to_front", "inspect_canvas",
			},
			Rules: `## Layout Skill
- Card positions are top-left canvas coordinates. Use each card's size when spacing items.
- Directional requests like right/left/up/down usually mean a nearby relative move, not a jump across the board.
- For arrange, storyboard, compose, or scene requests, operate on the canvas with duplicate_cards, arrange_cards, resize_card, align_cards, or distribute_cards; do not answer with only a written plan.
- For 8+ cards, prefer a broad multi-row layout about 1600-2400px wide with 160px+ horizontal and 120px+ vertical gaps unless the user asks for a tight collage.
- To put one image in front of another, use bring_cards_to_front; changing x/y does not change layer order.
- If visual overlap or spacing is uncertain, use inspect_canvas before finalizing.`,
		},
		{
			ID:          canvasSkillSearch,
			Description: "Project catalog search, detail lookup, and adding catalog results to the canvas.",
			Triggers:    []string{"search", "find", "show", "list", "catalog", "filename", "add assets"},
			Tools:       []string{"focus_card", "search_assets", "add_assets_to_canvas", "get_asset_detail"},
			Rules: `## Search Skill
- search_assets searches the ENTIRE PROJECT CATALOG, not just the current canvas.
- When the user asks to find, list, or show assets, use search_assets first. If they ask for one item, set limit: 1.
- If the request includes a filename or filename stem, search that exact stem before broader visual terms.
- Use get_asset_detail after search_assets when full metadata is needed. Use add_assets_to_canvas only after concrete catalog results should become cards.`,
		},
		{
			ID:          canvasSkillOCR,
			Description: "Extract visible text from catalog assets or uploaded canvas images.",
			Triggers:    []string{"ocr", "read text", "extract text", "visible text"},
			Tools:       []string{"focus_card", "extract_ocr_text"},
			Rules: `## OCR Skill
- Use extract_ocr_text with {"mode":"vlm","saveToMetadata":false} to return text in chat.
- For catalog assets, pass assetIds. For uploaded image cards, pass cardIds.
- Only save OCR metadata through update_ocr_text when the user explicitly asks to save or write OCR text.`,
		},
		{
			ID:          canvasSkillComments,
			Description: "Create, update, or delete canvas comment cards and annotations.",
			Triggers:    []string{"comment", "annotate", "mark", "circle", "highlight", "note"},
			Tools:       []string{"focus_card", "create_comment", "update_comment", "delete_comment"},
			Rules: `## Comment Skill
- Use create_comment only when the user explicitly asks to annotate, mark, circle, highlight, comment, or leave a note.
- Place comment cards away from image content; use region to point to the relevant area instead of covering the asset.
- If the user asks about an existing region or comment, answer in chat unless they ask you to add or update an annotation.`,
		},
		{
			ID:          canvasSkillCapture,
			Description: "Capture viewport, selected cards, or the whole canvas for user-visible screenshot/export preview.",
			Triggers:    []string{"capture", "screenshot", "export canvas", "take a picture", "transparent"},
			Tools:       []string{"focus_card", "inspect_canvas", "capture_viewport", "capture_canvas", "capture_selected"},
			Rules: `## Capture Skill
- Never say you cannot take a screenshot or export the canvas.
- Use capture_viewport, capture_canvas, or capture_selected to trigger the real frontend screenshot/export preview.
- If the user asks for transparent or no-background export, pass {"transparent": true}.
- inspect_canvas is only for hidden AI visual checking; it is not the user's final screenshot.`,
		},
		{
			ID:          canvasSkillQuality,
			Description: "Asset comparison, similarity, quality inspection, alt text, and general visual questions.",
			Triggers:    []string{"compare", "similar", "duplicate", "quality", "alt text", "describe", "what is this", "issue"},
			Tools:       []string{"focus_card", "get_asset_detail", "compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text", "inspect_canvas"},
			Rules: `## Quality Skill
- For general questions about an asset, focus the relevant card and answer in chat; use get_asset_detail or inspect_canvas when useful.
- Use compare_assets for explicit comparisons, find_similar_assets for duplicate/near-similar requests, inspect_image_quality for optimization/quality findings, and generate_alt_text for alt text drafts.
- Describe visual issues in chat. Do not create comments or file proposals unless the user explicitly asks for that action.`,
		},
		{
			ID:          canvasSkillMetadataProposals,
			Description: "Confirmed metadata proposals for tags, descriptions, OCR text, and favorite status.",
			Triggers:    []string{"tag", "description", "save ocr", "favorite", "metadata"},
			Tools:       []string{"focus_card", "update_tags", "batch_update_tags", "update_description", "update_ocr_text", "favorite_asset", "batch_favorite_assets"},
			Rules: `## Metadata Proposal Skill
- Metadata-writing tools create NEEDS_CONFIRMATION proposal cards; they do not apply changes directly.
- For multiple selected asset cards, emit one batch-capable proposal with assetIds.
- For descriptions or OCR text across multiple assets, use per-asset text fields unless the user explicitly asked for the same text on all images.`,
		},
		{
			ID:          canvasSkillFileProposals,
			Description: "Confirmed file/image operation proposals such as compression, conversion, resize, mirror, rotate, rename, move, copy, delete, favorite, and export.",
			Triggers:    []string{"compress", "convert", "resize image", "mirror", "flip", "rotate", "rename", "move file", "copy file", "delete", "export asset"},
			Tools: []string{
				"focus_card", "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image",
				"rename_asset", "move_asset", "copy_asset", "delete_asset", "export_asset",
			},
			Rules: `## File Proposal Skill
- File-writing tools create NEEDS_CONFIRMATION proposal cards; they do not apply changes directly.
- Only use these tools for explicit file/image operation requests.
- For multiple selected assets, emit one proposal with assetIds so the UI can show per-asset status.
- For mirror/flip, default to horizontal unless the user clearly asks for vertical. For rotate, default to 90 degrees when unspecified.`,
		},
	}
}

func canvasAllSkillIDs() []string {
	catalog := canvasSkillCatalog()
	ids := make([]string, 0, len(catalog))
	for _, skill := range catalog {
		ids = append(ids, skill.ID)
	}
	return ids
}

func classifyCanvasSkillFamilies(input canvasSkillClassifyInput) []string {
	msg := strings.ToLower(input.Message)
	var selected []string
	add := func(id string) {
		if id == "" {
			return
		}
		for _, existing := range selected {
			if existing == id {
				return
			}
		}
		selected = append(selected, id)
	}

	if containsAnyText(msg, "search", "find", "show", "list", "catalog", "filename", "asset named", "找", "搜尋", "搜索", "列出", "顯示", "檔名", "素材") {
		add(canvasSkillSearch)
	}
	if containsAnyText(msg, "ocr", "read text", "extract text", "visible text", "文字", "讀", "辨識", "提取", "擷取文字") {
		add(canvasSkillOCR)
	}
	if containsAnyText(msg, "comment", "annotate", "annotation", "mark", "circle", "highlight", "note", "註解", "標記", "圈", "高亮", "留言", "備註") {
		add(canvasSkillComments)
	}
	if containsAnyText(msg, "capture", "screenshot", "export canvas", "take a picture", "transparent", "截圖", "匯出畫布", "輸出畫布", "拍照", "透明") {
		add(canvasSkillCapture)
	}
	if containsAnyText(msg, "move", "arrange", "layout", "select", "remove", "duplicate", "clone", "align", "distribute", "resize card", "storyboard", "compose", "front", "behind", "right", "left", "up", "down", "分鏡", "安排", "排列", "移動", "選取", "移除", "複製", "對齊", "分散", "放大", "縮小", "前面", "後面", "右邊", "左邊", "上面", "下面") {
		add(canvasSkillLayout)
	}
	if containsAnyText(msg, "compare", "similar", "duplicate", "quality", "alt text", "describe", "what is", "what's", "issue", "problem", "比較", "相似", "重複", "品質", "畫質", "替代文字", "描述", "是什麼", "問題") {
		add(canvasSkillQuality)
	}
	if containsAnyText(msg, "tag", "tags", "description", "save ocr", "favorite", "metadata", "標籤", "描述", "說明", "儲存 ocr", "保存 ocr", "收藏", "中繼資料", "元資料") {
		add(canvasSkillMetadataProposals)
	}
	if containsAnyText(msg, "compress", "resize", "convert", "mirror", "flip", "rotate", "rename", "move file", "copy file", "copy asset", "delete file", "delete asset", "export asset", "optimize", "壓縮", "調整尺寸", "轉檔", "轉成", "鏡像", "翻轉", "旋轉", "重新命名", "刪除檔案", "刪檔", "匯出素材", "最佳化") {
		add(canvasSkillFileProposals)
	}
	if input.Options.ImageOptimizationAdvice && canvasUserAsksOptimizationReview(input.Message) {
		add(canvasSkillFileProposals)
	}

	if len(selected) == 0 {
		if len(input.Canvas.Cards) == 0 {
			add(canvasSkillSearch)
		} else {
			add(canvasSkillQuality)
		}
	}
	if len(selected) > 3 {
		selected = selected[:3]
	}
	return selected
}

func expandCanvasSkillFamiliesForLoopReason(skillIDs []string, reason string, latestUserMessage string, options canvasChatOptions) []string {
	next := append([]string(nil), skillIDs...)
	add := func(id string) {
		if !canvasStringListContains(next, id) {
			next = append(next, id)
		}
	}
	switch reason {
	case canvasLoopReasonMissingCapture:
		add(canvasSkillCapture)
	case canvasLoopReasonTextOnlyDeferredWork, canvasLoopReasonFocusOnlyNeedsAnswer, canvasLoopReasonCaptureOnlyWork:
		if canvasUserWantsCanvasAction(latestUserMessage) {
			add(canvasSkillLayout)
		}
		if containsAnyText(latestUserMessage,
			"compress", "resize", "convert", "mirror", "flip", "rotate", "optimize",
			"壓縮", "調整尺寸", "轉檔", "轉成", "鏡像", "翻轉", "旋轉", "最佳化",
		) {
			add(canvasSkillFileProposals)
		}
	}
	if options.ImageOptimizationAdvice && canvasUserAsksOptimizationReview(latestUserMessage) {
		add(canvasSkillFileProposals)
	}
	return next
}

func canvasSkillFamiliesByID(ids []string) []canvasSkillFamily {
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	var out []canvasSkillFamily
	for _, skill := range canvasSkillCatalog() {
		if wanted[skill.ID] {
			out = append(out, skill)
		}
	}
	return out
}

func canvasSkillRulesBlock(ids []string) string {
	var parts []string
	for _, skill := range canvasSkillFamiliesByID(ids) {
		if strings.TrimSpace(skill.Rules) != "" {
			parts = append(parts, strings.TrimSpace(skill.Rules))
		}
	}
	return strings.Join(parts, "\n\n")
}

func canvasStringListContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func canvasSkillToolNames(ids []string) []string {
	allowed := map[string]bool{}
	for _, skill := range canvasSkillFamiliesByID(ids) {
		for _, tool := range skill.Tools {
			allowed[tool] = true
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	var names []string
	for _, tool := range canvasToolRegistry() {
		if allowed[tool.Name] {
			names = append(names, tool.Name)
		}
	}
	return names
}

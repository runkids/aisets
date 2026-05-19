package server

import "strings"

const (
	canvasSkillLayout            = "layout"
	canvasSkillSearch            = "search"
	canvasSkillOCR               = "ocr"
	canvasSkillComments          = "comments"
	canvasSkillCapture           = "capture"
	canvasSkillPhotoStaging      = "photo-staging"
	canvasSkillQuality           = "quality"
	canvasSkillMetadataProposals = "metadata-proposals"
	canvasSkillFileProposals     = "file-proposals"
	canvasSkillAnnotation        = "annotation"
	canvasSkillDrawing           = "drawing"
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
			Triggers:    []string{"move", "arrange", "layout", "select", "remove", "duplicate", "copy", "clone", "group", "ungroup", "rename group", "align", "distribute", "resize card", "front", "storyboard", "compose"},
			Tools: []string{
				"focus_card", "select_cards", "remove_cards", "duplicate_cards", "group_cards", "ungroup_card", "rename_group", "move_card", "arrange_cards",
				"align_cards", "distribute_cards", "resize_card", "bring_cards_to_front", "inspect_canvas",
			},
			Rules: `## Layout Skill
- Card positions are top-left canvas coordinates. Use each card's size when spacing items.
- Directional requests like right/left/up/down usually mean a nearby relative move, not a jump across the board.
- For arrange, storyboard, compose, or scene requests, operate on the canvas with duplicate_cards, arrange_cards, resize_card, align_cards, or distribute_cards; do not answer with only a written plan.
- For grouping requests, use group_cards with the intended image card IDs and optional name. Use rename_group for a group label change and ungroup_card to break a group back into image cards.
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
- When the user asks for assets that contain visible text, call search_assets with {"q":"","hasText":true}.
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
			Triggers:    []string{"comment", "comments", "commend", "commends", "annotate", "mark", "circle", "highlight", "point to", "note"},
			Tools:       []string{"focus_card", "create_comment", "update_comment", "delete_comment"},
			Rules: `## Comment Skill
- Use create_comment only when the user explicitly asks to annotate, mark, circle, highlight, point to, comment, or leave a note.
- If the user asks where something is and also asks to circle/mark/highlight it, answer by creating a comment whose text states the answer and whose region tightly encloses that object/area.
- create_comment.region is relative to the anchored card image. x/y are the top-left corner of the target box, not the center point; y increases downward.
- If the requested target sits on another object, the region must enclose the target itself, not the host object or nearby context.
- If multiple distinct objects/areas must be circled, call create_comment once per target/region instead of making one oversized combined region.
- For small objects or text, include create_comment.visualCue or update_comment.visualCue with an English targetDescription and colorHex for the target pixels, so the tool can refine the marker against the original image.
- If an existing comment circle/region is wrong and the user asks to correct it, call update_comment with commentCardId and a replacement region. Do not create another comment unless the user asks for a new annotation.
- update_comment.region is relative to the existing comment anchor image and uses the same top-left normalized bounding-box format as create_comment.region.
- create_comment.region is the visible marker. Do not say you cannot directly circle, draw, or annotate; use create_comment instead.
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
			ID:          canvasSkillPhotoStaging,
			Description: "Professional photo staging, art direction, visual composition, and screenshot capture for all visible canvas images.",
			Triggers:    []string{"photo shoot", "photoshoot", "photographer", "photo staging", "stage photos", "art direct", "beautify", "make beautiful", "portfolio shot", "hero shot", "editorial composition"},
			Tools: []string{
				"focus_card", "select_cards", "inspect_canvas", "resize_card", "arrange_cards",
				"align_cards", "distribute_cards", "bring_cards_to_front", "mirror_image", "rotate_image",
				"capture_viewport", "capture_canvas",
			},
			Rules: `## Photo Staging Skill
- Act like a professional photographer and art director for the canvas.
- Use all visible image cards unless the user narrows the target set. Do not stage only the first selected card when the request says all images or the canvas.
- Create a finished composition, not a written plan: inspect the current board when useful, resize hero/supporting images, arrange with clear whitespace, align/distribute when it improves polish, use z-index/front layering for foreground heroes, and avoid accidental overlaps.
- Prefer a balanced editorial/product-shot layout with one focal area, supporting clusters, staggered rhythm, and negative space unless the user asks for a grid, row, collage, or storyboard.
- Use resize_card and arrange_cards for the actual composition, bring_cards_to_front for visual layering, and mirror_image or rotate_image only for a small number of deliberate PNG variants when a transformed image improves the composition direction or cover-like rhythm. Do not rotate, mirror, duplicate, or transform images merely to show tool capability.
- After the staging layout is complete, call capture_canvas for the full staged board or capture_viewport when the user explicitly asks for the current viewport. The final screenshot/export preview is part of the task.`,
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
			Description: "Image variant tools plus confirmed file-writing proposals such as rename, move, copy, delete, and export.",
			Triggers:    []string{"compress", "convert", "resize image", "mirror", "flip", "rotate", "rename", "move file", "copy file", "delete", "export asset"},
			Tools: []string{
				"focus_card", "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image",
				"rename_asset", "move_asset", "copy_asset", "delete_asset", "export_asset",
			},
			Rules: `## File Proposal Skill
- Image variant tools (compress_image, resize_image, convert_image, mirror_image, rotate_image) execute directly and create new preview image cards; they do not change source files.
- File-writing tools create NEEDS_CONFIRMATION proposal cards; they do not apply changes directly.
- Only use these tools for explicit file/image operation requests.
- For multiple selected assets, emit one action with assetIds so the UI can show per-asset status.
- For copy_asset with a different filename per source asset, use perAssetDestPaths with one destPath per asset.
- For mirror/flip, default to horizontal unless the user clearly asks for vertical. For rotate, default to 90 degrees when unspecified.`,
		},
		{
			ID:          canvasSkillAnnotation,
			Description: "Create and edit text annotations on the canvas.",
			Triggers:    []string{"text", "label", "title", "caption", "heading", "annotate text", "add text", "write text"},
			Tools:       []string{"focus_card", "create_text_card", "update_text_card", "remove_cards"},
			Rules: `## Annotation Skill
- Create text cards for annotations, labels, and titles. Use appropriate font sizes (24-32 for titles, 14-18 for labels). Place text near related content.`,
		},
		{
			ID:          canvasSkillDrawing,
			Description: "Create vector drawings and add shapes (rect, ellipse, line, arrow, path) on the canvas.",
			Triggers:    []string{"draw", "drawing", "sketch", "scribble", "circle", "rectangle", "arrow", "line", "shape", "highlight", "mark"},
			Tools:       []string{"focus_card", "create_drawing", "add_shape", "clear_drawing_shapes", "remove_cards"},
			Rules: `## Drawing Skill
- Use create_drawing to add a new drawing card, then add_shape repeatedly to place vector marks (rect/ellipse/line/arrow/path) inside it.
- Shape coordinates are in the drawing card's viewBox (0,0 = card top-left, up to width/height).
- Prefer red (#ef4444) or amber (#f59e0b) strokes when highlighting attention. Use strokeWidth 4-6 for normal marks and 2 for fine annotations.
- Do not call create_drawing repeatedly when an existing empty drawing card is selected; reuse it via add_shape.`,
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

func normalizeCanvasSelectedSkillIDs(ids []string) []string {
	allowed := map[string]bool{}
	for _, skill := range canvasSkillCatalog() {
		allowed[skill.ID] = true
	}
	seen := map[string]bool{}
	var out []string
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if !allowed[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func canvasDefaultSkillIDs() []string {
	return []string{
		canvasSkillLayout,
		canvasSkillSearch,
	}
}

func classifyCanvasSkillFamilies(input canvasSkillClassifyInput) []string {
	message := strings.ToLower(strings.TrimSpace(input.Message))
	if message == "" {
		return canvasDefaultSkillIDs()
	}
	var ids []string
	for _, skill := range canvasSkillCatalog() {
		for _, trigger := range skill.Triggers {
			if canvasSkillTriggerMatches(message, trigger) {
				ids = append(ids, skill.ID)
				break
			}
		}
	}
	if canvasSelectedFormatProposalRequested(message, input.Canvas) && !canvasStringListContains(ids, canvasSkillFileProposals) {
		ids = append(ids, canvasSkillFileProposals)
	}
	if len(ids) == 0 {
		return canvasDefaultSkillIDs()
	}
	return ids
}

func canvasSkillTriggerMatches(message string, trigger string) bool {
	trigger = strings.ToLower(strings.TrimSpace(trigger))
	if trigger == "" {
		return false
	}
	if strings.ContainsFunc(trigger, func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	}) {
		return strings.Contains(message, trigger)
	}
	if len(trigger) <= 3 {
		for _, token := range strings.FieldsFunc(message, func(r rune) bool {
			return (r < 'a' || r > 'z') && (r < '0' || r > '9')
		}) {
			if token == trigger || token == trigger+"s" {
				return true
			}
		}
		return false
	}
	return strings.Contains(message, trigger)
}

func canvasSelectedFormatProposalRequested(message string, canvas canvasSnapshot) bool {
	if len(canvas.SelectedCardIDs) == 0 || canvasMessageLooksLikeCatalogLookup(message) {
		return false
	}
	for _, token := range strings.FieldsFunc(message, func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	}) {
		switch token {
		case "webp", "avif":
			return true
		}
	}
	return false
}

func canvasMessageLooksLikeCatalogLookup(message string) bool {
	for _, term := range []string{"search", "find", "show", "list", "catalog", "filename", "add assets"} {
		if strings.Contains(message, term) {
			return true
		}
	}
	return false
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
	case canvasLoopReasonIncompleteTextAnnotation:
		add(canvasSkillComments)
	case canvasLoopReasonOCRTextExtraction:
		add(canvasSkillOCR)
	case canvasLoopReasonFocusOnlyNeedsAnswer, canvasLoopReasonCaptureOnlyWork:
		add(canvasSkillLayout)
	case canvasLoopReasonTextOnlyDeferredWork:
		add(canvasSkillLayout)
		add(canvasSkillFileProposals)
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

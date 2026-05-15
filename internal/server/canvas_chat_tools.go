package server

import (
	"encoding/json"
	"fmt"
	"strings"

	"aisets/internal/llm"
)

type canvasToolDef struct {
	Name        string
	Description string
	Parameters  map[string]any
	Cardinality string
	Safe        bool
}

func canvasToolRegistry() []canvasToolDef {
	return withCanvasToolParameters([]canvasToolDef{
		{
			Name:        "focus_card",
			Description: "Move your cursor to a card on the canvas. Use before examining or modifying an asset.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "search_assets",
			Description: "Search the ENTIRE PROJECT CATALOG (not just canvas) for assets by filename, path, AI tags, description, or OCR text. Use hasText=true with q=\"\" to list text-bearing assets that already have ready OCR text. Returns full AssetItem objects that can be added directly to the canvas.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "add_assets_to_canvas",
			Description: "Add one or more catalog assets to the canvas by asset ID. Use after search_assets when specific search results should become cards.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "extract_ocr_text",
			Description: "Extract visible text from one or more selected/mentioned catalog or uploaded canvas images using VLM OCR and return the text in chat. Use assetIds for catalog assets and cardIds for uploaded image cards. Does not write metadata unless saveToMetadata is explicitly true.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "get_asset_detail",
			Description: "Get full details about a specific asset: project, local path, dimensions, AI tags, OCR text, used-by references. Use after search_assets to get details.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "create_comment",
			Description: "Leave a visible canvas comment on an asset card, optionally pinned to a normalized image region. Use this to circle, mark, highlight, or point to a specific object/area in the image. The region is a tight bounding box around one target on the anchored card image: x/y are the top-left corner, not the center point, and y increases downward. If the request has multiple distinct targets, call create_comment once per target/region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.colorHex for the target pixels so the tool can refine the visible marker. Put the location answer in the comment text.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "update_comment",
			Description: "Update one existing comment card on the canvas, including its text and/or pinned normalized image region. Use this to correct a wrong circle, mark, highlight, or pointed area on an existing annotation. The region is relative to the existing comment anchor image and must tightly enclose the target itself. For small objects or text, include visualCue.colorHex for the target pixels so the tool can refine the visible marker. This changes canvas notes only, not project files.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "delete_comment",
			Description: "Delete one existing comment card from the canvas. This changes canvas notes only, not project files.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "select_cards",
			Description: "Select one or more cards on the canvas. Use when the user asks to select/focus multiple items or when subsequent actions should target a group.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "remove_cards",
			Description: "Remove one or more cards from the canvas only. This is safe and does NOT delete project files. Use to clean up extra search results, wrong candidates, comments, proposals, or temporary cards.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "duplicate_cards",
			Description: "Duplicate one or more image cards on the canvas. Use when the user asks to copy/clone an image visually, such as making five copies of a dog image and arranging them like a walking sequence. This does not edit pixels or source files.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "move_card",
			Description: "Move a single card to a new position on the canvas.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "arrange_cards",
			Description: "Reposition multiple cards at once. Use to organize the canvas layout (e.g. grid, row, group by category).",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "align_cards",
			Description: "Align multiple cards by left, center, right, top, middle, or bottom without changing source files.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "distribute_cards",
			Description: "Evenly distribute multiple cards horizontally or vertically on the canvas without changing source files.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "resize_card",
			Description: "Resize an asset card visually on the canvas by setting its displayed width. Use with arrange_cards when a layout needs larger hero images or smaller supporting images. This does not modify the source file.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "bring_cards_to_front",
			Description: "Move one or more cards to a higher visual layer. Use when the user asks to put an image on top/in front/above another image. If afterCardId is provided, insert the cards immediately above that target card; otherwise move them to the very front. This changes canvas layer order, not position or file contents.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "inspect_canvas",
			Description: "Create a hidden AI-only rendered snapshot of the current canvas layout and attach it to the next reasoning step. Use when you are unsure about visual overlap, stacking, spacing, or composition. This does NOT show a preview to the user.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "capture_viewport",
			Description: "Trigger the frontend screenshot control to capture the currently visible canvas viewport and show the normal screenshot preview.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "capture_canvas",
			Description: "Trigger the frontend screenshot control to capture the entire canvas and show the normal screenshot preview.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "capture_selected",
			Description: "Trigger the frontend screenshot control to capture the selected cards and show the normal screenshot preview.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "compare_assets",
			Description: "Compare two assets by default, or N assets as a comparison table with dimensions, size, format, tags, OCR availability, duplicate and similarity metadata.",
			Cardinality: "pair",
			Safe:        true,
		},
		{
			Name:        "find_similar_assets",
			Description: "Find duplicate or near-similar assets for one or more source images and de-duplicate the result list.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "inspect_image_quality",
			Description: "Inspect image quality and optimization findings for one or more assets. Multi-image results include grouped summary and per-asset issues.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "generate_alt_text",
			Description: "Prepare per-asset alt text proposal guidance for one or more assets. For multiple images, return one proposal per asset.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "compress_image",
			Description: "Generate a compressed image variant (WebP, AVIF, PNG) without changing the source file.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "resize_image",
			Description: "Generate a resized image variant that fits within a max dimension without changing the source file.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "convert_image",
			Description: "Generate a converted image variant in another format without changing the source file.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "mirror_image",
			Description: "Generate a mirrored/flipped image variant using Rust imgtools. Use for clear mirror, flip, or reverse-image requests. This preserves the source file.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "rotate_image",
			Description: "Generate a rotated image variant using Rust imgtools. Use for clear rotate, rotation, turn, clockwise, or 90/180/270 degree rotation requests. This preserves the source file.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "update_tags",
			Description: "Set the tags for an asset. Replaces existing tags.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "batch_update_tags",
			Description: "Set the same tag list on multiple assets in one batch proposal.",
			Cardinality: "batchOnly",
			Safe:        false,
		},
		{
			Name:        "update_description",
			Description: "Set the description for one or more assets. For multiple assets, use perAssetDescriptions unless the user explicitly asked for the same text on all images.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "update_ocr_text",
			Description: "Set or override OCR text. For multiple assets, only write per-asset OCR results; do not apply the same text to all images unless the user explicitly asked for that.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "rename_asset",
			Description: "Rename an asset file. Provide the new filename (with extension).",
			Cardinality: "single",
			Safe:        false,
		},
		{
			Name:        "move_asset",
			Description: "Move an asset to a different directory within the project.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "copy_asset",
			Description: "Copy one or more assets to a new location. For text-derived filenames across multiple assets, use perAssetDestPaths with one destPath per asset.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "delete_asset",
			Description: "Delete an asset file from the project. This is destructive and cannot be undone.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "favorite_asset",
			Description: "Toggle favorite status on an asset.",
			Cardinality: "multi",
			Safe:        false,
		},
		{
			Name:        "batch_favorite_assets",
			Description: "Toggle favorite status on multiple assets in one batch proposal.",
			Cardinality: "batchOnly",
			Safe:        false,
		},
		{
			Name:        "export_asset",
			Description: "Export/download an asset to a specified output directory.",
			Cardinality: "multi",
			Safe:        false,
		},
	})
}

func canvasToolSafe(name string) bool {
	for _, t := range canvasToolRegistry() {
		if t.Name == name {
			return t.Safe
		}
	}
	return false
}

func canvasToolCardinality(name string) string {
	for _, t := range canvasToolRegistry() {
		if t.Name == name {
			return t.Cardinality
		}
	}
	return ""
}

func canvasToolsBlock() string {
	return canvasToolsBlockForSkills(canvasAllSkillIDs())
}

func canvasToolsBlockForSkills(skillIDs []string) string {
	names := canvasSkillToolNames(skillIDs)
	if len(names) == 0 {
		names = canvasSkillToolNames(canvasAllSkillIDs())
	}
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
	}
	var b strings.Builder
	for _, t := range canvasToolRegistry() {
		if !allowed[t.Name] {
			continue
		}
		safety := "SAFE"
		if !t.Safe {
			safety = "NEEDS_CONFIRMATION"
		}
		fmt.Fprintf(&b, "- %s [%s, cardinality=%s]: %s\n  params: %s\n", t.Name, safety, t.Cardinality, t.Description, canvasToolParamsText(t.Parameters))
	}
	return b.String()
}

func canvasLLMTools() []llm.ChatTool {
	return canvasLLMToolsForSkills(canvasAllSkillIDs())
}

func canvasLLMToolsForSkills(skillIDs []string) []llm.ChatTool {
	return canvasLLMToolsForSkillsMode(skillIDs, false)
}

func canvasNativeLLMToolsForSkills(skillIDs []string) []llm.ChatTool {
	return canvasLLMToolsForSkillsMode(skillIDs, true)
}

func canvasLLMToolsForSkillsMode(skillIDs []string, compact bool) []llm.ChatTool {
	names := canvasSkillToolNames(skillIDs)
	if len(names) == 0 {
		names = canvasSkillToolNames(canvasAllSkillIDs())
	}
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
	}
	tools := make([]llm.ChatTool, 0, len(canvasToolRegistry()))
	for _, t := range canvasToolRegistry() {
		if !allowed[t.Name] {
			continue
		}
		parameters := t.Parameters
		description := fmt.Sprintf("%s Params: %s Cardinality: %s Safety: %s.", t.Description, canvasToolParamsText(t.Parameters), t.Cardinality, canvasToolSafetyLabel(t.Safe))
		if compact {
			description = fmt.Sprintf("%s Cardinality: %s. Safety: %s.", canvasCompactToolDescription(t.Description), t.Cardinality, canvasToolSafetyLabel(t.Safe))
			if t.Name == "create_comment" || t.Name == "update_comment" {
				description = fmt.Sprintf("%s Cardinality: %s. Safety: %s.", t.Description, t.Cardinality, canvasToolSafetyLabel(t.Safe))
			}
			parameters = canvasCompactToolParameters(t.Parameters)
		}
		tools = append(tools, llm.ChatTool{
			Name:        t.Name,
			Description: description,
			Parameters:  parameters,
		})
	}
	return tools
}

func canvasCompactToolDescription(description string) string {
	description = strings.TrimSpace(description)
	if before, _, ok := strings.Cut(description, "."); ok {
		return strings.TrimSpace(before) + "."
	}
	return description
}

func canvasCompactToolParameters(schema map[string]any) map[string]any {
	compact, _ := canvasCompactSchemaValue(schema).(map[string]any)
	return compact
}

func canvasCompactSchemaValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			if key == "description" && !canvasKeepCompactSchemaDescription(typed, child) {
				continue
			}
			out[key] = canvasCompactSchemaValue(child)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, child := range typed {
			out = append(out, canvasCompactSchemaValue(child))
		}
		return out
	default:
		return value
	}
}

func canvasKeepCompactSchemaDescription(parent map[string]any, value any) bool {
	description, ok := value.(string)
	if !ok {
		return false
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return false
	}
	lowerDescription := strings.ToLower(description)
	return strings.Contains(lowerDescription, "anchored card image") ||
		strings.Contains(lowerDescription, "anchor image") ||
		strings.Contains(lowerDescription, "normalized bounding box") ||
		strings.Contains(lowerDescription, "top-left corner") ||
		strings.Contains(lowerDescription, "y increases downward") ||
		strings.Contains(lowerDescription, "tight box around only the visible target") ||
		strings.Contains(lowerDescription, "not the whole canvas screenshot") ||
		strings.Contains(lowerDescription, "visual cue") ||
		strings.Contains(lowerDescription, "target pixels") ||
		strings.Contains(lowerDescription, "colorrgb") ||
		strings.Contains(lowerDescription, "colorhex") ||
		strings.Contains(lowerDescription, "#rrggbb")
}

func canvasToolSchemaBytes(tools []llm.ChatTool) int {
	if len(tools) == 0 {
		return 0
	}
	data, err := json.Marshal(tools)
	if err != nil {
		return 0
	}
	return len(data)
}

func canvasToolSafetyLabel(safe bool) string {
	if safe {
		return "SAFE"
	}
	return "NEEDS_CONFIRMATION"
}

func canvasProposalGuidance(options canvasChatOptions) string {
	if options.ImageOptimizationAdvice {
		return "- Image optimization advice is ON. You may proactively inspect selected or visible image assets for web delivery opportunities using format, dimensions, byte size, transparency/animation hints, and visual content. When useful, call image variant tools such as compress_image, resize_image, or convert_image; they generate new preview images and preserve source files.\n- Keep metadata or file-writing proposals (update_tags, batch_update_tags, update_description, rename, move, delete, export, favorite, batch_favorite_assets) tied to the user's explicit request."
	}

	return "- Image optimization advice is OFF. Do NOT proactively call image variant tools or create NEEDS_CONFIRMATION proposal cards for a general review. Use image/file tools only when the user's latest request explicitly asks for that operation.\n- Do not call compress_image, resize_image, convert_image, mirror_image, rotate_image, update_tags, batch_update_tags, update_description, rename_asset, move_asset, copy_asset, delete_asset, favorite_asset, batch_favorite_assets, or export_asset just because an asset seems improvable."
}

func canvasPromptLocaleDisplayName(locale string) string {
	name := llm.LocaleDisplayName(locale)
	if name == "" {
		return ""
	}
	if before, _, ok := strings.Cut(name, " ("); ok {
		return before
	}
	return name
}

func canvasSystemPromptForSkills(locale string, options canvasChatOptions, skillIDs []string) string {
	return canvasSystemPromptForSkillsMode(locale, options, skillIDs, false)
}

func canvasNativeSystemPromptForSkills(locale string, options canvasChatOptions, skillIDs []string) string {
	return canvasSystemPromptForSkillsMode(locale, options, skillIDs, true)
}

func canvasSystemPromptForSkillsMode(locale string, options canvasChatOptions, skillIDs []string, nativeTools bool) string {
	lang := "English"
	if options.AutoLocale {
		lang = canvasPromptLocaleDisplayName(locale)
		if lang == "" && strings.HasPrefix(locale, "zh") {
			lang = canvasPromptLocaleDisplayName("zh-TW")
		}
		if lang == "" {
			lang = "English"
		}
	}
	if len(skillIDs) == 0 {
		skillIDs = canvasAllSkillIDs()
	}
	if nativeTools {
		return canvasNativeSystemPromptCompact(lang, options, skillIDs)
	}
	if options.PhotoStagingWorkflow {
		return canvasActionPhotoStagingSystemPromptCompact(lang, options, skillIDs)
	}
	skillRules := canvasSkillRulesBlock(skillIDs)
	if strings.TrimSpace(skillRules) == "" {
		skillRules = "No additional skill rules selected."
	}

	toolBlock := ""
	responseFormat := fmt.Sprintf(`## Response Format
Use English for all internal reasoning, tool names, tool arguments, labels, descriptions, impacts, status codes, and action metadata. Only natural-language assistant text should be written in %s. EVERY response MUST include at least one tool call. Prefer tool calls first; keep prose short and never spend many tokens before a large layout action.`, lang)
	toolBlock = fmt.Sprintf("## Available Tools\n%s", canvasToolsBlockForSkills(skillIDs))
	responseFormat = fmt.Sprintf(`## Response Format
Use English for all internal reasoning, tool names, tool arguments, labels, descriptions, impacts, status codes, and action metadata. Only natural-language assistant text should be written in %s. EVERY response MUST include at least one bracket action block. Do NOT use call, call:, <tool_call>, bare JSON, or prose-only completion claims in assistant text. Prefer action blocks first; keep prose short and never spend many tokens before a large layout action.

Required bracket action-block format:
[action: tool_name]
description: what this does
impact: expected effect
paramName: value

For image-region comments, use flat region and visual cue fields:
[action: create_comment]
description: Add a pinned annotation
impact: Creates a visible comment marker
anchorCardId: card-id
text: Short visible explanation
regionX: 0.29
regionY: 0.19
regionWidth: 0.11
regionHeight: 0.08
visualCueTargetDescription: small pink peach icon
visualCueColorHex: #f26aa0`, lang)

	return fmt.Sprintf(`You are a pair partner on a visual asset canvas. You WORK on the canvas — you don't just talk. The user can see your cursor moving and your actions appearing as cards.

## Core Identity
- You are a collaborator, not a passive chatbot.
- Move your cursor to relevant assets before speaking about them when a card exists.
- Take concrete canvas actions that match the user's request.
- Leave comments only when the user explicitly asks to annotate, mark, circle, highlight, point to, or leave a note.
- When the user asks where an object/area is and also asks to circle, mark, highlight, or point to it, use create_comment with a tight normalized region around the actual visible target and put the answer in the comment text. If the user asks for multiple distinct targets or areas, create one comment per target/region instead of one oversized combined region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. Never answer that you cannot directly annotate the canvas.
- Always do something useful; pure text without a tool call is forbidden.

## Active Skill Families
%s

%s

%s

## Hard Rules
1. If there are cards on the canvas, start with focus_card to move your cursor.
2. SAFE tools execute immediately and you will receive their results. You can then act on the results in a follow-up turn.
3. NEEDS_CONFIRMATION tools become proposal cards the user must approve.
4. Include "description" and "impact" in every action block.
5. For canvas tools, use card IDs. For file/catalog tools that require asset IDs, use the ASSET ID from the canvas state.
6. Every tool has cardinality. With multiple selected/mentioned assets, default to ALL selected/mentioned assets and pass assetIds/cardIds.
7. Destructive or file-writing multi-image tools must be one batch proposal with assetIds, not many separate proposal cards.
8. Do not put display labels in tool params. The app renders localized status text from tool names and result codes.
9. Keep natural-language explanation short after tools. Do not write a long plan before concrete actions.
10. When an operation pattern names a tool chain and the arguments are known, call every required tool in that chain before stopping. Do not stop after only a partial chain.

## Operation Patterns
- Search and add N relevant assets: search_assets -> add_assets_to_canvas -> arrange_cards when a row/grid/layout is requested.
- Search with metadata inspection: search_assets -> get_asset_detail for the chosen asset -> add_assets_to_canvas.
- Current selection layout: select_cards with all selected card IDs -> distribute_cards -> align_cards when equal spacing and edge alignment are both requested.
- Enlarge, move, and layer a hero/main image: focus_card -> resize_card -> move_card or arrange_cards -> bring_cards_to_front.
- Duplicate selected images and clean up candidates: duplicate_cards -> arrange_cards for the source/new cards -> remove_cards only for clearly unrelated visible cards.
- Professional photo staging / art direction: act as a professional photographer and use focus_card or select_cards -> inspect_canvas when composition is uncertain -> resize_card for hero/supporting scale -> arrange_cards with polished spacing -> capture_canvas or capture_viewport.
- OCR readout: extract_ocr_text with saveToMetadata=false. Do not call metadata-writing tools unless the user explicitly asks to save OCR.
- Annotation/comment: focus_card -> create_comment. Use create_comment.region to circle, mark, highlight, or point to a specific visual object/area. The region is relative to the anchored card image, x/y are the top-left of the target box, and the box should tightly enclose the actual target rather than nearby decoration, host objects, or surrounding context. If multiple distinct objects/areas must be circled, call create_comment once per target/region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. If the user asks where something is and asks to circle/mark it, put the answer in comment text and create the region; do not answer that you cannot directly annotate.
- Existing annotation correction: focus_card -> update_comment. Use update_comment.region to replace an incorrect circle/mark/highlight on an existing comment; include visualCue for small objects/text; do not create a duplicate comment when the user asks to fix the current annotation.
- Capture workflow: capture_viewport for the visible area; capture_selected for selected cards. Set transparent=true when the user asks for transparent/no-background output.
- Similarity, quality, and alt text workflow: compare_assets -> find_similar_assets or inspect_image_quality -> generate_alt_text for the requested target.
- Image variants versus proposals: rotate_image, mirror_image, compress_image, resize_image, and convert_image create variant cards directly; rename_asset, move_asset, copy_asset, delete_asset, and metadata writes must be proposal cards only.

## Canvas Strategy Preset
%s

## Proposal Discipline
%s

## Selected Skill Instructions
%s`,
		strings.Join(skillIDs, ", "),
		toolBlock,
		responseFormat,
		options.CanvasStrategy,
		canvasProposalGuidance(options),
		skillRules,
	)
}

func canvasActionPhotoStagingSystemPromptCompact(lang string, options canvasChatOptions, skillIDs []string) string {
	return fmt.Sprintf(`You are a professional photographer and art director working on a visual asset canvas. Work by emitting bracket action blocks, not prose plans.

Language: use English for internal reasoning, tool names, args, labels, descriptions, impacts, and status. Only final user-facing prose should be in %s.

Action block format:
[action: tool_name]
description: concise English description
impact: concise English impact
paramName: value

Allowed tools for this workflow: focus_card, select_cards, inspect_canvas, resize_card, arrange_cards, align_cards, distribute_cards, bring_cards_to_front, mirror_image, rotate_image, capture_canvas, capture_viewport.

Photo staging contract:
1. Stage all visible image cards listed in the user prompt unless the user narrows the target set.
2. Do not capture first. Capture is terminal only after real staging work.
3. Avoid a rigid equal-size grid unless asked for a grid. Build focal hierarchy, supporting clusters, negative space, rhythm, and readable visual flow.
4. Use resize_card and arrange_cards for the actual composition, align_cards/distribute_cards only when they improve spacing, and bring_cards_to_front when z-index/front layering improves depth.
5. mirror_image and rotate_image are optional art-direction tools for a small number of images only when a transformed PNG variant clearly improves composition direction or story. Do not rotate, mirror, duplicate, or transform images merely to show capability.
6. Use inspect_canvas when composition, overlap, or stacking is uncertain.
7. After the layout expresses the requested style, call capture_canvas unless the user explicitly asks for viewport capture.
8. After capture, stop action blocks and reply with a concise staging concept and rationale in the user's language.

Suggested chain: focus_card or select_cards -> inspect_canvas when useful -> resize_card -> arrange_cards -> bring_cards_to_front when layering matters -> optional mirror_image/rotate_image for a few deliberate variants -> capture_canvas.

Canvas strategy: %s
Active skill families: %s`, lang, options.CanvasStrategy, strings.Join(skillIDs, ", "))
}

func canvasNativeSystemPromptCompact(lang string, options canvasChatOptions, skillIDs []string) string {
	if options.PhotoStagingWorkflow {
		return canvasNativePhotoStagingSystemPromptCompact(lang, options, skillIDs)
	}
	return fmt.Sprintf(`You are a pair partner on a visual asset canvas. Work by calling native tools, not by explaining plans.

Native tools are attached to this request. Use native tool calls directly; do not print tool JSON, action fences, call:, <tool_call>, or bare JSON in assistant text.

## Language Contract
- Use English for internal reasoning, tool names, tool arguments, labels, descriptions, impacts, status codes, and action metadata.
- Only natural-language assistant text should be written in %s.

## Rules
1. Initial and repair responses must include at least one native tool call. After a tool result, call the next needed tool or give a short final answer if the request is fulfilled.
2. If a relevant card exists, focus it before modifying or commenting on it.
3. Use card IDs for canvas tools and asset IDs for catalog/file tools.
4. SAFE tools execute immediately; NEEDS_CONFIRMATION tools create proposal cards.
5. Do not put display labels in tool params; the app localizes UI status itself.
6. Keep prose short after tools.
7. When the user asks where an object/area is and also asks to circle, mark, highlight, or point to it, use create_comment with a tight normalized region around the actual visible target and put the answer in the comment text. The region is relative to the anchored card image, x/y are the top-left of the target box, and y increases downward. If multiple distinct objects/areas must be circled, call create_comment once per target/region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. Never answer that you cannot directly annotate the canvas.
8. When an operation pattern names a tool chain and the arguments are known, call every required tool in that chain before stopping. Do not stop after only a partial chain.

## Operation Patterns
- Search and add N relevant assets: search_assets -> add_assets_to_canvas -> arrange_cards when a row/grid/layout is requested.
- Search with metadata inspection: search_assets -> get_asset_detail for the chosen asset -> add_assets_to_canvas.
- Current selection layout: select_cards with all selected card IDs -> distribute_cards -> align_cards when equal spacing and edge alignment are both requested.
- Enlarge, move, and layer a hero/main image: focus_card -> resize_card -> move_card or arrange_cards -> bring_cards_to_front.
- Duplicate selected images and clean up candidates: duplicate_cards -> arrange_cards for the source/new cards -> remove_cards only for clearly unrelated visible cards.
- Professional photo staging / art direction: act as a professional photographer and use focus_card or select_cards -> inspect_canvas when composition is uncertain -> resize_card for hero/supporting scale -> arrange_cards with polished spacing -> capture_canvas or capture_viewport.
- OCR readout: extract_ocr_text with saveToMetadata=false. Do not call metadata-writing tools unless the user explicitly asks to save OCR.
- Annotation/comment: focus_card -> create_comment. Use create_comment.region to circle, mark, highlight, or point to a specific visual object/area. The region is relative to the anchored card image, x/y are the top-left of the target box, and the box should tightly enclose the actual target rather than nearby decoration, host objects, or surrounding context. If multiple distinct objects/areas must be circled, call create_comment once per target/region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. If the user asks where something is and asks to circle/mark it, put the answer in comment text and create the region; do not answer that you cannot directly annotate.
- Existing annotation correction: focus_card -> update_comment. Use update_comment.region to replace an incorrect circle/mark/highlight on an existing comment; include visualCue for small objects/text; do not create a duplicate comment when the user asks to fix the current annotation.
- Capture workflow: capture_viewport for the visible area; capture_selected for selected cards. Set transparent=true when the user asks for transparent/no-background output.
- Similarity, quality, and alt text workflow: compare_assets -> find_similar_assets or inspect_image_quality -> generate_alt_text for the requested target.
- Image variants versus proposals: rotate_image, mirror_image, compress_image, resize_image, and convert_image create variant cards directly; rename_asset, move_asset, copy_asset, delete_asset, and metadata writes must be proposal cards only.

## Canvas Strategy Preset
%s

## Proposal Discipline
%s

Active skill families: %s`, lang, options.CanvasStrategy, canvasProposalGuidance(options), strings.Join(skillIDs, ", "))
}

func canvasNativePhotoStagingSystemPromptCompact(lang string, options canvasChatOptions, skillIDs []string) string {
	return fmt.Sprintf(`You are a professional photographer and art director working on a visual asset canvas. Use native tools directly; do not print JSON/action fences unless native tools fail.

Language: use English for internal reasoning, tool names, args, labels, descriptions, impacts, and status. Only final user-facing prose should be in %s.

Photo staging contract:
1. Stage all visible image cards listed in the user prompt unless the user narrows the target set.
2. Do not capture first. Capture is terminal only after real staging work.
3. Avoid a rigid equal-size grid unless the user asks for a grid. Build focal hierarchy, supporting clusters, negative space, rhythm, and readable visual flow.
4. Use resize_card and arrange_cards for the actual composition, align_cards/distribute_cards only when they improve spacing, and bring_cards_to_front when z-index/front layering improves depth.
5. mirror_image and rotate_image are optional art-direction tools for a small number of images only when a transformed PNG variant clearly improves composition direction or story. Do not rotate, mirror, duplicate, or transform images merely to show capability.
6. Use inspect_canvas when composition, overlap, or stacking is uncertain.
7. After the layout expresses the requested style, call capture_canvas unless the user explicitly asks for viewport capture.
8. After capture, stop calling tools and reply with a concise staging concept and rationale in the user's language.

Suggested chain: focus_card or select_cards -> inspect_canvas when useful -> resize_card -> arrange_cards -> bring_cards_to_front when layering matters -> optional mirror_image/rotate_image for a few deliberate variants -> capture_canvas.

Canvas strategy: %s
Active skill families: %s`, lang, options.CanvasStrategy, strings.Join(skillIDs, ", "))
}

func canvasSystemPrompt(locale string, options canvasChatOptions) string {
	lang := "English"
	if options.AutoLocale {
		lang = canvasPromptLocaleDisplayName(locale)
		if lang == "" && strings.HasPrefix(locale, "zh") {
			lang = canvasPromptLocaleDisplayName("zh-TW")
		}
		if lang == "" {
			lang = "English"
		}
	}

	return fmt.Sprintf(`You are a pair partner on a visual asset canvas. You WORK on the canvas — you don't just talk. The user can see your cursor moving and your actions appearing as cards.

## Identity
You are NOT a chatbot. You are a collaborator who:
- Moves your cursor to assets before speaking about them
- Takes concrete actions that match the user's request
- Leaves comments only when the user explicitly asks to annotate, mark, circle, highlight, or leave a note
- Searches for related assets when context would help
- Always does something useful, never just describes

## Canvas Layout
Card positions are top-left canvas coordinates. Use each card's size=WIDTHxHEIGHT from Canvas State when arranging; do not assume every card is 320px wide. Leave at least 80px whitespace between bounding boxes for "spread out" requests. Layer values indicate render order (higher usually appears on top), but move_card/arrange_cards cannot change z-index, so avoid overlap instead of relying on stacking.

## Canvas Scale
Canvas coordinates are CSS pixels in an unbounded board. Use this scale:
- 100px = small nudge
- 200-350px = nearby move / place beside
- 600px+ = large jump across the board
For "move this to the right/left/up/down" without a distance, compute a nearby relative position from the card's current x/y and size. Preserve visual context; do not jump to a far coordinate just because the canvas is large.
For "place A to the right of B", use B.x + B.width + 80-160px and keep y close to B unless the user asks for diagonal placement or a new row.

## Available Tools
%s
## Response Format
Use English for all internal reasoning, tool names, tool arguments, labels, descriptions, impacts, status codes, and action metadata. Only natural-language assistant text should be written in %s. EVERY response MUST include at least one tool call. Prefer native tool calls when the API exposes them; do not print tool JSON in normal assistant text when native tool calls are available. If native tool calls are unavailable, use exactly the action block format below. Do NOT use call, call:, <tool_call>, or bare JSON in assistant text. Prefer tool calls first; keep prose short and never spend many tokens before a large layout action. For each fallback content tool call, emit:

%saction
{"tool": "tool_name", "params": {...}, "description": "what this does", "impact": "expected effect"}
%s

CRITICAL RULES:
1. If there are cards on the canvas, start with focus_card to move your cursor.
2. EVERY response must have at least one action block. Pure text responses are forbidden.
3. SAFE tools execute immediately and you will receive their results. You can then act on the results in a follow-up turn.
4. NEEDS_CONFIRMATION tools become proposal cards the user must approve.
5. Include "description" and "impact" in every action block.
6. For canvas tools (focus_card, select_cards, remove_cards, move_card, arrange_cards, resize_card, bring_cards_to_front, create_comment), use the card ID. For file/catalog tools that require assetId, use the ASSET ID from the canvas state (the "id" field inside "asset").
7. Never say you cannot take a screenshot/photo or export the canvas. You CAN trigger the real frontend screenshot/export preview by calling capture_viewport, capture_canvas, or capture_selected.
8. For large layouts, output compact JSON action blocks first and keep natural-language explanation to one short sentence after tools. Do not write a long plan before arrange_cards.
9. Every tool has cardinality. With multiple selected/mentioned image assets, default to ALL selected/mentioned assets and pass assetIds. Use assetId only for a clearly single target such as "this one", "first image", or "only this card".
10. Destructive or file-writing multi-image tools must be one batch proposal with assetIds, not many separate proposal cards. The UI will show per-asset status.
11. For OCR extraction, use extract_ocr_text with {"mode":"vlm","saveToMetadata":false}. For catalog assets, pass assetIds; for uploaded image cards, pass cardIds. This returns text to chat. Only use update_ocr_text to save OCR metadata after the user explicitly approves saving.
12. Do not put display labels in tool params. The app renders localized status text from tool names and result codes.

## Canvas Strategy Preset
%s

## Proposal Discipline
%s

## IMPORTANT: search_assets searches the ENTIRE PROJECT CATALOG
search_assets is NOT limited to what's on the canvas. It searches ALL assets in the project by filename, path, AI tags, description, and OCR text. When the user asks to find, list, or show assets, ALWAYS use search_assets first. Match the user's requested count: if they ask for one or a single item, set limit: 1 and do not add multiple candidates. If the user asks for images/assets that contain readable text, call search_assets with {"q":"","hasText":true}. If the user mentions an exact filename or filename stem such as family_danran.png, search the exact stem first (family_danran) before broader visual terms; if that returns a result, use it and do NOT claim no match. Even if the canvas is empty, you can search the catalog. The results will be returned to you and you can then describe them.

get_asset_detail retrieves full metadata for a specific asset (project, local path, tags, description, OCR, references). Use it after search_assets to get details about specific items.

## Context-Aware Behavior
- **When the user asks to select one or more cards:** Use select_cards with the exact card IDs. Single-card and multi-card selection are both supported.
- **When the user asks to remove/delete extra cards from the canvas:** Use remove_cards. This only cleans the canvas and does not delete files. Do NOT use delete_asset unless the user explicitly asks to delete source files from the project.
- **When the user asks to move a card in a direction** without a specific coordinate or distance: treat it as a nearby relative nudge, not a jump across the board. Move by about one card size plus a small gap. Keep the secondary axis close to the current position unless alignment, diagonal placement, or a nearby target card makes a small adjustment useful.
- **When the user asks to arrange, lay out, compose, storyboard, or make selected images look like a scene:** operate on the canvas. Do not answer with only a written plan. Duplicate selected image cards if multiple beats or panels are needed, then use arrange_cards, resize_card, align_cards, or distribute_cards to create the layout. After duplicate_cards returns newCardIds, use those returned IDs in the follow-up arrange step.
- **When the user asks you to act like a photographer, art-direct a photo shoot, stage photos, or make the canvas images look beautiful before taking a picture:** use all visible image cards unless the user narrows the target set. Inspect the canvas if composition is uncertain, resize hero/supporting cards as needed, arrange_cards with polished whitespace and focal balance, then call capture_canvas for the staged board or capture_viewport for the current viewport.
- **When the user asks to copy/clone an image visually on the canvas** (for example, "make five copies" or "clone this image"): Use duplicate_cards with the image card ID and count equal to the number of new copies. Then use arrange_cards, align_cards, or distribute_cards with the returned new card IDs to create the requested feeling or layout. This is canvas-level duplication, not pixel editing.
- **When the user asks to show text-bearing assets, annotate the visible text, and copy files using the text as filenames:** complete the full chain: search_assets with {"q":"","hasText":true}, add_assets_to_canvas, arrange_cards, extract_ocr_text with saveToMetadata=false, create_comment once per OCR text target, then copy_asset with perAssetDestPaths. copy_asset creates a proposal only; it must not directly write files.
- **When the user asks to find one asset/image:** Use search_assets with limit: 1. Do not dump all matches onto the canvas. If the request includes a filename, use the filename stem as the first query.
- **When the user asks whether a target appears on the current canvas:** inspect the canvas visually and compare against visible card IDs first. Do not ask the user to identify the target again. Use inspect_canvas if visual matching is needed; use focus_card/select_cards to point at matches. Use search_assets/find_similar_assets only for searching the project catalog, not as a substitute for checking visible canvas cards.
- **When the canvas is empty and the user asks to find/list assets:** Use search_assets with relevant keywords. You will receive the results. Then describe what you found.
- **When creating comments/annotations:** Use create_comment ONLY when the user explicitly asks to annotate, mark, circle, highlight, comment, or leave a note. Place comment cards away from image content. Do not cover or overlap the asset being discussed; keep roughly 80px+ distance from the image/card when possible. Use the region field to point to the relevant image area instead of placing the comment on top of it. The region is relative to the anchored card image, x/y are the top-left of the target box, and the box should tightly enclose the actual target rather than nearby decoration, host objects, or surrounding context. If multiple distinct objects/areas must be circled, call create_comment once per target/region. Treat one visible text word, phrase, line, or OCR string as one target unless the user explicitly asks for per-character annotations. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels.
- **When correcting existing comments/annotations:** Use update_comment with commentCardId and region when the user says the circle, mark, highlight, or pointed area is wrong. update_comment.region is relative to the existing comment anchor image and replaces the visible marker. Include visualCue for small objects/text.
- **When the user asks about a REGION (circled area, comment):** Focus on analyzing THAT specific region and answer in chat. Use create_comment only if the user asks you to add or update an annotation. Do NOT propose file-level operations unless explicitly asked.
- **When arranging cards:** Use the current size=WIDTHxHEIGHT for every selected/visible card and place bounding boxes with clear whitespace. The canvas is large/unbounded, but only use far-away coordinates when the user asks for a broad layout or spread-out board. For ordinary move requests, stay near the current cluster. For 8+ cards, prefer a broad multi-row layout about 1600-2400px wide with 160px+ horizontal and 120px+ vertical gaps unless the user explicitly asks for a tight collage. Do not place large cards partly under smaller cards unless the user explicitly asks for overlap/collage. If the layout would improve with a focal image or smaller supporting images, use resize_card first/alongside arrange_cards; resize_card is visual only and safe. If you are unsure whether the layout visually overlaps or layers correctly, call inspect_canvas to see a hidden AI-only snapshot before finalizing.
- **When the user asks to place an image on top / in front / above another image:** Use bring_cards_to_front for the card that should visually cover the others. Moving x/y is not enough to change stacking order. If the user says "put A in front of B" or "A above B", pass B as afterCardId so A is inserted directly above B instead of blindly moving A above every card.
- **When the user asks to take a picture, screenshot, or export the canvas:** After any arrange/resize/layer steps, call capture_viewport, capture_canvas, or capture_selected. If the user asks for a transparent or no-background export, pass {"transparent": true}. This triggers the real frontend screenshot/export preview. Do not apologize or claim you cannot create an image file. Use inspect_canvas only for your own hidden visual check; it is not the user's final screenshot.
- **When multiple asset cards are selected:** Treat the request as applying to ALL selected assets. Do not randomly choose one selected card. For catalog/image tools, emit one action with assetIds so the UI can show batch status.
- **When the user explicitly asks for optimization/compression/format change:** Call compress_image, resize_image, or convert_image as appropriate. These generate new image variants and preserve source files.
- **When the user explicitly asks to mirror/flip/reverse or rotate an image:** Call mirror_image or rotate_image for the selected/mentioned catalog assets. These generate new image variants and preserve source files. Use flip=horizontal by default for mirror/flip/reverse unless the user clearly asks for vertical or top-bottom flipping. Use degrees=90 by default for rotate_image if the user does not specify a degree.
- **When the user explicitly asks to tag or write/save a description:** Propose update_tags or update_description for every selected asset card, not just the first one.
- **When the user asks a general question about an asset:** Analyze and answer in chat. Use focus_card or get_asset_detail when useful. Do NOT create comments, file proposals, or metadata proposals unless the user explicitly asks for that action.
- **When you spot visual issues** (edges, contrast, artifacts, wrong crop), describe them in chat. Only use create_comment to circle/mark the issue if the user explicitly asks for annotation. Regions use normalized 0-1 coordinates relative to the anchored card image: {"x": 0.7, "y": 0.0, "width": 0.3, "height": 0.4} means the top-right 30%% area.

## Example 1: User asks a general question about an image
%saction
{"tool": "focus_card", "params": {"cardId": "asset-abc123"}, "description": "Focus the selected image", "impact": "Shows what is being examined"}
%s
This is a small UI icon. The top-right detail may have low contrast on light backgrounds.

## Example 2: User asks to find assets
%saction
{"tool": "search_assets", "params": {"q": "book icon", "limit": 12}, "description": "Search the catalog", "impact": "Finds matching assets across the project"}
%s

## Example 3: User explicitly asks to optimize an image
%saction
{"tool": "focus_card", "params": {"cardId": "asset-xyz789"}, "description": "Focus the target image", "impact": "Shows which asset will be optimized"}
%s
This 4096×3344 PNG at 13.5MB is too large for web use.
%saction
{"tool": "compress_image", "params": {"assetId": "xyz789", "outputFormat": "webp", "quality": 85}, "description": "Convert to WebP", "impact": "~80%% file size reduction"}
%s

## Example 4: User explicitly asks to tag and save a description
%saction
{"tool": "focus_card", "params": {"cardId": "asset-def456"}, "description": "Focus the target image", "impact": "Shows which asset will be edited"}
%s
%saction
{"tool": "update_tags", "params": {"assetId": "def456", "tags": ["logo", "brand", "vector", "header"]}, "description": "Set searchable tags", "impact": "Improves catalog searchability"}
%s
%saction
{"tool": "update_description", "params": {"assetId": "def456", "description": "Company brand logo in SVG format, used in the site header and footer."}, "description": "Set image description", "impact": "Improves asset metadata"}
%s

## Example 5: User asks to export/take a transparent screenshot after arranging
%saction
{"tool": "arrange_cards", "params": {"positions": [{"cardId": "asset-a", "x": 80, "y": 80}, {"cardId": "asset-b", "x": 440, "y": 80}]}, "description": "Arrange the cards for a clean composition", "impact": "Creates a balanced layout"}
%s
%saction
{"tool": "capture_canvas", "params": {"transparent": true}, "description": "Export the arranged canvas with transparent background", "impact": "Shows the normal screenshot preview"}
%s`,
		canvasToolsBlock(),
		lang,
		"```", "```",
		options.CanvasStrategy,
		canvasProposalGuidance(options),
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
	)
}

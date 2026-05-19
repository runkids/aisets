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
			Name:        "group_cards",
			Description: "Group two or more image cards into one canvas group card. Use when the user asks to group, combine, collect, or treat selected images as one movable/resizable unit. This changes canvas structure only and does not merge or edit source files.",
			Cardinality: "multi",
			Safe:        true,
		},
		{
			Name:        "ungroup_card",
			Description: "Ungroup one existing canvas group card back into its child image cards. This changes canvas structure only and does not edit source files.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "rename_group",
			Description: "Rename an existing canvas group card. Use when the user asks to name, label, or rename a group. This changes the canvas group label only.",
			Cardinality: "single",
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
			Description: "Generate a rotated image variant using Rust imgtools. Use for clear rotate, rotation, turn, clockwise, or any integer-degree rotation request. This preserves the source file.",
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
		{
			Name:        "create_text_card",
			Description: "Create a new text card on the canvas with styled content. Returns cardId, content, style, position.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "update_text_card",
			Description: "Update the content or style of an existing text card on the canvas.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "create_drawing",
			Description: "Create a new drawing card on the canvas with optional initial shapes. Returns cardId, shapes, dimensions, position.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "add_shape",
			Description: "Append a shape (rect, ellipse, line, arrow, or path) to an existing drawing card. Useful for highlighting or annotating with vector marks.",
			Cardinality: "single",
			Safe:        true,
		},
		{
			Name:        "clear_drawing_shapes",
			Description: "Remove all shapes from a drawing card while keeping the card itself.",
			Cardinality: "single",
			Safe:        true,
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

package server

import (
	"fmt"
	"strings"
)

type canvasToolDef struct {
	Name        string
	Description string
	Params      string
	Safe        bool
}

func canvasToolRegistry() []canvasToolDef {
	return []canvasToolDef{
		{
			Name:        "focus_card",
			Description: "Move your cursor to a card on the canvas. Use before examining or modifying an asset.",
			Params:      `{"cardId": "string (required)", "label": "string — brief description of what you're looking at"}`,
			Safe:        true,
		},
		{
			Name:        "search_assets",
			Description: "Search the ENTIRE PROJECT CATALOG (not just canvas) for assets by filename, path, AI tags, description, or OCR text. Use this to find assets even when the canvas is empty.",
			Params:      `{"q": "string — search query (e.g. 'book', 'icon', '貓')", "limit": "int — max results, default 12"}`,
			Safe:        true,
		},
		{
			Name:        "get_asset_detail",
			Description: "Get full details about a specific asset: project, local path, dimensions, AI tags, OCR text, used-by references. Use after search_assets to get details.",
			Params:      `{"assetId": "string — catalog asset ID from search results"}`,
			Safe:        true,
		},
		{
			Name:        "create_comment",
			Description: "Leave a comment on an asset card, optionally pinned to a region.",
			Params:      `{"anchorCardId": "string — asset card ID to attach to", "text": "string", "region": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0} (optional, normalized 0-1)}`,
			Safe:        true,
		},
		{
			Name:        "move_card",
			Description: "Move a single card to a new position on the canvas.",
			Params:      `{"cardId": "string (required)", "x": "number — new X coordinate", "y": "number — new Y coordinate"}`,
			Safe:        true,
		},
		{
			Name:        "arrange_cards",
			Description: "Reposition multiple cards at once. Use to organize the canvas layout (e.g. grid, row, group by category).",
			Params:      `{"positions": [{"cardId": "string", "x": "number", "y": "number"}]}`,
			Safe:        true,
		},
		{
			Name:        "compress_image",
			Description: "Compress/convert an asset to a smaller format (WebP, AVIF, PNG).",
			Params:      `{"assetId": "string", "outputFormat": "webp|avif|png", "quality": "int 1-100, default 82"}`,
			Safe:        false,
		},
		{
			Name:        "resize_image",
			Description: "Resize an asset to fit within a max dimension.",
			Params:      `{"assetId": "string", "maxDimensionPx": "int — longest side in pixels"}`,
			Safe:        false,
		},
		{
			Name:        "convert_image",
			Description: "Convert an asset to a different format without quality change.",
			Params:      `{"assetId": "string", "outputFormat": "webp|avif|png|jpg"}`,
			Safe:        false,
		},
		{
			Name:        "update_tags",
			Description: "Set the tags for an asset. Replaces existing tags.",
			Params:      `{"assetId": "string", "tags": ["string"]}`,
			Safe:        false,
		},
		{
			Name:        "update_description",
			Description: "Set the description for an asset.",
			Params:      `{"assetId": "string", "description": "string"}`,
			Safe:        false,
		},
		{
			Name:        "update_ocr_text",
			Description: "Set or override the OCR text for an asset.",
			Params:      `{"assetId": "string", "text": "string"}`,
			Safe:        false,
		},
		{
			Name:        "rename_asset",
			Description: "Rename an asset file. Provide the new filename (with extension).",
			Params:      `{"assetId": "string", "newName": "string — new filename with extension, e.g. 'fortune_cat.png'"}`,
			Safe:        false,
		},
		{
			Name:        "move_asset",
			Description: "Move an asset to a different directory within the project.",
			Params:      `{"assetId": "string", "destDir": "string — destination directory path, e.g. 'assets/icons'"}`,
			Safe:        false,
		},
		{
			Name:        "copy_asset",
			Description: "Copy an asset to a new location.",
			Params:      `{"assetId": "string", "destPath": "string — full destination path including filename"}`,
			Safe:        false,
		},
		{
			Name:        "delete_asset",
			Description: "Delete an asset file from the project. This is destructive and cannot be undone.",
			Params:      `{"assetId": "string"}`,
			Safe:        false,
		},
		{
			Name:        "favorite_asset",
			Description: "Toggle favorite status on an asset.",
			Params:      `{"assetId": "string", "favorite": "boolean — true to add, false to remove"}`,
			Safe:        false,
		},
		{
			Name:        "export_asset",
			Description: "Export/download an asset to a specified output directory.",
			Params:      `{"assetId": "string", "outputDir": "string — output directory path"}`,
			Safe:        false,
		},
	}
}

func canvasToolSafe(name string) bool {
	for _, t := range canvasToolRegistry() {
		if t.Name == name {
			return t.Safe
		}
	}
	return false
}

func canvasToolsBlock() string {
	var b strings.Builder
	for _, t := range canvasToolRegistry() {
		safety := "SAFE"
		if !t.Safe {
			safety = "NEEDS_CONFIRMATION"
		}
		fmt.Fprintf(&b, "- %s [%s]: %s\n  params: %s\n", t.Name, safety, t.Description, t.Params)
	}
	return b.String()
}

func canvasSystemPrompt(locale string) string {
	lang := "English"
	if strings.HasPrefix(locale, "zh") {
		lang = "Traditional Chinese (繁體中文)"
	} else if strings.HasPrefix(locale, "ja") {
		lang = "Japanese"
	}

	return fmt.Sprintf(`You are a pair partner on a visual asset canvas. You WORK on the canvas — you don't just talk. The user can see your cursor moving and your actions appearing as cards.

## Identity
You are NOT a chatbot. You are a collaborator who:
- Moves your cursor to assets before speaking about them
- Proposes concrete actions (compress, tag, rename) proactively
- Leaves comments on specific image regions when you notice issues
- Searches for related assets when context would help
- Always does something, never just describes

## Canvas Layout
Card width is 320px. Use 24px horizontal gap and 24px vertical gap when arranging cards. Read each card's current pos=(x,y) from the Canvas State section.

## Available Tools
%s
## Response Format
Respond in %s. EVERY response MUST include at least one tool call. For each tool call, emit:

%saction
{"tool": "tool_name", "params": {...}, "description": "what this does", "impact": "expected effect"}
%s

CRITICAL RULES:
1. If there are cards on the canvas, start with focus_card to move your cursor.
2. EVERY response must have at least one action block. Pure text responses are forbidden.
3. SAFE tools (search_assets, get_asset_detail, create_comment, focus_card) execute immediately and you will receive their results. You can then act on the results in a follow-up turn.
4. NEEDS_CONFIRMATION tools become proposal cards the user must approve.
5. Include "description" and "impact" in every action block.
6. Use the ASSET ID from the canvas state (the "id" field inside "asset"), NOT the card ID.

## IMPORTANT: search_assets searches the ENTIRE PROJECT CATALOG
search_assets is NOT limited to what's on the canvas. It searches ALL assets in the project by filename, path, AI tags, description, and OCR text. When the user asks to "find", "list", "show", or "搜尋/找" assets, ALWAYS use search_assets first. Even if the canvas is empty, you can search the catalog. The results will be returned to you and you can then describe them.

get_asset_detail retrieves full metadata for a specific asset (project, local path, tags, description, OCR, references). Use it after search_assets to get details about specific items.

## Context-Aware Behavior
- **When the canvas is empty and the user asks to find/list assets:** Use search_assets with relevant keywords. You will receive the results. Then describe what you found.
- **When the user asks about a REGION (circled area, comment):** Focus on analyzing THAT specific region. Use create_comment with region coordinates to annotate what you see. Do NOT propose file-level operations unless explicitly asked.
- **When the user asks for optimization/compression/format change:** Propose compress_image, resize_image, convert_image as appropriate.
- **When the user asks to tag or describe:** Propose update_tags or update_description.
- **When the user asks a general question about an asset:** Analyze and suggest relevant actions — prefer create_comment for visual observations.
- **When you spot visual issues** (edges, contrast, artifacts, wrong crop), use create_comment with a region to CIRCLE the problem area. Regions use normalized 0-1 coordinates: {"x": 0.7, "y": 0.0, "width": 0.3, "height": 0.4} means the top-right 30%% area.

## Example 1: User asks about an image
%saction
{"tool": "focus_card", "params": {"cardId": "asset-abc123", "label": "Checking icon.png dimensions..."}}
%s
This is a 640×480 PNG at 58KB. It's large for an icon — WebP would cut the size significantly.
%saction
{"tool": "compress_image", "params": {"assetId": "abc123", "outputFormat": "webp", "quality": 82}, "description": "Compress to WebP 82%%", "impact": "~60%% smaller, visually identical"}
%s
I also notice the tags could be more specific:
%saction
{"tool": "update_tags", "params": {"assetId": "abc123", "tags": ["icon", "ui", "dashboard", "png"]}, "description": "Refine tags for better searchability", "impact": "4 descriptive tags"}
%s

## Example 2: User says "help me clean this up"
%saction
{"tool": "focus_card", "params": {"cardId": "asset-xyz789", "label": "Reviewing hero-banner.png..."}}
%s
This 4096×3344 PNG at 13.5MB is way too large for web use.
%saction
{"tool": "resize_image", "params": {"assetId": "xyz789", "maxDimensionPx": 1920}, "description": "Resize to max 1920px", "impact": "Web-appropriate dimensions"}
%s
%saction
{"tool": "compress_image", "params": {"assetId": "xyz789", "outputFormat": "webp", "quality": 85}, "description": "Convert to WebP", "impact": "~80%% file size reduction"}
%s
%saction
{"tool": "create_comment", "params": {"anchorCardId": "asset-xyz789", "text": "This image is 13.5MB — far too heavy for web. Consider serving a resized WebP version."}, "description": "Flag size issue", "impact": "Visual reminder on canvas"}
%s

## Example 3: User says "describe this"
%saction
{"tool": "focus_card", "params": {"cardId": "asset-def456", "label": "Analyzing logo.svg..."}}
%s
This is a 337×400 SVG logo. The existing tags are generic — let me suggest better ones.
%saction
{"tool": "update_tags", "params": {"assetId": "def456", "tags": ["logo", "brand", "vector", "header"]}, "description": "Add specific tags", "impact": "4 searchable tags"}
%s
%saction
{"tool": "update_description", "params": {"assetId": "def456", "description": "Company brand logo in SVG format, used in the site header and footer."}, "description": "Set meaningful description", "impact": "Better catalog searchability"}
%s`,
		canvasToolsBlock(),
		lang,
		"```", "```",
		"```", "```",
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

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
			Description: "Search the project catalog for assets by name, path, or keyword.",
			Params:      `{"q": "string — search query", "limit": "int — max results, default 6"}`,
			Safe:        true,
		},
		{
			Name:        "create_comment",
			Description: "Leave a comment on an asset card, optionally pinned to a region.",
			Params:      `{"anchorCardId": "string — asset card ID to attach to", "text": "string", "region": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0} (optional, normalized 0-1)}`,
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

	return fmt.Sprintf(`You are an AI assistant on a visual asset canvas. You help users review, edit, and manage image assets in their codebase.

## Your Capabilities
You can see the entire canvas state: every card's position, type, and content. You have a cursor that users can see — move it with focus_card before examining or modifying an asset.

## Available Tools
%s
## Response Format
Respond in %s. You may include plain text and tool calls. For each tool call, emit:

%saction
{"tool": "tool_name", "params": {...}, "description": "what this does", "impact": "expected effect"}
%s

Rules:
- ALWAYS use focus_card before examining or modifying a specific asset.
- SAFE tools execute immediately. NEEDS_CONFIRMATION tools become proposals the user must approve.
- Include "description" and "impact" in every action block — the user sees these on proposal cards.
- You may emit multiple action blocks in one response.
- When no tool is needed, just respond with text.

## Example 1: Analyzing an asset
User: "What can you tell me about this image?"
Response:
%saction
{"tool": "focus_card", "params": {"cardId": "asset-abc123", "label": "Examining icon.png..."}}
%s
This is a 640×480 PNG icon at 2KB. It's used in 3 files. The AI tags suggest it's a dashboard UI icon.

The file could benefit from WebP conversion for smaller size:
%saction
{"tool": "compress_image", "params": {"assetId": "abc123", "outputFormat": "webp", "quality": 82}, "description": "Compress to WebP at 82%% quality", "impact": "Estimated ~60%% size reduction"}
%s

## Example 2: Tagging
User: "Add some tags to this"
Response:
%saction
{"tool": "focus_card", "params": {"cardId": "asset-def456", "label": "Looking at logo.svg..."}}
%s
Based on the file name, path, and AI description, I suggest:
%saction
{"tool": "update_tags", "params": {"assetId": "def456", "tags": ["logo", "branding", "svg"]}, "description": "Add tags: logo, branding, svg", "impact": "3 new tags on this asset"}
%s`,
		canvasToolsBlock(),
		lang,
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
		"```", "```",
	)
}

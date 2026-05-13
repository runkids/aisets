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

	return fmt.Sprintf(`You are a pair partner on a visual asset canvas. You WORK on the canvas — you don't just talk. The user can see your cursor moving and your actions appearing as cards.

## Identity
You are NOT a chatbot. You are a collaborator who:
- Moves your cursor to assets before speaking about them
- Proposes concrete actions (compress, tag, rename) proactively
- Leaves comments on specific image regions when you notice issues
- Searches for related assets when context would help
- Always does something, never just describes

## Available Tools
%s
## Response Format
Respond in %s. EVERY response MUST include at least one tool call. For each tool call, emit:

%saction
{"tool": "tool_name", "params": {...}, "description": "what this does", "impact": "expected effect"}
%s

CRITICAL RULES:
1. ALWAYS start with focus_card to move your cursor — the user watches where you look.
2. EVERY response must have at least one action block. Pure text responses are forbidden.
3. After analyzing, ALWAYS propose at least one concrete action (compress, tag update, comment).
4. SAFE tools execute immediately. NEEDS_CONFIRMATION tools become proposal cards the user must approve.
5. Include "description" and "impact" in every action block.
6. Think like a senior engineer reviewing assets — find problems, suggest fixes, be specific.
7. When you spot a visual issue (edges, contrast, artifacts, wrong crop), use create_comment with a region to CIRCLE the problem area. Regions are normalized 0-1 coordinates: {"x": 0.7, "y": 0.0, "width": 0.3, "height": 0.4} means the top-right 30%% area.
8. Use the ASSET ID from the canvas state (the "id" field inside "asset"), NOT the card ID. The card ID starts with "asset-" but the asset ID is the catalog identifier.

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

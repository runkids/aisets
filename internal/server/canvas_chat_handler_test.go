package server

import (
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
	safes := []string{"focus_card", "search_assets", "create_comment"}
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

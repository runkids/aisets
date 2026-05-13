package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildVLMOCRPromptKeepsLocaleOutOfTranscription(t *testing.T) {
	got := buildVLMOCRPrompt(vlmOCRPrompt, true, "zh-TW")

	for _, forbidden := range []string{
		"write any labels, descriptions, or commentary in",
		"Write the extracted text transcription as-is",
	} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("OCR prompt still asks for localized commentary: %q", forbidden)
		}
	}
	for _, required := range []string{
		"This is OCR, not image captioning",
		"Return only visible text exactly as it appears",
		"Do not translate it",
		"Do not add labels, descriptions, captions, summaries, inferences, or commentary",
		"Ignore the UI language (Traditional Chinese (繁體中文)) for transcribed text",
	} {
		if !strings.Contains(got, required) {
			t.Fatalf("OCR prompt missing guard %q in:\n%s", required, got)
		}
	}
}

func TestBuildVLMOCRPromptAddsGuardToCustomPrompt(t *testing.T) {
	got := buildVLMOCRPrompt("Return JSON.", true, "ja")

	if !strings.HasPrefix(got, "Return JSON.") {
		t.Fatalf("custom prompt was not preserved: %s", got)
	}
	if !strings.Contains(got, "This is OCR, not image captioning") {
		t.Fatalf("custom prompt missing OCR guard: %s", got)
	}
	if !strings.Contains(got, "Ignore the UI language (Japanese (日本語))") {
		t.Fatalf("custom prompt missing locale-neutral OCR guard: %s", got)
	}
}

func TestVLMOCRPromptVersionInvalidatesCaptionProneCache(t *testing.T) {
	if vlmOCRPromptVersion != "aisets-vlm-ocr-v2" {
		t.Fatalf("unexpected VLM OCR prompt version: %s", vlmOCRPromptVersion)
	}
}

func TestUnmarshalOCRTextToleratesArrayResponse(t *testing.T) {
	got := unmarshalOCRText(json.RawMessage(`["ずかん","日本語"]`))
	if got != "ずかん\n日本語" {
		t.Fatalf("OCR text = %q", got)
	}
}

func TestUnmarshalOCRTextKeepsStringResponse(t *testing.T) {
	got := unmarshalOCRText(json.RawMessage(`"ずかん"`))
	if got != "ずかん" {
		t.Fatalf("OCR text = %q", got)
	}
}

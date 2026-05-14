package server

import (
	"strings"
	"testing"
)

func TestCanvasSkillCatalogCoversRegistry(t *testing.T) {
	registry := map[string]bool{}
	for _, tool := range canvasToolRegistry() {
		registry[tool.Name] = true
	}
	covered := map[string]bool{}
	for _, skill := range canvasSkillCatalog() {
		if skill.ID == "" || skill.Description == "" || len(skill.Tools) == 0 || strings.TrimSpace(skill.Rules) == "" {
			t.Fatalf("incomplete skill family: %#v", skill)
		}
		for _, name := range skill.Tools {
			if !registry[name] {
				t.Fatalf("skill %s references unknown tool %s", skill.ID, name)
			}
			covered[name] = true
		}
	}
	for name := range registry {
		if !covered[name] {
			t.Fatalf("registry tool %s is not assigned to any skill family", name)
		}
	}
}

func TestClassifyCanvasSkillFamilies(t *testing.T) {
	cases := []struct {
		name    string
		message string
		want    []string
		reject  []string
	}{
		{name: "search", message: "find family_danran.png", want: []string{canvasSkillSearch}, reject: []string{canvasSkillFileProposals}},
		{name: "layout", message: "arrange selected images into a storyboard", want: []string{canvasSkillLayout}},
		{name: "capture", message: "take a transparent screenshot of the canvas", want: []string{canvasSkillCapture}},
		{name: "ocr", message: "read the visible text with OCR", want: []string{canvasSkillOCR}},
		{name: "comments", message: "annotate and circle this area", want: []string{canvasSkillComments}},
		{name: "quality", message: "what is this image and any quality issue?", want: []string{canvasSkillQuality}, reject: []string{canvasSkillFileProposals}},
		{name: "metadata", message: "save these tags and description", want: []string{canvasSkillMetadataProposals}},
		{name: "file proposal", message: "rotate this asset and convert it to webp", want: []string{canvasSkillFileProposals}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyCanvasSkillFamilies(canvasSkillClassifyInput{
				Message: tt.message,
				Canvas:  canvasSnapshot{Cards: []canvasCardSnapshot{{ID: "card-a", Kind: "asset"}}},
			})
			for _, want := range tt.want {
				if !canvasStringSliceContains(got, want) {
					t.Fatalf("skills = %v, missing %s", got, want)
				}
			}
			for _, reject := range tt.reject {
				if canvasStringSliceContains(got, reject) {
					t.Fatalf("skills = %v, should not include %s", got, reject)
				}
			}
			if len(got) == 0 || len(got) > 3 {
				t.Fatalf("skill count = %d, skills=%v", len(got), got)
			}
		})
	}
}

func TestCanvasSkillGatedToolsAndPrompt(t *testing.T) {
	skills := []string{canvasSkillSearch}
	tools := canvasLLMToolsForSkills(skills)
	if len(tools) == 0 || len(tools) >= len(canvasLLMTools()) {
		t.Fatalf("gated tools count = %d, full=%d", len(tools), len(canvasLLMTools()))
	}
	var names []string
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	for _, want := range []string{"focus_card", "search_assets", "add_assets_to_canvas", "get_asset_detail"} {
		if !canvasStringSliceContains(names, want) {
			t.Fatalf("tool subset = %v, missing %s", names, want)
		}
	}
	for _, reject := range []string{"arrange_cards", "compress_image", "create_comment"} {
		if canvasStringSliceContains(names, reject) {
			t.Fatalf("tool subset = %v, should not include %s", names, reject)
		}
	}
	prompt := canvasSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, skills)
	if !strings.Contains(prompt, "## Search Skill") || strings.Contains(prompt, "## Layout Skill") {
		t.Fatalf("prompt did not include only selected skill rules:\n%s", prompt)
	}
	toolBlock := canvasPromptSection(prompt, "## Available Tools", "## Response Format")
	if !strings.Contains(toolBlock, "search_assets") || strings.Contains(toolBlock, "compress_image") {
		t.Fatalf("prompt tool block is not gated:\n%s", toolBlock)
	}
}

func TestCanvasNativeSkillPromptOmitsTextToolBlock(t *testing.T) {
	prompt := canvasNativeSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, []string{canvasSkillSearch})
	if strings.Contains(prompt, "## Available Tools") {
		t.Fatalf("native prompt should not duplicate text tool block:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Native tools are attached") {
		t.Fatalf("native prompt missing native tool instruction:\n%s", prompt)
	}
	if strings.Contains(prompt, "params:") {
		t.Fatalf("native prompt should not include text params list:\n%s", prompt)
	}
}

func TestExpandCanvasSkillFamiliesForRepairLoop(t *testing.T) {
	got := expandCanvasSkillFamiliesForLoopReason(
		[]string{canvasSkillQuality},
		canvasLoopReasonTextOnlyDeferredWork,
		"arrange these into a storyboard",
		canvasChatOptions{},
	)
	if !canvasStringSliceContains(got, canvasSkillLayout) {
		t.Fatalf("repair loop skills = %v, missing layout", got)
	}
	got = expandCanvasSkillFamiliesForLoopReason(
		[]string{canvasSkillQuality},
		canvasLoopReasonMissingCapture,
		"take a screenshot",
		canvasChatOptions{},
	)
	if !canvasStringSliceContains(got, canvasSkillCapture) {
		t.Fatalf("repair loop skills = %v, missing capture", got)
	}
}

func TestCanvasSkillGatedPromptReducesPromptAndToolBytes(t *testing.T) {
	options := canvasChatOptions{AutoLocale: true, ImageOptimizationAdvice: false}
	fullBytes := len(canvasSystemPrompt("en", options)) + canvasToolSchemaBytes(canvasLLMTools())
	gatedTools := canvasLLMToolsForSkills([]string{canvasSkillSearch})
	gatedBytes := len(canvasSystemPromptForSkills("en", options, []string{canvasSkillSearch})) + canvasToolSchemaBytes(gatedTools)
	if gatedBytes >= fullBytes {
		t.Fatalf("gated prompt+tool bytes = %d, want less than full %d", gatedBytes, fullBytes)
	}
}

func canvasStringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func canvasPromptSection(prompt, start, end string) string {
	startIdx := strings.Index(prompt, start)
	if startIdx < 0 {
		return ""
	}
	startIdx += len(start)
	endIdx := strings.Index(prompt[startIdx:], end)
	if endIdx < 0 {
		return prompt[startIdx:]
	}
	return prompt[startIdx : startIdx+endIdx]
}

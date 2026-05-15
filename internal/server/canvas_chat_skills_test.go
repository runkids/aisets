package server

import (
	"reflect"
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
		{name: "comment typo", message: "Copy this image and find the peachs and then add commends", want: []string{canvasSkillComments, canvasSkillLayout}},
		{name: "photo staging", message: "act like a professional photographer and stage these photos beautifully", want: []string{canvasSkillPhotoStaging}, reject: []string{canvasSkillFileProposals, canvasSkillMetadataProposals}},
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

func TestCanvasPhotoStagingSkillGatesLayoutAndCaptureTools(t *testing.T) {
	skills := []string{canvasSkillPhotoStaging}
	tools := canvasLLMToolsForSkills(skills)
	var names []string
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	for _, want := range []string{"inspect_canvas", "resize_card", "arrange_cards", "bring_cards_to_front", "mirror_image", "rotate_image", "capture_canvas", "capture_viewport"} {
		if !canvasStringSliceContains(names, want) {
			t.Fatalf("photo staging tool subset = %v, missing %s", names, want)
		}
	}
	for _, reject := range []string{"search_assets", "create_comment", "rename_asset"} {
		if canvasStringSliceContains(names, reject) {
			t.Fatalf("photo staging tool subset = %v, should not include %s", names, reject)
		}
	}
	for name, prompt := range map[string]string{
		"native": canvasNativeSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, skills),
		"action": canvasSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, skills),
	} {
		for _, want := range []string{"Professional photo staging", "professional photographer", "mirror_image", "rotate_image", "any integer-degree angle", "bring_cards_to_front", "capture_canvas"} {
			if !strings.Contains(prompt, want) {
				t.Fatalf("%s photo staging prompt missing %q:\n%s", name, want, prompt)
			}
		}
	}
}

func TestCanvasNativePhotoStagingSystemPromptIsCompact(t *testing.T) {
	prompt := canvasNativeSystemPromptForSkills("en", canvasChatOptions{
		AutoLocale:           true,
		PhotoStagingWorkflow: true,
	}, []string{canvasSkillPhotoStaging})
	if len(prompt) > 2200 {
		t.Fatalf("native photo staging prompt too large for local LLMs: len=%d\n%s", len(prompt), prompt)
	}
	for _, want := range []string{
		"professional photographer and art director",
		"resize_card",
		"mirror_image",
		"rotate_image",
		"any integer-degree angle",
		"bring_cards_to_front",
		"z-index",
		"capture_canvas",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("native photo staging compact prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, forbidden := range []string{
		"Search and add N relevant assets",
		"Annotation/comment",
		"Similarity, quality",
		"Proposal Discipline",
	} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("native photo staging compact prompt should omit unrelated generic guidance %q:\n%s", forbidden, prompt)
		}
	}
}

func TestCanvasActionPhotoStagingSystemPromptIsCompact(t *testing.T) {
	prompt := canvasSystemPromptForSkills("en", canvasChatOptions{
		AutoLocale:           true,
		PhotoStagingWorkflow: true,
	}, []string{canvasSkillPhotoStaging})
	if len(prompt) > 2600 {
		t.Fatalf("action photo staging prompt too large for local LLMs: len=%d\n%s", len(prompt), prompt)
	}
	for _, want := range []string{
		"bracket action blocks",
		"resize_card",
		"mirror_image",
		"rotate_image",
		"any integer-degree angle",
		"bring_cards_to_front",
		"z-index",
		"capture_canvas",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("action photo staging compact prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, forbidden := range []string{
		"Search and add N relevant assets",
		"Annotation/comment",
		"Similarity, quality",
		"Example 1",
	} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("action photo staging compact prompt should omit unrelated generic guidance %q:\n%s", forbidden, prompt)
		}
	}
}

func TestNormalizeCanvasSelectedSkillIDs(t *testing.T) {
	got := normalizeCanvasSelectedSkillIDs([]string{
		" " + canvasSkillPhotoStaging + " ",
		"unknown",
		canvasSkillPhotoStaging,
		canvasSkillCapture,
	})
	want := []string{canvasSkillPhotoStaging, canvasSkillCapture}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selected skill IDs = %#v, want %#v", got, want)
	}
}

func TestClassifyCanvasSkillFamilies_SelectedFormatRequestUsesFileProposal(t *testing.T) {
	got := classifyCanvasSkillFamilies(canvasSkillClassifyInput{
		Message: "selected image to WebP quality 82",
		Canvas: canvasSnapshot{
			Cards:           []canvasCardSnapshot{{ID: "card-a", Kind: "asset"}},
			SelectedCardIDs: []string{"card-a"},
		},
	})
	if !canvasStringSliceContains(got, canvasSkillFileProposals) {
		t.Fatalf("skills = %v, missing %s", got, canvasSkillFileProposals)
	}
}

func TestClassifyCanvasSkillFamilies_FilenameLookupDoesNotUseFileProposal(t *testing.T) {
	got := classifyCanvasSkillFamilies(canvasSkillClassifyInput{
		Message: "find loading.webp",
		Canvas:  canvasSnapshot{Cards: []canvasCardSnapshot{{ID: "card-a", Kind: "asset"}}},
	})
	if canvasStringSliceContains(got, canvasSkillFileProposals) {
		t.Fatalf("skills = %v, should not include %s", got, canvasSkillFileProposals)
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

func TestCommentRegionSchemaDefinesImageRelativeBoundingBox(t *testing.T) {
	tools := canvasNativeLLMToolsForSkills([]string{canvasSkillComments})
	byName := map[string]int{}
	for i := range tools {
		byName[tools[i].Name] = i
	}
	for _, toolName := range []string{"create_comment", "update_comment"} {
		t.Run(toolName, func(t *testing.T) {
			index, ok := byName[toolName]
			if !ok {
				t.Fatalf("%s tool missing", toolName)
			}
			props, ok := tools[index].Parameters["properties"].(map[string]any)
			if !ok {
				t.Fatalf("properties = %#v", tools[index].Parameters["properties"])
			}
			region, ok := props["region"].(map[string]any)
			if !ok {
				t.Fatalf("region schema = %#v", props["region"])
			}
			visualCue, ok := props["visualCue"].(map[string]any)
			if !ok {
				t.Fatalf("visualCue schema = %#v", props["visualCue"])
			}
			visualCueDescription, _ := visualCue["description"].(string)
			if !strings.Contains(strings.ToLower(visualCueDescription), "target pixels") {
				t.Fatalf("visualCue description missing target pixels: %q", visualCueDescription)
			}
			visualCueProps, ok := visualCue["properties"].(map[string]any)
			if !ok {
				t.Fatalf("visualCue properties = %#v", visualCue["properties"])
			}
			colorHex, ok := visualCueProps["colorHex"].(map[string]any)
			if !ok {
				t.Fatalf("visualCue.colorHex = %#v", visualCueProps["colorHex"])
			}
			colorDescription, _ := colorHex["description"].(string)
			if !strings.Contains(colorDescription, "#RRGGBB") {
				t.Fatalf("colorHex description = %q", colorDescription)
			}
			regionDescription, _ := region["description"].(string)
			regionDescription = strings.ToLower(regionDescription)
			for _, want := range []string{"relative to", "normalized bounding box"} {
				if !strings.Contains(regionDescription, want) {
					t.Fatalf("region description missing %q: %q", want, regionDescription)
				}
			}
			regionProps, ok := region["properties"].(map[string]any)
			if !ok {
				t.Fatalf("region properties = %#v", region["properties"])
			}
			xSchema := regionProps["x"].(map[string]any)
			ySchema := regionProps["y"].(map[string]any)
			widthSchema := regionProps["width"].(map[string]any)
			xDescription, _ := xSchema["description"].(string)
			yDescription, _ := ySchema["description"].(string)
			widthDescription, _ := widthSchema["description"].(string)
			for _, check := range []struct {
				label string
				text  string
				want  string
			}{
				{"x", xDescription, "top-left corner, not the center point"},
				{"y", yDescription, "Y increases downward"},
				{"width", widthDescription, "tight box around only the visible target"},
			} {
				if !strings.Contains(check.text, check.want) {
					t.Fatalf("%s description missing %q: %q", check.label, check.want, check.text)
				}
			}
		})
	}
	updateIndex, ok := byName["update_comment"]
	if !ok {
		t.Fatal("update_comment tool missing")
	}
	required, ok := tools[updateIndex].Parameters["required"].([]string)
	if !ok {
		t.Fatalf("update_comment required = %#v", tools[updateIndex].Parameters["required"])
	}
	if !reflect.DeepEqual(required, []string{"commentCardId"}) {
		t.Fatalf("update_comment required = %#v, want commentCardId only", required)
	}
	props, _ := tools[updateIndex].Parameters["properties"].(map[string]any)
	if _, ok := props["text"]; !ok {
		t.Fatal("update_comment should keep optional text field")
	}
	if _, ok := props["region"]; !ok {
		t.Fatal("update_comment should expose optional region field")
	}
}

func TestSelectedCommentUsesAnchorImageForRegionVision(t *testing.T) {
	canvas := canvasHarnessSnapshot("asset-a", "asset-b", "comment-a")
	ids := selectedCanvasImageCardIDs(canvas)
	if !reflect.DeepEqual(ids, []string{"card-a"}) {
		t.Fatalf("selected image card IDs = %#v, want anchor card-a", ids)
	}
	prompt := buildCanvasUserPrompt(
		[]canvasChatMessage{{Role: "user", Content: "Correct the selected annotation region."}},
		canvas,
		canvasChatOptions{CanvasImageAttached: true},
		"en",
	)
	for _, want := range []string{
		"Selected comment anchors:",
		"comment=comment-a anchor=card-a",
		"update_comment.region",
		"coordinate grid overlay",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCanvasCommentSkillPromptUsesOneRegionPerTarget(t *testing.T) {
	for name, prompt := range map[string]string{
		"native": canvasNativeSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, []string{canvasSkillComments}),
		"action": canvasSystemPromptForSkills("en", canvasChatOptions{AutoLocale: true}, []string{canvasSkillComments}),
	} {
		if !strings.Contains(prompt, "once per target/region") {
			t.Fatalf("%s prompt missing per-target comment rule:\n%s", name, prompt)
		}
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

func TestCanvasNativeAllToolPromptStaysCompact(t *testing.T) {
	options := canvasChatOptions{AutoLocale: true, ImageOptimizationAdvice: false}
	tools := canvasNativeLLMToolsForSkills(canvasAllSkillIDs())
	bytes := len(canvasNativeSystemPromptForSkills("zh-TW", options, canvasAllSkillIDs())) + canvasToolSchemaBytes(tools)
	t.Logf("native all-tool prompt+schema bytes = %d", bytes)
	if bytes > 30000 {
		t.Fatalf("native all-tool prompt+schema bytes = %d, want <= 30000", bytes)
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

package server

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Server) canvasGeneratedImagesFromContent(content string, seen map[string]bool) []canvasUploadResult {
	var results []canvasUploadResult
	for _, path := range canvasGeneratedImagePathCandidates(content) {
		if seen[path] {
			continue
		}
		seen[path] = true
		result, err := s.processGeneratedCanvasImage(path)
		if err != nil {
			continue
		}
		results = append(results, result)
	}
	return results
}

func canvasLatestUserLanguage(latestUserMessage string, locale string) string {
	if hangulTextRe.MatchString(latestUserMessage) {
		return "Korean"
	}
	if kanaTextRe.MatchString(latestUserMessage) {
		return "Japanese"
	}
	if hanTextRe.MatchString(latestUserMessage) {
		if strings.HasPrefix(locale, "zh-CN") {
			return "Simplified Chinese"
		}
		return "Traditional Chinese"
	}
	return ""
}

func buildCanvasUserPrompt(messages []canvasChatMessage, canvas canvasSnapshot, options canvasChatOptions, locale string) string {
	var b strings.Builder
	latestUserMessage := latestCanvasUserMessage(messages)
	promptCards := canvasPromptRelevantCards(canvas, latestUserMessage, 10)
	if options.PhotoStagingWorkflow {
		promptCards = canvasVisibleImageCards(canvas, 40)
	}

	b.WriteString("## Canvas State\n")
	selectedVisualCount := 0
	if len(canvas.SelectedCardIDs) > 0 {
		fmt.Fprintf(&b, "Selected cards: %s\n", strings.Join(canvas.SelectedCardIDs, ", "))
		var selectedAssets []string
		var selectedUploads []string
		selected := map[string]bool{}
		for _, id := range canvas.SelectedCardIDs {
			selected[id] = true
		}
		visualSelected := cloneStringBoolMap(selected)
		var selectedCommentAnchors []string
		for _, card := range canvas.Cards {
			if selected[card.ID] && card.Kind == "comment" && strings.TrimSpace(card.AnchorID) != "" {
				visualSelected[card.AnchorID] = true
				selectedCommentAnchors = append(selectedCommentAnchors, fmt.Sprintf("comment=%s anchor=%s", card.ID, card.AnchorID))
			}
		}
		for _, card := range canvas.Cards {
			if visualSelected[card.ID] && card.Asset != nil {
				selectedAssets = append(selectedAssets, fmt.Sprintf("card=%s assetId=%s path=%s", card.ID, card.Asset.ID, card.Asset.RepoPath))
			}
			if visualSelected[card.ID] && card.Kind == "upload" && card.UploadToken != "" {
				selectedUploads = append(selectedUploads, fmt.Sprintf("card=%s file=%s %dx%d", card.ID, card.UploadFileName, card.UploadWidth, card.UploadHeight))
			}
		}
		selectedVisualCount = len(selectedAssets) + len(selectedUploads)
		if len(selectedCommentAnchors) > 0 {
			fmt.Fprintf(&b, "Selected comment anchors:\n- %s\n", strings.Join(selectedCommentAnchors, "\n- "))
		}
		if len(selectedAssets) > 0 {
			fmt.Fprintf(&b, "Selected asset targets (%d):\n- %s\n", len(selectedAssets), strings.Join(selectedAssets, "\n- "))
		}
		if len(selectedUploads) > 0 {
			fmt.Fprintf(&b, "Selected upload targets (%d):\n- %s\n", len(selectedUploads), strings.Join(selectedUploads, "\n- "))
		}
		if options.CanvasImageAttached || len(selectedAssets) > 0 || len(selectedUploads) > 0 {
			b.WriteString("Attached visual inputs:\n")
			if len(selectedAssets) > 0 || len(selectedUploads) > 0 {
				if selectedVisualCount == 1 {
					b.WriteString("- Image 1 is a selected card image with a coordinate grid overlay. Image 2 is the plain selected card image. Use the grid image to estimate create_comment.region or update_comment.region, then verify against the plain image. Localize the target against the anchored card image/original selected image, not the full canvas screenshot. Return a normalized top-left bounding box around the visible target itself. If the target sits on a host object, box only the requested target, not the host or surrounding context. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. For text, box the actual characters only, not the whole sign, banner, label, or container.\n")
				} else {
					b.WriteString("- Images 1..N are selected card image originals in selected-card order. For create_comment.region or update_comment.region, localize the target against the anchored card image/original selected image, not the full canvas screenshot. Return a normalized top-left bounding box around the visible target itself. If the target sits on a host object, box only the requested target, not the host or surrounding context. For small objects or text, include visualCue.targetDescription in English and visualCue.colorHex for the target pixels. For text, box the actual characters only, not the whole sign, banner, label, or container.\n")
				}
			}
			if options.CanvasImageAttached {
				if len(selectedAssets) > 0 || len(selectedUploads) > 0 {
					b.WriteString("- The final attached image is the canvas viewport screenshot. Use it only for layout, card positions, and visual context.\n")
				} else {
					b.WriteString("- Image 1 is the canvas viewport screenshot. Use it for layout, card positions, and visual context.\n")
				}
			}
		}
	}
	fmt.Fprintf(&b, "Total cards: %d\n", len(canvas.Cards))
	fmt.Fprintf(&b, "Viewport: pan=(%.0f,%.0f) scale=%.2f\n\n", canvas.Viewport.X, canvas.Viewport.Y, canvas.Viewport.Scale)
	if options.PlanContext != nil {
		b.WriteString(canvasPlanContextPrompt(*options.PlanContext))
	}
	if options.PhotoStagingWorkflow {
		if ids := canvasVisibleImageCardIDs(canvas); len(ids) > 0 {
			fmt.Fprintf(&b, "Photo staging target image cards (%d): %s\n", len(ids), strings.Join(ids, ", "))
			b.WriteString("For photo staging, all visible image cards above are in scope unless the user explicitly narrows the request. Any arrange_cards, align_cards, distribute_cards, or selected staging plan must include every listed image card before capture.\n")
			b.WriteString("Act as a professional photographer and art director, not a grid-layout assistant. Preserve the requested style direction across every loop.\n")
			b.WriteString("Use resize_card and arrange_cards to create the actual composition. Use bring_cards_to_front for z-index/front layering when it improves depth. Use mirror_image or rotate_image only for a small number of images when a transformed PNG variant improves the story or composition; rotate_image supports any integer-degree angle, so prefer subtle deliberate angles over arbitrary 90-degree turns unless 90 degrees is requested or clearly useful; do not use transforms merely to show capability. Avoid a rigid equal-size grid unless the user asks for one.\n\n")
		}
	}

	hasBounds := false
	var minX, minY, maxX, maxY float64
	for _, card := range canvas.Cards {
		cardW := card.Width
		if cardW <= 0 {
			cardW = 320
		}
		cardH := card.Height
		if cardH <= 0 {
			cardH = 240
		}
		if !hasBounds {
			minX, minY, maxX, maxY = card.X, card.Y, card.X+cardW, card.Y+cardH
			hasBounds = true
		} else {
			if card.X < minX {
				minX = card.X
			}
			if card.Y < minY {
				minY = card.Y
			}
			if card.X+cardW > maxX {
				maxX = card.X + cardW
			}
			if card.Y+cardH > maxY {
				maxY = card.Y + cardH
			}
		}
	}

	if len(promptCards) > 0 {
		if options.PhotoStagingWorkflow {
			cardJSON, _ := json.Marshal(compactCanvasPhotoStagingCards(promptCards, len(promptCards)))
			fmt.Fprintf(&b, "## Photo Staging Cards JSON\n%s\n", string(cardJSON))
		} else {
			for _, card := range promptCards {
				fmt.Fprintf(&b, "- [%s] id=%s pos=(%.0f,%.0f)", card.Kind, card.ID, card.X, card.Y)
				if card.Width > 0 && card.Height > 0 {
					fmt.Fprintf(&b, " size=%.0fx%.0f", card.Width, card.Height)
				} else if card.Width > 0 {
					fmt.Fprintf(&b, " width=%.0f", card.Width)
				}
				fmt.Fprintf(&b, " layer=%d", card.LayerIndex)
				if card.Asset != nil {
					a := card.Asset
					fmt.Fprintf(&b, " path=%s ext=%s %dx%d %dB", a.RepoPath, a.Ext, a.Width, a.Height, a.Bytes)
					if len(a.Tags) > 0 {
						fmt.Fprintf(&b, " tags=[%s]", strings.Join(a.Tags, ","))
					}
					if a.Description != "" {
						fmt.Fprintf(&b, " desc=%q", truncate(a.Description, 200))
					}
					if searchText := canvasAssetSearchText(a); searchText != "" {
						fmt.Fprintf(&b, " search=%q", truncate(searchText, 240))
					}
					if a.OcrText != "" {
						fmt.Fprintf(&b, " ocr=%q", truncate(a.OcrText, 200))
					}
					fmt.Fprintf(&b, " usedBy=%d", a.UsedByCount)
				}
				if card.Kind == "comment" {
					fmt.Fprintf(&b, " anchor=%s text=%q", card.AnchorID, truncate(card.Text, 200))
					if card.Region != nil {
						fmt.Fprintf(&b, " region=(%.2f,%.2f,%.2f,%.2f)", card.Region.X, card.Region.Y, card.Region.Width, card.Region.Height)
					}
				}
				if card.Kind == "variant" {
					fmt.Fprintf(&b, " sourceAssetId=%s sourceName=%s %s→%s %dB→%dB", card.SourceAssetID, card.SourceName, card.InputFormat, card.OutputFormat, card.InputBytes, card.OutputBytes)
				}
				if card.Kind == "proposal" {
					fmt.Fprintf(&b, " tool=%s status=%s", card.Tool, card.ProposalStatus)
				}
				if card.Kind == "upload" {
					fmt.Fprintf(&b, " file=%s %dx%d", card.UploadFileName, card.UploadWidth, card.UploadHeight)
				}
				b.WriteByte('\n')
			}
			if omitted := len(canvas.Cards) - len(promptCards); omitted > 0 {
				fmt.Fprintf(&b, "- %d less relevant cards omitted from this prompt to keep the model context short.\n", omitted)
			}
			cardJSON, _ := json.Marshal(compactCanvasCards(promptCards, len(promptCards)))
			fmt.Fprintf(&b, "\n## AI-Readable Canvas Cards JSON\n%s\n", string(cardJSON))
		}
	}

	b.WriteString("\n## Layout Facts\n")
	if options.CanvasImageAttached {
		b.WriteString("- A hidden AI-only screenshot of the current canvas is attached. Use it to judge visual overlap, spacing, scale, and composition before arranging cards.\n")
	}
	if options.PhotoStagingWorkflow {
		b.WriteString("- Photo staging card JSON is compact for local LLMs; use card IDs, dimensions, layer, filenames, tags, OCR text, and the attached screenshot for visual details.\n")
	} else {
		b.WriteString("- Asset JSON includes visual.url and visual.thumbnailUrl references for the actual image; use those references or the attached canvas screenshot when visual details matter.\n")
	}
	if hasBounds {
		fmt.Fprintf(&b, "- Current card cluster bounds: x=%.0f y=%.0f width=%.0f height=%.0f.\n", minX, minY, maxX-minX, maxY-minY)
	}
	b.WriteString("- The canvas is large/unbounded. You may use much wider coordinates than the current cluster; do NOT assume the visible whitespace is unavailable.\n")
	b.WriteString("- Card positions are top-left canvas coordinates. Use each card's size when spacing items; do not assume all cards are 320px wide.\n")
	b.WriteString("- Coordinate scale: 100px is a small nudge, 200-350px is a nearby move, 600px+ is a large jump. Directional requests like right/left/up/down usually mean a nearby relative move, not a jump across the board.\n")
	b.WriteString("- To place one card beside another, use target.x + target.width + 80-160px for the next x coordinate. Keep y close unless the user asks for a diagonal or new row.\n")
	b.WriteString("- Higher layer values render later/on top. arrange_cards and move_card only change x/y; use bring_cards_to_front when z-index/front layering matters.\n")
	b.WriteString("- resize_card changes only the visual displayed card width. Use it to make a hero image larger or supporting images smaller before arranging.\n")
	b.WriteString("- For a spread-out layout, leave at least 160px horizontal and 120px vertical whitespace between card bounding boxes unless the user asks for a collage.\n")
	b.WriteString("- For 8+ cards, spread them across a broad board (roughly 1600-2400px wide, multiple rows/columns). Avoid piling every card near the center or around one hero image.\n")

	if lang := canvasLatestUserLanguage(latestUserMessage, locale); lang != "" {
		fmt.Fprintf(&b, "\n## Response Language Override\n- The latest user message is written in %s. Use %s only for natural-language assistant text. Keep tool labels, descriptions, impacts, status codes, action metadata, and internal reasoning in English.\n", lang, lang)
	}

	b.WriteString("\n## Assistant Options\n")
	if options.PhotoStagingWorkflow {
		b.WriteString("- Photo staging is ON. Image optimization advice is still separate. mirror_image and rotate_image are optional art-direction tools for a small number of images when a transformed PNG variant improves the staged composition, direction, or cover-like rhythm; rotate_image supports any integer-degree angle; do not use them merely to show capability.\n")
	} else if options.ImageOptimizationAdvice {
		b.WriteString("- Image optimization advice is ON. Proactively inspect selected or visible image assets for web delivery opportunities using format, dimensions, byte size, transparency/animation hints, and visual content. When useful, call image variant tools such as compress_image, resize_image, or convert_image; they generate new preview images and preserve source files.\n")
	} else {
		b.WriteString("- Image optimization advice is OFF. Do not proactively call compression, resizing, format conversion, mirroring, or rotation tools unless the user's latest request explicitly asks for that image operation.\n")
	}

	b.WriteString("\n## Conversation\n")
	for _, msg := range messages {
		fmt.Fprintf(&b, "%s: %s\n\n", msg.Role, msg.Content)
	}

	return b.String()
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}

func canvasPlanContextPrompt(ctx canvasPlanContext) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Plan Mode Context\n")
	fmt.Fprintf(&b, "Plan ID: %s\n", truncateCanvasPromptLine(ctx.PlanID, 120))
	fmt.Fprintf(&b, "Current step: %d of %d\n", ctx.StepIndex, ctx.TotalSteps)
	fmt.Fprintf(&b, "Current task: %s\n", truncateCanvasPromptLine(ctx.CurrentTask, 500))
	b.WriteString("You are executing exactly this current task. Use previous completed steps only as memory, not as work to repeat. Do not mark work as complete with prose alone when a canvas action, proposal, generated image, or other executable result is required.\n")
	b.WriteString("Plan Mode is strict: if the current task specifies a count, the executable tool result must satisfy that count before you stop. For search-and-add tasks, search with the requested limit first, then call add_assets_to_canvas with every required assetId returned by search_assets.\n")
	if len(ctx.CompletedSteps) > 0 {
		b.WriteString("Completed steps:\n")
		for _, step := range ctx.CompletedSteps {
			fmt.Fprintf(&b, "- Step %d: %s\n", step.Index, truncateCanvasPromptLine(step.Task, 260))
			if strings.TrimSpace(step.Summary) != "" {
				fmt.Fprintf(&b, "  Summary: %s\n", truncateCanvasPromptLine(step.Summary, 260))
			}
			if len(step.Evidence) > 0 {
				var evidence []string
				for _, item := range step.Evidence {
					if text := strings.TrimSpace(item); text != "" {
						evidence = append(evidence, truncateCanvasPromptLine(text, 120))
					}
				}
				if len(evidence) > 0 {
					fmt.Fprintf(&b, "  Evidence: %s\n", strings.Join(evidence, "; "))
				}
			}
		}
	}
	b.WriteString("\n")
	return b.String()
}

func truncateCanvasPromptLine(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) <= limit {
		return value
	}
	if limit <= 1 {
		return value[:limit]
	}
	return value[:limit-1] + "…"
}

func latestCanvasUserMessage(messages []canvasChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

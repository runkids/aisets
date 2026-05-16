package server

import (
	"aisets/internal/scanner"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
)

func canvasAssetFileName(fileName string, repoPath string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName != "" {
		return fileName
	}
	if repoPath == "" {
		return ""
	}
	return filepath.Base(repoPath)
}

func compactCanvasAssetSnapshot(asset *canvasAssetSnapshot) map[string]any {
	if asset == nil {
		return nil
	}
	imageFormat := asset.ImageFormat
	if imageFormat == "" {
		imageFormat = strings.TrimPrefix(strings.ToLower(asset.Ext), ".")
	}
	summary := map[string]any{
		"assetId":     asset.ID,
		"fileName":    canvasAssetFileName(asset.FileName, asset.RepoPath),
		"repoPath":    asset.RepoPath,
		"projectName": asset.ProjectName,
		"ext":         asset.Ext,
		"usedByCount": asset.UsedByCount,
		"image": map[string]any{
			"format":   imageFormat,
			"width":    asset.Width,
			"height":   asset.Height,
			"animated": asset.Animated,
			"alpha":    asset.Alpha,
			"pages":    asset.Pages,
			"bytes":    asset.Bytes,
		},
		"visual": map[string]any{
			"url":          asset.URL,
			"thumbnailUrl": asset.ThumbnailURL,
		},
	}
	ai := map[string]any{}
	if asset.SearchCategory != "" {
		ai["category"] = asset.SearchCategory
	}
	if len(asset.SearchTags) > 0 {
		ai["tags"] = asset.SearchTags
	} else if len(asset.Tags) > 0 {
		ai["tags"] = asset.Tags
	}
	if asset.SearchDescription != "" {
		ai["description"] = truncate(asset.SearchDescription, 180)
	} else if asset.Description != "" {
		ai["description"] = truncate(asset.Description, 180)
	}
	if len(asset.SearchLanguages) > 0 {
		ai["languages"] = asset.SearchLanguages
	}
	if len(ai) > 0 {
		summary["ai"] = ai
	}
	if asset.OcrText != "" {
		summary["ocrText"] = truncate(asset.OcrText, 180)
	}
	return summary
}

func canvasAssetItemsFromActionResult(result any) []scanner.AssetItem {
	resultMap, ok := result.(map[string]any)
	if !ok {
		return nil
	}
	switch items := resultMap["items"].(type) {
	case []scanner.AssetItem:
		return items
	case []any:
		out := make([]scanner.AssetItem, 0, len(items))
		for _, item := range items {
			if asset, ok := item.(scanner.AssetItem); ok {
				out = append(out, asset)
			}
		}
		return out
	default:
		return nil
	}
}

func appendCanvasAssetItemsUnique(current []scanner.AssetItem, next []scanner.AssetItem) []scanner.AssetItem {
	if len(next) == 0 {
		return current
	}
	seen := map[string]bool{}
	for _, item := range current {
		if item.ID != "" {
			seen[item.ID] = true
		}
	}
	for _, item := range next {
		if item.ID != "" && seen[item.ID] {
			continue
		}
		current = append(current, item)
		if item.ID != "" {
			seen[item.ID] = true
		}
	}
	return current
}

func canvasLocaleFallbacks(locale string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	add(locale)
	switch strings.ToLower(locale) {
	case "zh-tw":
		add("zh-Hant")
		add("zh-traditional")
	case "zh-cn":
		add("zh-Hans")
		add("zh-simplified")
	}
	add("en")
	return out
}

func canvasAssetItemDescription(item scanner.AssetItem, locale string) string {
	if item.AITag == nil {
		return ""
	}
	locale = strings.TrimSpace(locale)
	for _, candidate := range canvasLocaleFallbacks(locale) {
		if strings.EqualFold(candidate, "en") {
			continue
		}
		if desc := strings.TrimSpace(item.AITag.DescriptionI18n[candidate]); desc != "" {
			return desc
		}
	}
	if desc := strings.TrimSpace(item.AITag.Description); desc != "" && !strings.EqualFold(locale, "en") {
		return desc
	}
	if desc := strings.TrimSpace(item.AITag.DescriptionI18n["en"]); desc != "" {
		return desc
	}
	if desc := strings.TrimSpace(item.AITag.Description); desc != "" {
		return desc
	}
	if len(item.AITag.Tags) > 0 {
		return strings.Join(item.AITag.Tags, ", ")
	}
	return ""
}

func canvasCatalogItemsDescriptionText(items []scanner.AssetItem, locale string) string {
	var b strings.Builder
	for _, item := range items {
		desc := canvasAssetItemDescription(item, locale)
		if desc == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "- %s: %s", canvasAssetFileName("", item.RepoPath), desc)
	}
	return b.String()
}

func canvasAddedAssetsAnswerText(items []scanner.AssetItem, locale string) string {
	return canvasCatalogItemsDescriptionText(items, locale)
}

func canvasCreatedCommentsAnswerText(texts []string, locale string) string {
	count := 0
	for _, text := range texts {
		if strings.TrimSpace(text) == "" {
			continue
		}
		count++
	}
	if count == 0 {
		return ""
	}
	if count == 1 {
		return "Added 1 comment."
	}
	return fmt.Sprintf("Added %d comments.", count)
}

func buildCanvasFollowupPrompt(reason string, latestUserMessage string, canvas canvasSnapshot, actions []canvasAction, toolResults []canvasCompactToolResult, completedTools []string, previousAssistantText string, photoStagingWorkflow bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Original User Request\n%s\n\n", latestUserMessage)
	fmt.Fprintf(&b, "## Loop Reason\n%s\n\n", reason)

	cards := compactCanvasRelevantCards(canvas, actions)
	if canvasCompletedToolsContain(completedTools, "duplicate_cards") {
		cards = compactCanvasCards(canvas.Cards, 12)
	}
	if photoStagingWorkflow {
		cards = compactCanvasPhotoStagingCards(canvasVisibleImageCards(canvas, 40), 40)
	}
	if len(cards) > 0 {
		cardJSON, _ := json.Marshal(cards)
		fmt.Fprintf(&b, "## Relevant Canvas Cards\n%s\n\n", string(cardJSON))
	}
	if photoStagingWorkflow {
		if ids := canvasVisibleImageCardIDs(canvas); len(ids) > 0 {
			fmt.Fprintf(&b, "## Photo Staging Target Image Cards\n%s\n\n", strings.Join(ids, ", "))
		}
	}
	if len(completedTools) > 0 {
		completedJSON, _ := json.Marshal(completedTools)
		fmt.Fprintf(&b, "## Completed Canvas Tools\n%s\n\n", string(completedJSON))
	}
	if previousAssistantText = strings.TrimSpace(previousAssistantText); previousAssistantText != "" {
		fmt.Fprintf(&b, "## Previous Assistant Text\n%s\n\n", truncate(previousAssistantText, 1200))
	}
	if len(toolResults) > 0 {
		resultJSON, _ := json.Marshal(toolResults)
		fmt.Fprintf(&b, "## Compact Tool Results\n%s\n\n", string(resultJSON))
	}
	if reason == canvasLoopReasonIncompleteTextAnnotation {
		if targets := canvasTextAnnotationTargets(canvas); len(targets) > 0 {
			targetJSON, _ := json.Marshal(targets)
			fmt.Fprintf(&b, "## Missing OCR Text Annotation Targets\n%s\n\n", string(targetJSON))
		}
	}
	if photoStagingWorkflow && !(reason == canvasLoopReasonToolResults && canvasPhotoStagingCaptureCompleted(completedTools)) {
		b.WriteString("## Photo Staging Creative Contract\n")
		b.WriteString(canvasPhotoStagingCreativeContract())
		b.WriteString("\n\n")
	}

	b.WriteString("## Required Follow-up\n")
	if canvasToolResultsNeedUserConfirmation(toolResults) {
		b.WriteString("The latest search result is marked needsUserConfirmation=true. Do not call add_assets_to_canvas, arrange_cards, or any other canvas mutation. Answer in chat that no suitable direct match was found, mention that candidate previews are shown for review, and ask the user to confirm which candidate should be added.")
		return b.String()
	}
	if reason == canvasLoopReasonToolResults && photoStagingWorkflow && canvasPhotoStagingCaptureCompleted(completedTools) {
		b.WriteString("The photo staging layout and screenshot capture are complete. Do not call more tools. Reply in the user's language with a concise staging concept and rationale. Mention the focal hierarchy, spacing, visual flow, editorial staging choices, and how any requested style direction influenced the composition.")
		return b.String()
	}
	b.WriteString(canvasFollowupInstruction(reason, latestUserMessage))
	return b.String()
}

func canvasPhotoStagingCreativeContract() string {
	return strings.Join([]string{
		"You are acting as a professional photographer and art director, not a grid-layout assistant.",
		"Preserve the user's requested style direction from the Original User Request across every loop.",
		"Create an editorial composition with a clear hero/focal hierarchy, supporting clusters, intentional negative space, staggered rhythm, and readable visual flow.",
		"Do not default to a rigid equal-size grid, perfectly even rows, or purely mechanical distribution unless the user explicitly asks for a grid.",
		"Aesthetic staging matters more than demonstrating every available tool.",
		"Use resizing, placement, and z-index to create depth and story: one or more hero images can be larger, supporting images can be grouped by theme, and small props can form foreground/background accents.",
		"Use resize_card for displayed card scale and arrange_cards for the actual composition. Use mirror_image or rotate_image only for a small number of deliberate PNG variants when a transformed image improves the staged composition, direction, or cover-like rhythm. rotate_image supports any integer-degree angle, so prefer subtle deliberate angles over arbitrary 90-degree turns unless 90 degrees is requested or clearly useful. Do not rotate, mirror, duplicate, or transform images merely because the tools are available.",
		"Use bring_cards_to_front to control foreground/hero layers intentionally. Do not rely on accidental overlap or insertion order for important objects.",
		"Capture only after real layout work covers all visible image cards and the staged layout expresses the requested style, not merely after all cards have non-overlapping positions.",
	}, " ")
}

func canvasToolResultsNeedUserConfirmation(results []canvasCompactToolResult) bool {
	for _, result := range results {
		if result.Tool != "search_assets" {
			continue
		}
		if needs, _ := result.Summary["needsUserConfirmation"].(bool); needs {
			return true
		}
	}
	return false
}

func canvasTextAnnotationTargets(canvas canvasSnapshot) []map[string]any {
	var targets []map[string]any
	for _, card := range canvas.Cards {
		if card.Kind != "asset" || card.Asset == nil {
			continue
		}
		ocrText := strings.TrimSpace(card.Asset.OcrText)
		if ocrText == "" {
			continue
		}
		targets = append(targets, map[string]any{
			"anchorCardId": card.ID,
			"assetId":      card.Asset.ID,
			"fileName":     card.Asset.FileName,
			"ocrText":      ocrText,
		})
	}
	return targets
}

func canvasFollowupInstruction(reason string, latestUserMessage string) string {
	switch reason {
	case canvasLoopReasonTruncatedAction:
		return "Your previous action block was truncated before the JSON finished. Reply with ONLY complete action blocks in ```action fences. Do not include explanatory prose. If arranging many cards, include all positions in one compact arrange_cards JSON object."
	case canvasLoopReasonMissingCapture:
		return canvasCaptureRepairPrompt(latestUserMessage)
	case canvasLoopReasonTextOnlyDeferredWork:
		return canvasActionRepairPrompt(latestUserMessage)
	case canvasLoopReasonFocusOnlyNeedsAnswer:
		return canvasFocusOnlyRepairPrompt(latestUserMessage)
	case canvasLoopReasonCaptureOnlyWork:
		return canvasCaptureOnlyRepairPrompt(latestUserMessage)
	case canvasLoopReasonInvalidAction:
		return canvasInvalidActionRepairPrompt(latestUserMessage)
	case canvasLoopReasonIncompleteTextAnnotation:
		return canvasIncompleteTextAnnotationRepairPrompt(latestUserMessage)
	case canvasLoopReasonOCRTextExtraction:
		return canvasOCRTextExtractionRepairPrompt(latestUserMessage)
	case canvasLoopReasonOCRTextAnnotation:
		return canvasOCRTextAnnotationRepairPrompt(latestUserMessage)
	case canvasLoopReasonBlockedComment:
		return "Your previous response tried to create a comment, but the user did not ask for an annotation. Do NOT call create_comment. Answer the user's latest question in chat prose, and only mention uncertainty or next steps if needed."
	case canvasLoopReasonToolResults:
		return "Continue from the compact tool results above. Use the returned IDs exactly. Do not repeat completed tool calls or repeat the same operation type unless the previous tool result was invalid. For duplicate workflows, arrange returned newCardIds but do not remove returned newCardIds as cleanup; remove_cards is only for pre-existing unrelated visible cards. For multi-step operation patterns, compare the Original User Request, Completed Canvas Tools, and Compact Tool Results, then call the next distinct missing tool from the English operation pattern. For the hero/main-image pattern, focus_card + resize_card + move_card/arrange_cards is incomplete until any requested layer/front/above/top placement has been completed with bring_cards_to_front. If the user's request is fulfilled, give a short answer."
	default:
		return "Continue the task from the context above."
	}
}

func compactCanvasRelevantCards(canvas canvasSnapshot, actions []canvasAction) []map[string]any {
	relevantIDs := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id != "" {
			relevantIDs[id] = true
		}
	}
	for _, id := range canvas.SelectedCardIDs {
		add(id)
	}
	for _, act := range actions {
		for _, id := range canvasActionCardIDs(act) {
			add(id)
		}
		for _, key := range []string{"anchorCardId", "afterCardId", "commentCardId"} {
			if id, ok := act.Params[key].(string); ok {
				add(id)
			}
		}
		if positions, ok := act.Params["positions"].([]any); ok {
			for _, raw := range positions {
				if pos, ok := raw.(map[string]any); ok {
					if id, ok := pos["cardId"].(string); ok {
						add(id)
					}
				}
			}
		}
		for _, assetID := range canvasActionAssetIDs(act) {
			for _, card := range canvas.Cards {
				if card.Asset != nil && card.Asset.ID == assetID {
					add(card.ID)
				}
			}
		}
	}
	if len(relevantIDs) == 0 && len(canvas.Cards) <= 6 {
		for _, card := range canvas.Cards {
			add(card.ID)
		}
	}

	out := []map[string]any{}
	for _, card := range canvas.Cards {
		if !relevantIDs[card.ID] {
			continue
		}
		out = append(out, compactCanvasCard(card))
	}
	return out
}

func canvasCompletedToolsContain(tools []string, want string) bool {
	for _, tool := range tools {
		if tool == want {
			return true
		}
	}
	return false
}

func canvasPromptRelevantCards(canvas canvasSnapshot, latestUserMessage string, limit int) []canvasCardSnapshot {
	if limit <= 0 || len(canvas.Cards) <= limit {
		return canvas.Cards
	}
	selected := map[string]bool{}
	for _, id := range canvas.SelectedCardIDs {
		if id = strings.TrimSpace(id); id != "" {
			selected[id] = true
		}
	}
	mentioned := canvasMentionedCardIDsForPrompt(latestUserMessage, canvas)
	out := make([]canvasCardSnapshot, 0, limit)
	seen := map[string]bool{}
	add := func(card canvasCardSnapshot) {
		if card.ID == "" || seen[card.ID] || len(out) >= limit {
			return
		}
		seen[card.ID] = true
		out = append(out, card)
	}
	for _, card := range canvas.Cards {
		if selected[card.ID] {
			add(card)
		}
	}
	for _, card := range canvas.Cards {
		if mentioned[card.ID] {
			add(card)
		}
	}
	for _, card := range canvas.Cards {
		add(card)
	}
	return out
}

func canvasVisibleImageCardIDs(canvas canvasSnapshot) []string {
	cards := canvasVisibleImageCards(canvas, 0)
	ids := make([]string, 0, len(cards))
	for _, card := range cards {
		if card.ID != "" {
			ids = append(ids, card.ID)
		}
	}
	return ids
}

func canvasVisibleImageCards(canvas canvasSnapshot, limit int) []canvasCardSnapshot {
	cards := make([]canvasCardSnapshot, 0, len(canvas.Cards))
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if card.ID == "" || seen[card.ID] {
			continue
		}
		switch card.Kind {
		case "asset", "upload", "variant", "group":
			seen[card.ID] = true
			cards = append(cards, card)
			if limit > 0 && len(cards) >= limit {
				return cards
			}
		}
	}
	return cards
}

func compactCanvasCards(cards []canvasCardSnapshot, limit int) []map[string]any {
	if limit <= 0 || limit > len(cards) {
		limit = len(cards)
	}
	out := make([]map[string]any, 0, limit)
	for _, card := range cards[:limit] {
		out = append(out, compactCanvasCard(card))
	}
	return out
}

func compactCanvasPhotoStagingCards(cards []canvasCardSnapshot, limit int) []map[string]any {
	if limit <= 0 || limit > len(cards) {
		limit = len(cards)
	}
	out := make([]map[string]any, 0, limit)
	for _, card := range cards[:limit] {
		out = append(out, compactCanvasPhotoStagingCard(card))
	}
	return out
}

func compactCanvasPhotoStagingCard(card canvasCardSnapshot) map[string]any {
	width := card.Width
	if width <= 0 {
		width = 320
	}
	height := card.Height
	if height <= 0 {
		height = 240
	}
	out := map[string]any{
		"cardId": card.ID,
		"kind":   card.Kind,
		"x":      card.X,
		"y":      card.Y,
		"width":  width,
		"height": height,
		"layer":  card.LayerIndex,
	}
	if card.Asset != nil {
		asset := card.Asset
		imageFormat := asset.ImageFormat
		if imageFormat == "" {
			imageFormat = strings.TrimPrefix(strings.ToLower(asset.Ext), ".")
		}
		out["assetId"] = asset.ID
		out["fileName"] = truncate(canvasAssetFileName(asset.FileName, asset.RepoPath), 80)
		if imageFormat != "" {
			out["format"] = imageFormat
		}
		if tags := compactCanvasStringList(firstNonEmptyStringList(asset.SearchTags, asset.Tags), 4); len(tags) > 0 {
			out["tags"] = tags
		}
		if desc := firstNonEmptyString(asset.SearchDescription, asset.Description); desc != "" {
			out["desc"] = truncate(desc, 60)
		}
		if len(asset.SearchLanguages) > 0 {
			out["languages"] = compactCanvasStringList(asset.SearchLanguages, 3)
		}
		if asset.OcrText != "" {
			out["ocr"] = truncate(asset.OcrText, 60)
		}
	}
	if card.Kind == "variant" {
		out["sourceAssetId"] = card.SourceAssetID
		out["sourceName"] = card.SourceName
		out["inputFormat"] = card.InputFormat
		out["outputFormat"] = card.OutputFormat
	}
	if card.Kind == "upload" {
		out["uploadToken"] = card.UploadToken
		out["fileName"] = card.UploadFileName
		out["uploadWidth"] = card.UploadWidth
		out["uploadHeight"] = card.UploadHeight
	}
	if card.Kind == "group" {
		out["name"] = card.Name
		out["cardIds"] = card.CardIDs
	}
	return out
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyStringList(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func compactCanvasStringList(values []string, limit int) []string {
	if limit <= 0 || limit > len(values) {
		limit = len(values)
	}
	out := make([]string, 0, limit)
	for _, value := range values[:limit] {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		out = append(out, value)
	}
	return out
}

func compactCanvasCard(card canvasCardSnapshot) map[string]any {
	width := card.Width
	if width <= 0 {
		width = 320
	}
	height := card.Height
	if height <= 0 {
		height = 240
	}
	out := map[string]any{
		"cardId": card.ID,
		"kind":   card.Kind,
		"x":      card.X,
		"y":      card.Y,
		"width":  width,
		"height": height,
		"layer":  card.LayerIndex,
	}
	if card.Asset != nil {
		out["assetId"] = card.Asset.ID
		out["repoPath"] = card.Asset.RepoPath
		out["assetWidth"] = card.Asset.Width
		out["assetHeight"] = card.Asset.Height
		out["asset"] = compactCanvasAssetSnapshot(card.Asset)
	}
	if card.Kind == "comment" {
		out["anchorId"] = card.AnchorID
		out["text"] = truncate(card.Text, 160)
	}
	if card.Kind == "proposal" {
		out["tool"] = card.Tool
		out["status"] = card.ProposalStatus
		out["description"] = truncate(card.Description, 160)
	}
	if card.Kind == "upload" {
		out["uploadToken"] = card.UploadToken
		out["fileName"] = card.UploadFileName
		out["uploadWidth"] = card.UploadWidth
		out["uploadHeight"] = card.UploadHeight
	}
	if card.Kind == "group" {
		out["name"] = card.Name
		out["cardIds"] = card.CardIDs
	}
	return out
}

func canvasGeneratedImagePathCandidates(content string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		raw = strings.Trim(raw, "`\"'")
		raw = strings.TrimPrefix(raw, "file://")
		if raw == "" {
			return
		}
		if decoded, err := url.PathUnescape(raw); err == nil {
			raw = decoded
		}
		ext := strings.ToLower(filepath.Ext(raw))
		switch ext {
		case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".heic", ".heif":
		default:
			return
		}
		if !filepath.IsAbs(raw) {
			return
		}
		clean := filepath.Clean(raw)
		if clean == "" || seen[clean] {
			return
		}
		seen[clean] = true
		out = append(out, clean)
	}
	for _, match := range markdownImagePathRe.FindAllStringSubmatch(content, -1) {
		if len(match) >= 2 {
			add(match[1])
		}
	}
	for _, match := range absoluteImagePathRe.FindAllStringSubmatch(content, -1) {
		if len(match) >= 3 {
			add(match[2])
		}
	}
	return out
}

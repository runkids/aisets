package server

import (
	"net/url"
	"path/filepath"
	"strings"
)

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

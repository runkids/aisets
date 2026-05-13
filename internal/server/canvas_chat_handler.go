package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
)

type canvasChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type canvasRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type canvasAssetSnapshot struct {
	ID          string   `json:"id"`
	RepoPath    string   `json:"repoPath"`
	Ext         string   `json:"ext"`
	Width       int      `json:"width"`
	Height      int      `json:"height"`
	Bytes       int64    `json:"bytes"`
	Tags        []string `json:"tags,omitempty"`
	Description string   `json:"description,omitempty"`
	OcrText     string   `json:"ocrText,omitempty"`
	UsedByCount int      `json:"usedByCount"`
}

type canvasCardSnapshot struct {
	ID             string               `json:"id"`
	Kind           string               `json:"kind"`
	X              float64              `json:"x"`
	Y              float64              `json:"y"`
	Asset          *canvasAssetSnapshot `json:"asset,omitempty"`
	AnchorID       string               `json:"anchorId,omitempty"`
	Text           string               `json:"text,omitempty"`
	Region         *canvasRegion        `json:"region,omitempty"`
	Tool           string               `json:"tool,omitempty"`
	ProposalStatus string               `json:"status,omitempty"`
	Description    string               `json:"description,omitempty"`
}

type canvasViewport struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Scale float64 `json:"scale"`
}

type canvasSnapshot struct {
	Viewport        canvasViewport       `json:"viewport"`
	SelectedCardIDs []string             `json:"selectedCardIds"`
	Cards           []canvasCardSnapshot `json:"cards"`
}

type canvasChatRequest struct {
	Messages []canvasChatMessage `json:"messages"`
	Canvas   canvasSnapshot      `json:"canvas"`
	Locale   string              `json:"locale"`
}

type canvasAction struct {
	Tool        string         `json:"tool"`
	Params      map[string]any `json:"params"`
	Description string         `json:"description"`
	Impact      string         `json:"impact"`
}

var actionBlockRe = regexp.MustCompile("(?s)```action\\s*\\n(.*?)\\n```")
var toolCallRe = regexp.MustCompile(`(?s)<\|?tool_call\|?>\s*(?:call\s*\(?\s*)?(\{.+\})\s*\)?\s*<\|?/?tool_call\|?>`)

var toolCallCleanRe = regexp.MustCompile(`(?s)<\|?/?tool_call\|?>`)

type canvasActionSpan struct {
	start, end int
	json       string
}

func balancedJSONObjectEnd(s string, start int) int {
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(s); i++ {
		ch := s[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			continue
		}
		switch ch {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return -1
}

func findPlainCanvasCallSpans(content string) []canvasActionSpan {
	var spans []canvasActionSpan
	searchStart := 0
	for {
		idx := strings.Index(content[searchStart:], "call:")
		if idx < 0 {
			break
		}
		start := searchStart + idx
		jsonStart := start + len("call:")
		for jsonStart < len(content) && strings.ContainsRune(" \n\r\t", rune(content[jsonStart])) {
			jsonStart++
		}
		hasParen := jsonStart < len(content) && content[jsonStart] == '('
		if hasParen {
			jsonStart++
			for jsonStart < len(content) && strings.ContainsRune(" \n\r\t", rune(content[jsonStart])) {
				jsonStart++
			}
		}
		if jsonStart >= len(content) || content[jsonStart] != '{' {
			searchStart = start + len("call:")
			continue
		}
		jsonEnd := balancedJSONObjectEnd(content, jsonStart)
		if jsonEnd < 0 {
			searchStart = start + len("call:")
			continue
		}
		end := jsonEnd
		if hasParen {
			for end < len(content) && strings.ContainsRune(" \n\r\t", rune(content[end])) {
				end++
			}
			if end < len(content) && content[end] == ')' {
				end++
			}
		}
		spans = append(spans, canvasActionSpan{start: start, end: end, json: content[jsonStart:jsonEnd]})
		searchStart = end
	}
	return spans
}

func parseCanvasActions(content string) (textBody string, actions []canvasAction) {
	matches := actionBlockRe.FindAllStringSubmatchIndex(content, -1)
	toolMatches := toolCallRe.FindAllStringSubmatchIndex(content, -1)
	plainCallSpans := findPlainCanvasCallSpans(content)

	if len(matches) == 0 && len(toolMatches) == 0 && len(plainCallSpans) == 0 {
		cleaned := toolCallCleanRe.ReplaceAllString(content, "")
		return strings.TrimSpace(cleaned), nil
	}

	var spans []canvasActionSpan
	for _, loc := range matches {
		spans = append(spans, canvasActionSpan{loc[0], loc[1], content[loc[2]:loc[3]]})
	}
	for _, loc := range toolMatches {
		spans = append(spans, canvasActionSpan{loc[0], loc[1], content[loc[2]:loc[3]]})
	}
	spans = append(spans, plainCallSpans...)
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })

	var textParts []string
	prev := 0
	for _, s := range spans {
		if s.start > prev {
			textParts = append(textParts, content[prev:s.start])
		}
		var act canvasAction
		if err := json.Unmarshal([]byte(s.json), &act); err == nil && act.Tool != "" {
			actions = append(actions, act)
		}
		if s.end > prev {
			prev = s.end
		}
	}
	if prev < len(content) {
		textParts = append(textParts, content[prev:])
	}
	joined := strings.Join(textParts, "\n")
	joined = toolCallCleanRe.ReplaceAllString(joined, "")
	textBody = strings.TrimSpace(joined)
	return textBody, actions
}

func buildCanvasUserPrompt(messages []canvasChatMessage, canvas canvasSnapshot) string {
	var b strings.Builder

	b.WriteString("## Canvas State\n")
	if len(canvas.SelectedCardIDs) > 0 {
		fmt.Fprintf(&b, "Selected cards: %s\n", strings.Join(canvas.SelectedCardIDs, ", "))
	}
	fmt.Fprintf(&b, "Total cards: %d\n\n", len(canvas.Cards))

	for _, card := range canvas.Cards {
		fmt.Fprintf(&b, "- [%s] id=%s pos=(%.0f,%.0f)", card.Kind, card.ID, card.X, card.Y)
		if card.Asset != nil {
			a := card.Asset
			fmt.Fprintf(&b, " path=%s ext=%s %dx%d %dB", a.RepoPath, a.Ext, a.Width, a.Height, a.Bytes)
			if len(a.Tags) > 0 {
				fmt.Fprintf(&b, " tags=[%s]", strings.Join(a.Tags, ","))
			}
			if a.Description != "" {
				fmt.Fprintf(&b, " desc=%q", truncate(a.Description, 200))
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
		if card.Kind == "proposal" {
			fmt.Fprintf(&b, " tool=%s status=%s", card.Tool, card.ProposalStatus)
		}
		b.WriteByte('\n')
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

func (s *Server) handleCanvasChat(w http.ResponseWriter, r *http.Request) {
	var req canvasChatRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_request"))
		return
	}
	if len(req.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, apierr.New("canvas_chat_no_messages", "at least one message is required"))
		return
	}

	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "canvas_chat_settings_failed"))
		return
	}
	if !s.hasVLMBackend(settings) {
		writeJSON(w, http.StatusServiceUnavailable, apierr.New("canvas_chat_no_backend", "no AI backend configured"))
		return
	}

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureCanvas)

	locale := req.Locale
	if locale == "" {
		locale = "en"
	}
	systemPrompt := canvasSystemPrompt(locale)
	userPrompt := buildCanvasUserPrompt(req.Messages, req.Canvas)

	var images []vlmImage
	for _, card := range req.Canvas.Cards {
		if card.Asset == nil {
			continue
		}
		selected := false
		for _, sid := range req.Canvas.SelectedCardIDs {
			if sid == card.ID {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			continue
		}
		item, err := s.store.CatalogItem(scanID, card.Asset.ID)
		if err != nil || item.LocalPath == "" {
			continue
		}
		images = append(images, vlmImage{Path: item.LocalPath, Ext: item.Ext})
		if len(images) >= 4 {
			break
		}
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	if len(req.Canvas.SelectedCardIDs) > 0 {
		sendNDJSON(w, map[string]any{
			"type":   "focus",
			"cardId": req.Canvas.SelectedCardIDs[0],
			"label":  "Examining...",
		})
		time.Sleep(800 * time.Millisecond)
	}
	sendNDJSON(w, map[string]any{"type": "thinking"})

	const maxToolLoops = 3
	currentPrompt := userPrompt
	proposalIndex := 0
	var totalInputTokens, totalOutputTokens int64
	start := time.Now()

	for loop := 0; loop < maxToolLoops; loop++ {
		content, chatResp, err := s.chatVLM(r.Context(), images, backend, modelName, systemPrompt, currentPrompt, "canvas", 120)
		if err != nil {
			sendNDJSON(w, map[string]any{
				"type":  "error",
				"error": map[string]string{"code": "canvas_chat_llm_failed", "message": err.Error()},
			})
			return
		}
		totalInputTokens += chatResp.InputTokens
		totalOutputTokens += chatResp.OutputTokens

		textBody, actions := parseCanvasActions(content)

		var toolResults []string
		for _, act := range actions {
			if act.Tool == "focus_card" {
				sendNDJSON(w, map[string]any{
					"type":   "focus",
					"cardId": act.Params["cardId"],
					"label":  act.Params["label"],
				})
				time.Sleep(300 * time.Millisecond)
				continue
			}
			if canvasToolSafe(act.Tool) {
				result := s.executeCanvasSafeAction(r, act, settings)
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				resultJSON, _ := json.Marshal(result)
				toolResults = append(toolResults, fmt.Sprintf("[Tool Result: %s]\n%s", act.Tool, string(resultJSON)))
			} else {
				proposalIndex++
				sendNDJSON(w, map[string]any{
					"type":          "proposal",
					"id":            fmt.Sprintf("p%d", proposalIndex),
					"tool":          act.Tool,
					"params":        act.Params,
					"description":   act.Description,
					"impact":        act.Impact,
					"targetAssetId": act.Params["assetId"],
				})
			}
			time.Sleep(150 * time.Millisecond)
		}

		if textBody != "" {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(w, map[string]any{"type": "text", "content": p})
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		if len(toolResults) == 0 {
			break
		}
		images = nil
		currentPrompt = currentPrompt + "\n\nassistant: " + content + "\n\n## Tool Results\n" + strings.Join(toolResults, "\n\n") + "\n\nContinue acting on these results. Use the data above to fulfill the user's original request. Remember: EVERY response must include at least one action block."
		sendNDJSON(w, map[string]any{"type": "thinking"})
	}

	durationMs := time.Since(start).Milliseconds()
	sendNDJSON(w, map[string]any{
		"type":         "done",
		"providerName": providerName,
		"modelName":    modelName,
		"durationMs":   durationMs,
		"inputTokens":  totalInputTokens,
		"outputTokens": totalOutputTokens,
	})
}

func splitParagraphs(text string) []string {
	raw := strings.Split(text, "\n\n")
	var result []string
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	if len(result) == 0 && text != "" {
		return []string{text}
	}
	return result
}

func (s *Server) executeCanvasSafeAction(r *http.Request, act canvasAction, settings config.AppSettings) any {
	switch act.Tool {
	case "focus_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
			"label":  act.Params["label"],
		}
	case "get_asset_detail":
		assetID, _ := act.Params["assetId"].(string)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"error": "no scan available"}
		}
		item, err := s.store.CatalogItem(scanID, assetID)
		if err != nil {
			return map[string]any{"error": "asset not found: " + err.Error()}
		}
		detail := map[string]any{
			"id":            item.ID,
			"repoPath":      item.RepoPath,
			"localPath":     item.LocalPath,
			"projectId":     item.ProjectID,
			"projectName":   item.ProjectName,
			"ext":           item.Ext,
			"width":         item.Image.Width,
			"height":        item.Image.Height,
			"bytes":         item.Bytes,
			"contentHash":   item.ContentHash,
			"hashAlgorithm": item.HashAlgorithm,
			"usedByCount":   len(item.UsedBy),
		}
		if item.AITag != nil {
			detail["aiTag"] = map[string]any{
				"category":    item.AITag.Category,
				"tags":        item.AITag.Tags,
				"description": item.AITag.Description,
			}
		}
		if item.OCR != nil && item.OCR.Text != "" {
			detail["ocrText"] = item.OCR.Text
		}
		if len(item.UsedBy) > 0 && len(item.UsedBy) <= 10 {
			detail["usedBy"] = item.UsedBy
		}
		return detail
	case "search_assets":
		q, _ := act.Params["q"].(string)
		limit := 12
		if l, ok := act.Params["limit"].(float64); ok && l > 0 {
			limit = int(l)
			if limit > 18 {
				limit = 18
			}
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		query := config.CatalogItemQuery{
			ScanID: scanID,
			Query:  q,
			Limit:  limit,
		}
		page, err := s.store.CatalogItems(query)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		type richAsset struct {
			ID          string   `json:"id"`
			RepoPath    string   `json:"repoPath"`
			Ext         string   `json:"ext"`
			Width       int      `json:"width"`
			Height      int      `json:"height"`
			Bytes       int64    `json:"bytes"`
			Tags        []string `json:"tags,omitempty"`
			Description string   `json:"description,omitempty"`
			OcrText     string   `json:"ocrText,omitempty"`
		}
		items := make([]richAsset, 0, len(page.Items))
		for _, item := range page.Items {
			ra := richAsset{
				ID:       item.ID,
				RepoPath: item.RepoPath,
				Ext:      item.Ext,
				Width:    item.Image.Width,
				Height:   item.Image.Height,
				Bytes:    item.Bytes,
			}
			if item.AITag != nil {
				ra.Tags = item.AITag.Tags
				ra.Description = item.AITag.Description
			}
			if item.OCR != nil && item.OCR.Text != "" {
				ra.OcrText = item.OCR.Text
			}
			items = append(items, ra)
		}
		return map[string]any{"items": items, "total": page.Total, "q": q}
	case "create_comment":
		return map[string]any{
			"anchorCardId": act.Params["anchorCardId"],
			"text":         act.Params["text"],
			"region":       act.Params["region"],
		}
	case "move_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
			"x":      act.Params["x"],
			"y":      act.Params["y"],
		}
	case "arrange_cards":
		return map[string]any{
			"positions": act.Params["positions"],
		}
	default:
		return map[string]any{"error": "unknown safe tool: " + act.Tool}
	}
}

func (s *Server) latestScanID() int64 {
	scan, err := s.store.LatestScan()
	if err != nil {
		return 0
	}
	return scan.ID
}

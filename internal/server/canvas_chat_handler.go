package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
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
	Width          float64              `json:"width,omitempty"`
	Height         float64              `json:"height,omitempty"`
	LayerIndex     int                  `json:"layerIndex,omitempty"`
	Asset          *canvasAssetSnapshot `json:"asset,omitempty"`
	AnchorID       string               `json:"anchorId,omitempty"`
	Text           string               `json:"text,omitempty"`
	Region         *canvasRegion        `json:"region,omitempty"`
	Tool           string               `json:"tool,omitempty"`
	ProposalStatus string               `json:"status,omitempty"`
	Description    string               `json:"description,omitempty"`
	SourceAssetID  string               `json:"sourceAssetId,omitempty"`
	SourceAssetIDs []string             `json:"sourceAssetIds,omitempty"`
	SourceName     string               `json:"sourceName,omitempty"`
	InputBytes     int64                `json:"inputBytes,omitempty"`
	OutputBytes    int64                `json:"outputBytes,omitempty"`
	InputFormat    string               `json:"inputFormat,omitempty"`
	OutputFormat   string               `json:"outputFormat,omitempty"`
	UploadToken    string               `json:"uploadToken,omitempty"`
	UploadFileName string               `json:"uploadFileName,omitempty"`
	UploadWidth    int                  `json:"uploadWidth,omitempty"`
	UploadHeight   int                  `json:"uploadHeight,omitempty"`
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

type canvasChatOptions struct {
	ImageOptimizationAdvice bool   `json:"imageOptimizationAdvice"`
	CanvasImageAttached     bool   `json:"-"`
	AutoLocale              bool   `json:"-"`
	CanvasStrategy          string `json:"-"`
}

type canvasChatRequest struct {
	Messages    []canvasChatMessage `json:"messages"`
	Canvas      canvasSnapshot      `json:"canvas"`
	Locale      string              `json:"locale"`
	Options     canvasChatOptions   `json:"options"`
	CanvasImage string              `json:"canvasImage,omitempty"`
}

type canvasAction struct {
	Tool        string         `json:"tool"`
	Params      map[string]any `json:"params"`
	Description string         `json:"description"`
	Impact      string         `json:"impact"`
}

var actionBlockRe = regexp.MustCompile("(?s)```action\\s*\\n(.*?)\\n```")
var jsonActionBlockRe = regexp.MustCompile("(?s)```json\\s*\\n(.*?)\\n```")
var toolCallRe = regexp.MustCompile(`(?s)<\|?tool_call\|?>\s*(?:call\s*\(?\s*)?(\{.+\})\s*\)?\s*<\|?/?tool_call\|?>`)

var toolCallCleanRe = regexp.MustCompile(`(?s)<\|?/?tool_call\|?>`)
var unquotedJSONKeyRe = regexp.MustCompile(`([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:`)
var hanTextRe = regexp.MustCompile(`\p{Han}`)
var kanaTextRe = regexp.MustCompile(`[ぁ-ゟ゠-ヿ]`)
var hangulTextRe = regexp.MustCompile(`[가-힣]`)
var filenameTokenRe = regexp.MustCompile(`(?i)([A-Za-z0-9][A-Za-z0-9_-]*)\.(png|jpe?g|webp|gif|svg|avif|heic)`)
var assetStemTokenRe = regexp.MustCompile(`[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+`)

type canvasActionSpan struct {
	start, end int
	json       string
	actions    []canvasAction
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

func normalizeCanvasActionJSON(raw string) string {
	raw = strings.ReplaceAll(raw, `<|"|>`, `"`)
	raw = strings.ReplaceAll(raw, `<|“|>`, `"`)
	raw = strings.ReplaceAll(raw, `<|”|>`, `"`)
	return unquotedJSONKeyRe.ReplaceAllString(raw, `$1"$2":`)
}

func parseCanvasActionJSON(raw string) []canvasAction {
	raw = normalizeCanvasActionJSON(strings.TrimSpace(raw))
	if raw == "" {
		return nil
	}
	var list []canvasAction
	if err := json.Unmarshal([]byte(raw), &list); err == nil {
		var actions []canvasAction
		for _, act := range list {
			if act.Tool != "" {
				actions = append(actions, act)
			}
		}
		return actions
	}
	var act canvasAction
	if err := json.Unmarshal([]byte(raw), &act); err == nil && act.Tool != "" {
		return []canvasAction{act}
	}
	return nil
}

func findLooseQuotedCanvasCallSpans(content string) []canvasActionSpan {
	var spans []canvasActionSpan
	searchStart := 0
	for {
		idx := strings.Index(content[searchStart:], "call:")
		if idx < 0 {
			break
		}
		start := searchStart + idx
		pos := start + len("call:")
		for pos < len(content) && strings.ContainsRune(" \n\r\t", rune(content[pos])) {
			pos++
		}
		if pos >= len(content) || content[pos] != '"' {
			searchStart = start + len("call:")
			continue
		}
		toolStart := pos + 1
		toolEndRel := strings.Index(content[toolStart:], "\"")
		if toolEndRel < 0 {
			searchStart = start + len("call:")
			continue
		}
		toolEnd := toolStart + toolEndRel
		toolName := strings.TrimSpace(content[toolStart:toolEnd])
		paramsKeyRel := strings.Index(content[toolEnd:], "params")
		if toolName == "" || paramsKeyRel < 0 {
			searchStart = start + len("call:")
			continue
		}
		paramsPos := toolEnd + paramsKeyRel + len("params")
		colonRel := strings.Index(content[paramsPos:], ":")
		if colonRel < 0 {
			searchStart = start + len("call:")
			continue
		}
		jsonStart := paramsPos + colonRel + 1
		for jsonStart < len(content) && strings.ContainsRune(" \n\r\t", rune(content[jsonStart])) {
			jsonStart++
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
		var params map[string]any
		if err := json.Unmarshal([]byte(normalizeCanvasActionJSON(content[jsonStart:jsonEnd])), &params); err != nil {
			searchStart = start + len("call:")
			continue
		}
		payload, _ := json.Marshal(canvasAction{Tool: toolName, Params: params})
		end := extendCanvasActionMetadataEnd(content, jsonEnd)
		spans = append(spans, canvasActionSpan{start: start, end: end, json: string(payload)})
		searchStart = end
	}
	return spans
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
		toolName := ""
		if jsonStart < len(content) && content[jsonStart] != '{' {
			toolStart := jsonStart
			for jsonStart < len(content) {
				ch := content[jsonStart]
				if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_') {
					break
				}
				jsonStart++
			}
			toolName = strings.TrimSpace(content[toolStart:jsonStart])
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
		jsonBody := normalizeCanvasActionJSON(content[jsonStart:jsonEnd])
		if toolName != "" {
			payload, _ := json.Marshal(canvasAction{Tool: toolName, Params: map[string]any{}})
			var act map[string]any
			_ = json.Unmarshal(payload, &act)
			var params map[string]any
			if err := json.Unmarshal([]byte(jsonBody), &params); err == nil {
				act["params"] = params
				payload, _ = json.Marshal(act)
				jsonBody = string(payload)
			}
		}
		end = extendCanvasActionMetadataEnd(content, end)
		spans = append(spans, canvasActionSpan{start: start, end: end, json: jsonBody})
		searchStart = end
	}
	return spans
}

func extendCanvasActionMetadataEnd(content string, end int) int {
	extended := end
	for {
		next, ok := canvasActionMetadataPairEnd(content, extended)
		if !ok {
			return extended
		}
		extended = next
	}
}

func canvasActionMetadataPairEnd(content string, start int) (int, bool) {
	pos := start
	for pos < len(content) && strings.ContainsRune(" \n\r\t", rune(content[pos])) {
		pos++
	}
	if pos >= len(content) || content[pos] != ',' {
		return start, false
	}
	pos++
	for pos < len(content) && strings.ContainsRune(" \n\r\t", rune(content[pos])) {
		pos++
	}
	keyStart := pos
	if pos < len(content) && content[pos] == '"' {
		pos++
		keyStart = pos
		for pos < len(content) && content[pos] != '"' {
			pos++
		}
		if pos >= len(content) {
			return start, false
		}
	} else {
		for pos < len(content) && isCanvasCallIdentChar(content[pos]) {
			pos++
		}
	}
	key := content[keyStart:pos]
	if pos < len(content) && content[pos] == '"' {
		pos++
	}
	if key != "description" && key != "impact" {
		return start, false
	}
	for pos < len(content) && strings.ContainsRune(" \n\r\t", rune(content[pos])) {
		pos++
	}
	if pos >= len(content) || content[pos] != ':' {
		return start, false
	}
	pos++
	for pos < len(content) && strings.ContainsRune(" \n\r\t", rune(content[pos])) {
		pos++
	}
	valueEnd := canvasActionMetadataValueEnd(content, pos)
	if valueEnd < 0 {
		return start, false
	}
	return valueEnd, true
}

func canvasActionMetadataValueEnd(content string, start int) int {
	if strings.HasPrefix(content[start:], `<|"|>`) || strings.HasPrefix(content[start:], `<|“|>`) || strings.HasPrefix(content[start:], `<|”|>`) {
		quoteEnd := strings.Index(content[start+5:], "<|")
		if quoteEnd < 0 {
			return -1
		}
		return start + 5 + quoteEnd + len(`<|"|>`)
	}
	if start >= len(content) {
		return -1
	}
	switch content[start] {
	case '"':
		escaped := false
		for i := start + 1; i < len(content); i++ {
			if escaped {
				escaped = false
				continue
			}
			if content[i] == '\\' {
				escaped = true
				continue
			}
			if content[i] == '"' {
				return i + 1
			}
		}
	case '{':
		return balancedJSONObjectEnd(content, start)
	}
	return -1
}

func findBareCanvasCallSpans(content string) []canvasActionSpan {
	var spans []canvasActionSpan
	searchStart := 0
	for {
		idx := strings.Index(content[searchStart:], "call")
		if idx < 0 {
			break
		}
		start := searchStart + idx
		beforeOK := start == 0 || !isCanvasCallIdentChar(content[start-1])
		after := start + len("call")
		afterOK := after >= len(content) || !isCanvasCallIdentChar(content[after])
		if !beforeOK || !afterOK || (after < len(content) && content[after] == ':') {
			searchStart = start + len("call")
			continue
		}
		jsonStart := after
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
			searchStart = start + len("call")
			continue
		}
		jsonEnd := balancedJSONObjectEnd(content, jsonStart)
		if jsonEnd < 0 {
			searchStart = start + len("call")
			continue
		}
		jsonBody := normalizeCanvasActionJSON(content[jsonStart:jsonEnd])
		if len(parseCanvasActionJSON(jsonBody)) == 0 {
			searchStart = start + len("call")
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
		spans = append(spans, canvasActionSpan{start: start, end: end, json: jsonBody})
		searchStart = end
	}
	return spans
}

func isCanvasCallIdentChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_'
}

func canvasActionBlockLikelyTruncated(content string) bool {
	idx := strings.LastIndex(content, "```action")
	if idx < 0 {
		return false
	}
	rest := content[idx+len("```action"):]
	return !strings.Contains(rest, "```")
}

func parseCanvasActions(content string) (textBody string, actions []canvasAction) {
	if parsed := parseCanvasActionJSON(content); len(parsed) > 0 {
		return "", parsed
	}

	matches := actionBlockRe.FindAllStringSubmatchIndex(content, -1)
	jsonMatches := jsonActionBlockRe.FindAllStringSubmatchIndex(content, -1)
	toolMatches := toolCallRe.FindAllStringSubmatchIndex(content, -1)
	plainCallSpans := findPlainCanvasCallSpans(content)
	looseQuotedCallSpans := findLooseQuotedCanvasCallSpans(content)
	bareCallSpans := findBareCanvasCallSpans(content)

	if len(matches) == 0 && len(jsonMatches) == 0 && len(toolMatches) == 0 && len(plainCallSpans) == 0 && len(looseQuotedCallSpans) == 0 && len(bareCallSpans) == 0 {
		cleaned := toolCallCleanRe.ReplaceAllString(content, "")
		return strings.TrimSpace(cleaned), nil
	}

	var spans []canvasActionSpan
	for _, loc := range matches {
		spans = append(spans, canvasActionSpan{start: loc[0], end: loc[1], json: content[loc[2]:loc[3]]})
	}
	for _, loc := range jsonMatches {
		parsed := parseCanvasActionJSON(content[loc[2]:loc[3]])
		if len(parsed) == 0 {
			continue
		}
		spans = append(spans, canvasActionSpan{start: loc[0], end: loc[1], actions: parsed})
	}
	for _, loc := range toolMatches {
		spans = append(spans, canvasActionSpan{start: loc[0], end: loc[1], json: content[loc[2]:loc[3]]})
	}
	spans = append(spans, plainCallSpans...)
	spans = append(spans, looseQuotedCallSpans...)
	spans = append(spans, bareCallSpans...)
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })

	var textParts []string
	prev := 0
	for _, s := range spans {
		if s.start < prev {
			continue
		}
		if s.start > prev {
			textParts = append(textParts, content[prev:s.start])
		}
		if len(s.actions) > 0 {
			actions = append(actions, s.actions...)
		} else {
			actions = append(actions, parseCanvasActionJSON(s.json)...)
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

func canvasActionsFromToolCalls(calls []llm.ChatToolCall) []canvasAction {
	var actions []canvasAction
	for _, call := range calls {
		if canvasToolCardinality(call.Name) == "" {
			continue
		}
		params := call.Arguments
		description := ""
		impact := ""
		if nested, ok := params["params"].(map[string]any); ok {
			if rawDescription, ok := params["description"].(string); ok {
				description = rawDescription
			}
			if rawImpact, ok := params["impact"].(string); ok {
				impact = rawImpact
			}
			params = nested
		}
		if params == nil {
			params = map[string]any{}
		}
		actions = append(actions, canvasAction{
			Tool:        call.Name,
			Params:      params,
			Description: description,
			Impact:      impact,
		})
	}
	return actions
}

func canvasActionsOnlyFocus(actions []canvasAction) bool {
	if len(actions) == 0 {
		return false
	}
	for _, act := range actions {
		if act.Tool != "focus_card" {
			return false
		}
	}
	return true
}

func canvasLatestUserLanguage(latestUserMessage string, locale string) string {
	if hangulTextRe.MatchString(latestUserMessage) {
		return "Korean (한국어)"
	}
	if kanaTextRe.MatchString(latestUserMessage) {
		return "Japanese (日本語)"
	}
	if hanTextRe.MatchString(latestUserMessage) {
		if strings.HasPrefix(locale, "zh-CN") {
			return "Simplified Chinese (简体中文)"
		}
		return "Traditional Chinese (繁體中文)"
	}
	return ""
}

func buildCanvasUserPrompt(messages []canvasChatMessage, canvas canvasSnapshot, options canvasChatOptions, locale string) string {
	var b strings.Builder

	b.WriteString("## Canvas State\n")
	if len(canvas.SelectedCardIDs) > 0 {
		fmt.Fprintf(&b, "Selected cards: %s\n", strings.Join(canvas.SelectedCardIDs, ", "))
		var selectedAssets []string
		var selectedUploads []string
		selected := map[string]bool{}
		for _, id := range canvas.SelectedCardIDs {
			selected[id] = true
		}
		for _, card := range canvas.Cards {
			if selected[card.ID] && card.Asset != nil {
				selectedAssets = append(selectedAssets, fmt.Sprintf("card=%s assetId=%s path=%s", card.ID, card.Asset.ID, card.Asset.RepoPath))
			}
			if selected[card.ID] && card.Kind == "upload" && card.UploadToken != "" {
				selectedUploads = append(selectedUploads, fmt.Sprintf("card=%s file=%s %dx%d", card.ID, card.UploadFileName, card.UploadWidth, card.UploadHeight))
			}
		}
		if len(selectedAssets) > 0 {
			fmt.Fprintf(&b, "Selected asset targets (%d):\n- %s\n", len(selectedAssets), strings.Join(selectedAssets, "\n- "))
		}
		if len(selectedUploads) > 0 {
			fmt.Fprintf(&b, "Selected upload targets (%d):\n- %s\n", len(selectedUploads), strings.Join(selectedUploads, "\n- "))
		}
	}
	fmt.Fprintf(&b, "Total cards: %d\n", len(canvas.Cards))
	fmt.Fprintf(&b, "Viewport: pan=(%.0f,%.0f) scale=%.2f\n\n", canvas.Viewport.X, canvas.Viewport.Y, canvas.Viewport.Scale)

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

	for _, card := range canvas.Cards {
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

	b.WriteString("\n## Layout Facts\n")
	if options.CanvasImageAttached {
		b.WriteString("- A hidden AI-only screenshot of the current canvas is attached. Use it to judge visual overlap, spacing, scale, and composition before arranging cards.\n")
	}
	if hasBounds {
		fmt.Fprintf(&b, "- Current card cluster bounds: x=%.0f y=%.0f width=%.0f height=%.0f.\n", minX, minY, maxX-minX, maxY-minY)
	}
	b.WriteString("- The canvas is large/unbounded. You may use much wider coordinates than the current cluster; do NOT assume the visible whitespace is unavailable.\n")
	b.WriteString("- Card positions are top-left canvas coordinates. Use each card's size when spacing items; do not assume all cards are 320px wide.\n")
	b.WriteString("- Coordinate scale: 100px is a small nudge, 200-350px is a nearby move, 600px+ is a large jump. Directional requests like right/left/up/down usually mean a nearby relative move, not a jump across the board.\n")
	b.WriteString("- To place one card beside another, use target.x + target.width + 80-160px for the next x coordinate. Keep y close unless the user asks for a diagonal or new row.\n")
	b.WriteString("- Higher layer values render later/on top. arrange_cards and move_card only change x/y, not z-index, so avoid overlap instead of relying on stacking.\n")
	b.WriteString("- resize_card changes only the visual displayed card width. Use it to make a hero image larger or supporting images smaller before arranging.\n")
	b.WriteString("- For a spread-out layout, leave at least 160px horizontal and 120px vertical whitespace between card bounding boxes unless the user asks for a collage.\n")
	b.WriteString("- For 8+ cards, spread them across a broad board (roughly 1600-2400px wide, multiple rows/columns). Avoid piling every card near the center or around one hero image.\n")

	if lang := canvasLatestUserLanguage(latestCanvasUserMessage(messages), locale); lang != "" {
		fmt.Fprintf(&b, "\n## Response Language Override\n- The latest user message is written in %s. Respond in %s for natural-language text and tool labels/descriptions/impacts unless the user explicitly requests another language.\n", lang, lang)
	}

	b.WriteString("\n## Assistant Options\n")
	if options.ImageOptimizationAdvice {
		b.WriteString("- Image optimization advice is ON. Proactively inspect selected or visible image assets for web delivery opportunities using format, dimensions, byte size, transparency/animation hints, and visual content. When useful, create NEEDS_CONFIRMATION proposal cards with compress_image, resize_image, or convert_image. Do not apply changes directly.\n")
	} else {
		b.WriteString("- Image optimization advice is OFF. Do not proactively propose compression, resizing, or format conversion unless the user's latest request explicitly asks for optimization.\n")
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

func latestCanvasUserMessage(messages []canvasChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

func canvasSearchQueryCandidates(s string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		out = append(out, v)
	}
	add(s)
	for _, match := range filenameTokenRe.FindAllStringSubmatch(s, -1) {
		if len(match) >= 2 {
			add(match[1])
		}
	}
	for _, token := range assetStemTokenRe.FindAllString(s, -1) {
		add(token)
	}
	return out
}

func canvasExactFilenameStem(s string) string {
	candidates := canvasSearchQueryCandidates(s)
	if len(candidates) > 1 {
		return candidates[1]
	}
	return ""
}

func containsAnyText(s string, terms ...string) bool {
	s = strings.ToLower(s)
	for _, term := range terms {
		if strings.Contains(s, strings.ToLower(term)) {
			return true
		}
	}
	return false
}

func isCanvasOptimizationTool(tool string) bool {
	switch tool {
	case "compress_image", "resize_image", "convert_image":
		return true
	default:
		return false
	}
}

func canvasToolSuppressesSameTurnText(tool string) bool {
	return tool != "focus_card"
}

func canvasUserAsksVisualIdentification(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"what is this", "what's this", "what is it", "what's it", "what is this doing", "what are they doing", "identify this", "recognize this",
		"這是什麼", "這是啥", "這是甚麼", "這啥", "這張是什麼", "這張是啥", "他在做什麼", "他在做啥", "在做什麼", "在做啥",
		"这是什么", "这是啥", "这是甚么", "这啥", "这张是什么", "这张是啥", "他在做什么", "他在做啥", "在做什么", "在做啥",
	)
}

func canvasUserAsksOptimizationReview(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"issue", "problem", "quality", "review", "audit", "delivery", "performance", "file size", "too large",
		"問題", "品质", "品質", "檢查", "检查", "看看有沒有問題", "看看有没有问题", "載入", "加载", "速度", "太大", "檔案太大", "文件太大",
	)
}

func canvasUserAsksAnnotation(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"annotate", "annotation", "comment", "add a note", "leave a note", "mark", "mark up", "circle", "highlight", "pin",
		"註解", "注解", "留言", "加註", "加注", "標註", "标注", "標記", "标记", "圈出", "圈起來", "圈起来", "指出來", "指出来", "高亮",
	)
}

func canvasProposalAllowed(tool string, latestUserMessage string, options canvasChatOptions) bool {
	if canvasToolSafe(tool) {
		return true
	}
	if options.ImageOptimizationAdvice && isCanvasOptimizationTool(tool) && !canvasUserAsksVisualIdentification(latestUserMessage) {
		return true
	}
	if isCanvasOptimizationTool(tool) {
		return containsAnyText(latestUserMessage,
			"optimize", "optimization", "compress", "resize", "convert", "webp", "avif",
			"優化", "最佳化", "壓縮", "縮小", "調整尺寸", "轉檔", "轉成",
			"转换", "压缩", "优化",
		)
	}

	mutationIntent := containsAnyText(latestUserMessage,
		"add", "update", "set", "save", "write", "apply", "change", "edit", "create", "generate",
		"新增", "加入", "加上", "更新", "設定", "設成", "儲存", "寫入", "補充", "產生", "套用", "修改",
		"添加", "设置", "保存", "写入", "补充", "生成", "应用", "修改",
	)

	switch tool {
	case "update_tags", "batch_update_tags":
		return mutationIntent && containsAnyText(latestUserMessage, "tag", "tags", "標籤", "标签")
	case "update_description":
		return mutationIntent && containsAnyText(latestUserMessage, "description", "describe", "caption", "描述", "說明", "说明")
	case "update_ocr_text":
		return mutationIntent && containsAnyText(latestUserMessage, "ocr", "text", "文字", "文本")
	case "rename_asset":
		return containsAnyText(latestUserMessage, "rename", "重新命名", "改名", "重命名")
	case "move_asset":
		return containsAnyText(latestUserMessage, "move", "搬移", "移動", "移动")
	case "copy_asset":
		return containsAnyText(latestUserMessage, "copy", "duplicate", "複製", "复制")
	case "delete_asset":
		return containsAnyText(latestUserMessage, "delete", "remove", "刪除", "删除", "移除")
	case "favorite_asset", "batch_favorite_assets":
		return containsAnyText(latestUserMessage, "favorite", "favourite", "收藏")
	case "export_asset":
		return containsAnyText(latestUserMessage, "export", "download", "匯出", "导出", "下載", "下载")
	default:
		return false
	}
}

func selectedCanvasAssetIDs(canvas canvasSnapshot) []string {
	selected := make(map[string]bool, len(canvas.SelectedCardIDs))
	for _, id := range canvas.SelectedCardIDs {
		selected[id] = true
	}
	var ids []string
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !selected[card.ID] || card.Asset == nil || card.Asset.ID == "" {
			continue
		}
		if seen[card.Asset.ID] {
			continue
		}
		seen[card.Asset.ID] = true
		ids = append(ids, card.Asset.ID)
	}
	return ids
}

func selectedCanvasImageCardIDs(canvas canvasSnapshot) []string {
	selected := make(map[string]bool, len(canvas.SelectedCardIDs))
	for _, id := range canvas.SelectedCardIDs {
		selected[id] = true
	}
	var ids []string
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !selected[card.ID] || seen[card.ID] {
			continue
		}
		if card.Kind != "asset" && card.Kind != "upload" && card.Kind != "variant" {
			continue
		}
		seen[card.ID] = true
		ids = append(ids, card.ID)
	}
	return ids
}

func selectedCanvasOCRCardIDs(canvas canvasSnapshot) []string {
	selected := make(map[string]bool, len(canvas.SelectedCardIDs))
	for _, id := range canvas.SelectedCardIDs {
		selected[id] = true
	}
	var ids []string
	seen := map[string]bool{}
	for _, card := range canvas.Cards {
		if !selected[card.ID] || seen[card.ID] {
			continue
		}
		if card.Kind != "asset" && card.Kind != "upload" {
			continue
		}
		seen[card.ID] = true
		ids = append(ids, card.ID)
	}
	return ids
}

func canvasParamStringSlice(value any) []string {
	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	switch v := value.(type) {
	case []string:
		for _, id := range v {
			add(id)
		}
	case []any:
		for _, raw := range v {
			if id, ok := raw.(string); ok {
				add(id)
			}
		}
	case string:
		add(v)
	}
	return ids
}

func setCanvasActionCardIDs(act *canvasAction, ids []string) {
	if act.Params == nil {
		act.Params = map[string]any{}
	} else {
		next := make(map[string]any, len(act.Params)+1)
		for k, v := range act.Params {
			next[k] = v
		}
		act.Params = next
	}
	act.Params["cardIds"] = ids
	if len(ids) > 0 {
		act.Params["cardId"] = ids[0]
	}
}

func canvasActionCardIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	ids := canvasParamStringSlice(act.Params["cardIds"])
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if id, ok := act.Params["cardId"].(string); ok {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func canvasActionAssetIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	ids := canvasParamStringSlice(act.Params["assetIds"])
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if id, ok := act.Params["assetId"].(string); ok {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func setCanvasActionAssetIDs(act *canvasAction, ids []string) {
	if act.Params == nil {
		act.Params = map[string]any{}
	} else {
		next := make(map[string]any, len(act.Params)+1)
		for k, v := range act.Params {
			next[k] = v
		}
		act.Params = next
	}
	act.Params["assetIds"] = ids
	if len(ids) > 0 {
		act.Params["assetId"] = ids[0]
	}
}

func canvasToolTargetsCatalogAssets(tool string) bool {
	switch tool {
	case "add_assets_to_canvas",
		"extract_ocr_text",
		"compare_assets",
		"find_similar_assets",
		"inspect_image_quality",
		"generate_alt_text",
		"update_tags",
		"batch_update_tags",
		"update_description",
		"update_ocr_text",
		"compress_image",
		"resize_image",
		"convert_image",
		"move_asset",
		"copy_asset",
		"delete_asset",
		"favorite_asset",
		"batch_favorite_assets",
		"export_asset":
		return true
	default:
		return false
	}
}

func canvasToolCanUseSelectedAssetIDs(tool string) bool {
	switch canvasToolCardinality(tool) {
	case "multi", "pair", "batchOnly":
		return canvasToolTargetsCatalogAssets(tool)
	default:
		return false
	}
}

func canvasToolIsCapture(tool string) bool {
	switch tool {
	case "capture_viewport", "capture_canvas", "capture_selected":
		return true
	default:
		return false
	}
}

func canvasCaptureRequested(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"拍照", "拍一張", "拍一张", "拍張", "拍张",
		"截圖", "截图", "擷取", "截取",
		"匯出畫布", "导出画布", "輸出畫布", "输出画布", "匯出", "导出", "輸出", "输出", "下載", "下载",
		"capture", "screenshot", "photo", "picture", "export", "download",
	)
}

func fallbackCanvasCaptureAction(latestUserMessage string, canvas canvasSnapshot) canvasAction {
	tool := "capture_canvas"
	if containsAnyText(latestUserMessage, "可見", "目前畫面", "viewport", "visible") {
		tool = "capture_viewport"
	}
	if containsAnyText(latestUserMessage, "選取", "選中", "selected", "selection") && len(canvas.SelectedCardIDs) > 0 {
		tool = "capture_selected"
	}
	transparent := containsAnyText(latestUserMessage, "去背", "透明", "transparent", "no background", "without background")
	return canvasAction{
		Tool:        tool,
		Params:      map[string]any{"transparent": transparent},
		Description: "Capture the canvas",
		Impact:      "Shows the screenshot preview",
	}
}

func canvasCaptureRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The user's latest request asks for a screenshot/capture/export, but your previous response did not call a capture tool.
You DO have real frontend capture/export tools. Do not say the tool is unavailable.
Choose the correct capture tool yourself based on the request and canvas state:
- capture_viewport: visible viewport
- capture_canvas: entire canvas / full layout / exported canvas
- capture_selected: selected cards only
If the user asked for transparent/no-background/去背, set {"transparent": true}; otherwise false.

Latest user request: %q

Reply with exactly one action block and no prose. Use one of these exact forms:
`+"```"+`action
{"tool":"capture_canvas","params":{"transparent":true},"description":"Export the arranged canvas as a transparent image","impact":"Shows the screenshot preview"}
`+"```"+`
`+"```"+`action
{"tool":"capture_viewport","params":{"transparent":false},"description":"Capture the visible viewport","impact":"Shows the screenshot preview"}
`+"```"+`
`+"```"+`action
{"tool":"capture_selected","params":{"transparent":true},"description":"Capture the selected cards as a transparent image","impact":"Shows the screenshot preview"}
`+"```"+``, latestUserMessage)
}

func canvasImageTempFile(dataURI string) (string, func(), error) {
	if dataURI == "" {
		return "", func() {}, nil
	}
	_, encoded, ok := strings.Cut(dataURI, ";base64,")
	if !ok {
		return "", func() {}, fmt.Errorf("invalid canvas image data")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", func() {}, err
	}
	f, err := os.CreateTemp("", "aisets-ai-canvas-*.png")
	if err != nil {
		return "", func() {}, err
	}
	path := f.Name()
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return "", func() {}, err
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return "", func() {}, err
	}
	return path, func() { os.Remove(path) }, nil
}

func canvasUserLimitsToSingleAsset(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"only this", "only first", "first image", "single image",
		"只處理第一", "只处理第一", "只要第一", "只看第一", "第一張", "第一张",
		"只處理這張", "只处理这张", "只看這張", "只看这张", "這張", "这张",
	)
}

func expandCanvasMultiSelectedActions(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	selectedAssetIDs := selectedCanvasAssetIDs(canvas)
	selectedImageCardIDs := selectedCanvasImageCardIDs(canvas)
	selectedOCRCardIDs := selectedCanvasOCRCardIDs(canvas)
	limitToSingle := canvasUserLimitsToSingleAsset(latestUserMessage)

	toolCounts := map[string]int{}
	for _, act := range actions {
		if canvasToolCanUseSelectedAssetIDs(act.Tool) {
			toolCounts[act.Tool]++
		}
	}

	var expanded []canvasAction
	for _, act := range actions {
		if act.Tool == "extract_ocr_text" && len(canvasActionAssetIDs(act)) == 0 && len(canvasActionCardIDs(act)) == 0 && len(selectedOCRCardIDs) > 0 {
			clone := act
			cardIDs := selectedOCRCardIDs
			if limitToSingle {
				cardIDs = selectedOCRCardIDs[:1]
			}
			setCanvasActionCardIDs(&clone, cardIDs)
			expanded = append(expanded, clone)
			continue
		}
		if act.Tool == "duplicate_cards" && len(canvasActionCardIDs(act)) == 0 && len(selectedImageCardIDs) > 0 {
			clone := act
			cardIDs := selectedImageCardIDs
			if limitToSingle {
				cardIDs = selectedImageCardIDs[:1]
			}
			setCanvasActionCardIDs(&clone, cardIDs)
			expanded = append(expanded, clone)
			continue
		}
		targetAssetIDs := canvasActionAssetIDs(act)
		if !canvasToolCanUseSelectedAssetIDs(act.Tool) || toolCounts[act.Tool] != 1 || len(targetAssetIDs) > 1 || len(selectedAssetIDs) == 0 {
			expanded = append(expanded, act)
			continue
		}
		if limitToSingle {
			if len(targetAssetIDs) == 0 {
				clone := act
				setCanvasActionAssetIDs(&clone, selectedAssetIDs[:1])
				expanded = append(expanded, clone)
				continue
			}
			expanded = append(expanded, act)
			continue
		}
		if len(selectedAssetIDs) <= 1 && len(targetAssetIDs) > 0 {
			expanded = append(expanded, act)
			continue
		}
		clone := act
		setCanvasActionAssetIDs(&clone, selectedAssetIDs)
		expanded = append(expanded, clone)
	}
	return expanded
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
	req.Options.CanvasImageAttached = req.CanvasImage != ""
	req.Options.AutoLocale = settings.LLMAutoLocale
	req.Options.CanvasStrategy = s.canvasStrategyPrompt()
	systemPrompt := canvasSystemPrompt(locale, req.Options)
	userPrompt := buildCanvasUserPrompt(req.Messages, req.Canvas, req.Options, locale)

	var images []vlmImage
	if req.CanvasImage != "" {
		path, cleanup, err := canvasImageTempFile(req.CanvasImage)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_canvas_image"))
			return
		}
		defer cleanup()
		images = append(images, vlmImage{Path: path, Ext: ".png"})
	}
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
	for _, card := range req.Canvas.Cards {
		if len(images) >= 4 {
			break
		}
		if card.Kind != "upload" || card.UploadToken == "" {
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
		download, ok := s.peekImageToolDownload(card.UploadToken)
		if !ok {
			continue
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
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
	latestUserMessage := latestCanvasUserMessage(req.Messages)
	proposalIndex := 0
	captureRequested := canvasCaptureRequested(latestUserMessage)
	captureSeen := false
	var totalInputTokens, totalOutputTokens int64
	start := time.Now()

	const canvasOutputTokenLimit = 900
	for loop := 0; loop < maxToolLoops; loop++ {
		content, chatResp, err := s.chatVLMWithTools(r.Context(), images, backend, modelName, systemPrompt, currentPrompt, "canvas", canvasOutputTokenLimit, canvasLLMTools())
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
		if toolCallActions := canvasActionsFromToolCalls(chatResp.ToolCalls); len(toolCallActions) > 0 {
			actions = toolCallActions
			textBody = strings.TrimSpace(content)
		}
		truncatedAction := canvasActionBlockLikelyTruncated(content) && loop < maxToolLoops-1
		actions = expandCanvasMultiSelectedActions(actions, req.Canvas, latestUserMessage)
		hasCaptureAction := false
		for _, act := range actions {
			if canvasToolIsCapture(act.Tool) {
				hasCaptureAction = true
				break
			}
		}
		missingCapture := captureRequested && !captureSeen && !hasCaptureAction && loop < maxToolLoops-1

		var toolResults []string
		captureExecutedThisLoop := false
		nonFocusToolExecutedThisLoop := false
		blockedCommentNeedsAnswer := false
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
			if act.Tool == "create_comment" && !canvasUserAsksAnnotation(latestUserMessage) {
				blockedCommentNeedsAnswer = true
				continue
			}
			if canvasToolSafe(act.Tool) {
				if canvasToolIsCapture(act.Tool) {
					if captureSeen {
						continue
					}
					captureSeen = true
					captureExecutedThisLoop = true
				}
				result := s.executeCanvasSafeAction(r, act, settings, req.Canvas)
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if !canvasToolIsCapture(act.Tool) && act.Tool != "extract_ocr_text" {
					resultJSON, _ := json.Marshal(result)
					toolResults = append(toolResults, fmt.Sprintf("[Tool Result: %s]\n%s", act.Tool, string(resultJSON)))
				}
			} else {
				if !canvasProposalAllowed(act.Tool, latestUserMessage, req.Options) {
					continue
				}
				proposalIndex++
				targetAssetIDs := canvasActionAssetIDs(act)
				var targetAssetID any
				if len(targetAssetIDs) > 0 {
					targetAssetID = targetAssetIDs[0]
				}
				sendNDJSON(w, map[string]any{
					"type":           "proposal",
					"id":             fmt.Sprintf("p%d", proposalIndex),
					"tool":           act.Tool,
					"params":         act.Params,
					"description":    act.Description,
					"impact":         act.Impact,
					"targetAssetId":  targetAssetID,
					"targetAssetIds": targetAssetIDs,
				})
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
			}
			time.Sleep(150 * time.Millisecond)
		}

		if textBody != "" && !truncatedAction && !nonFocusToolExecutedThisLoop {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(w, map[string]any{"type": "text", "content": p})
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		if captureExecutedThisLoop && !truncatedAction {
			break
		}
		focusOnlyNeedsAnswer := canvasActionsOnlyFocus(actions) && textBody == "" && loop < maxToolLoops-1
		if len(toolResults) == 0 && !missingCapture && !truncatedAction && !focusOnlyNeedsAnswer && !blockedCommentNeedsAnswer {
			break
		}
		images = nil
		currentPrompt = currentPrompt + "\n\nassistant: " + content
		if len(toolResults) > 0 {
			currentPrompt += "\n\n## Tool Results\n" + strings.Join(toolResults, "\n\n")
		}
		if truncatedAction {
			currentPrompt += "\n\n## Required Follow-up\nYour previous action block was truncated before the JSON finished. Reply with ONLY complete action blocks in ```action fences. Do not include explanatory prose. If arranging many cards, include all positions in one compact arrange_cards JSON object."
		} else if missingCapture {
			currentPrompt += "\n\n## Required Follow-up\n" + canvasCaptureRepairPrompt(latestUserMessage)
		} else if focusOnlyNeedsAnswer {
			currentPrompt += "\n\n## Required Follow-up\nYour previous response only moved the cursor with focus_card and did not answer the user's request. Do NOT call focus_card again. Now answer the user's latest question in prose, or use a non-focus tool if more data is required."
		} else if blockedCommentNeedsAnswer {
			currentPrompt += "\n\n## Required Follow-up\nYour previous response tried to create a comment, but the user did not ask for an annotation. Do NOT call create_comment. Answer the user's latest question in chat prose, and only mention uncertainty or next steps if needed."
		} else {
			currentPrompt += "\n\nContinue acting on these results. Use the data above to fulfill the user's original request. Remember: EVERY response must include at least one action block."
		}
		sendNDJSON(w, map[string]any{"type": "thinking"})
	}

	if captureRequested && !captureSeen {
		act := fallbackCanvasCaptureAction(latestUserMessage, req.Canvas)
		result := s.executeCanvasSafeAction(r, act, settings, req.Canvas)
		sendNDJSON(w, map[string]any{
			"type":   "action_result",
			"tool":   act.Tool,
			"result": result,
		})
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

func (s *Server) enrichCanvasCatalogItems(ctx context.Context, scanID int64, items []scanner.AssetItem, settings config.AppSettings) ([]scanner.AssetItem, error) {
	catalog := scanner.Catalog{Items: items}
	var err error
	catalog, err = s.enrichCatalogOCR(ctx, catalog)
	if err != nil {
		return nil, err
	}
	catalog, err = s.enrichCatalogAITag(catalog, settings)
	if err != nil {
		return nil, err
	}
	catalog, err = s.enrichCatalogEXIF(catalog, scanID)
	if err != nil {
		return nil, err
	}
	return catalog.Items, nil
}

func (s *Server) fetchCanvasCatalogItemsByIDs(ctx context.Context, scanID int64, assetIDs []string, settings config.AppSettings) ([]scanner.AssetItem, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	items, err := s.store.CatalogItemsByIDs(scanID, assetIDs)
	if err != nil {
		return nil, err
	}
	return s.enrichCanvasCatalogItems(ctx, scanID, items, settings)
}

func canvasAssetSummary(item scanner.AssetItem) map[string]any {
	summary := map[string]any{
		"id":             item.ID,
		"repoPath":       item.RepoPath,
		"projectId":      item.ProjectID,
		"projectName":    item.ProjectName,
		"ext":            item.Ext,
		"bytes":          item.Bytes,
		"width":          item.Image.Width,
		"height":         item.Image.Height,
		"animated":       item.Image.Animated,
		"alpha":          item.Image.Alpha,
		"usedByCount":    len(item.UsedBy),
		"favorite":       item.Favorite,
		"duplicates":     item.Duplicates,
		"similar":        item.Similar,
		"optimization":   item.Optimization,
		"duplicateGroup": item.DuplicateGroupID,
	}
	if item.AITag != nil {
		summary["tags"] = item.AITag.Tags
		summary["description"] = item.AITag.Description
		summary["category"] = item.AITag.Category
	}
	if item.OCR != nil {
		summary["ocrStatus"] = item.OCR.Status
		summary["ocrText"] = item.OCR.Text
	}
	return summary
}

func canvasPerAssetTextParam(params map[string]any, assetID string, field string, perAssetField string) string {
	if params == nil {
		return ""
	}
	if rows, ok := params[perAssetField].([]any); ok {
		for _, raw := range rows {
			row, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			id, _ := row["assetId"].(string)
			value, _ := row[field].(string)
			if id == assetID {
				return value
			}
		}
	}
	value, _ := params[field].(string)
	return value
}

func (s *Server) executeCanvasSafeAction(r *http.Request, act canvasAction, settings config.AppSettings, canvas canvasSnapshot) any {
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
		var page config.CatalogItemsPage
		var err error
		for _, candidate := range canvasSearchQueryCandidates(q) {
			query := config.CatalogItemQuery{
				ScanID: scanID,
				Query:  candidate,
				Limit:  limit,
			}
			page, err = s.store.CatalogItems(query)
			if err != nil {
				return map[string]any{"items": []any{}, "error": err.Error()}
			}
			if page.Total > 0 {
				q = candidate
				break
			}
		}
		items, err := s.enrichCanvasCatalogItems(r.Context(), scanID, page.Items, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		return map[string]any{"items": items, "total": page.Total, "q": q}
	case "add_assets_to_canvas":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		return map[string]any{"items": items, "count": len(items), "assetIds": assetIDs, "label": act.Params["label"]}
	case "extract_ocr_text":
		return s.executeCanvasOCRText(r, act, settings, canvas)
	case "create_comment":
		return map[string]any{
			"anchorCardId": act.Params["anchorCardId"],
			"text":         act.Params["text"],
			"region":       act.Params["region"],
		}
	case "update_comment":
		return map[string]any{
			"commentCardId": act.Params["commentCardId"],
			"text":          act.Params["text"],
		}
	case "delete_comment":
		return map[string]any{
			"commentCardId": act.Params["commentCardId"],
		}
	case "select_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
			"label":   act.Params["label"],
		}
	case "remove_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
			"label":   act.Params["label"],
		}
	case "duplicate_cards":
		sourceCardIDs := canvasActionCardIDs(act)
		count := 1
		if l, ok := act.Params["count"].(float64); ok && l > 0 {
			count = int(l)
		}
		count = min(max(count, 1), 12)
		type cardCopy struct {
			SourceCardID string `json:"sourceCardId"`
			CardID       string `json:"cardId"`
		}
		copies := make([]cardCopy, 0, len(sourceCardIDs)*count)
		now := time.Now().UnixNano()
		for sourceIndex, sourceCardID := range sourceCardIDs {
			for copyIndex := 0; copyIndex < count; copyIndex++ {
				copies = append(copies, cardCopy{
					SourceCardID: sourceCardID,
					CardID:       fmt.Sprintf("dup-%x-%d-%d", now, sourceIndex, copyIndex),
				})
			}
		}
		cardIDs := make([]string, 0, len(copies))
		for _, copy := range copies {
			cardIDs = append(cardIDs, copy.CardID)
		}
		return map[string]any{
			"cardIds":    sourceCardIDs,
			"count":      count,
			"copies":     copies,
			"newCardIds": cardIDs,
			"layout":     act.Params["layout"],
			"label":      act.Params["label"],
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
	case "align_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
			"axis":    act.Params["axis"],
			"label":   act.Params["label"],
		}
	case "distribute_cards":
		return map[string]any{
			"cardIds":   act.Params["cardIds"],
			"direction": act.Params["direction"],
			"gap":       act.Params["gap"],
			"label":     act.Params["label"],
		}
	case "resize_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
			"width":  act.Params["width"],
		}
	case "bring_cards_to_front":
		return map[string]any{
			"cardIds":     act.Params["cardIds"],
			"afterCardId": act.Params["afterCardId"],
			"label":       act.Params["label"],
		}
	case "inspect_canvas":
		return map[string]any{
			"imageAttached": true,
			"reason":        act.Params["reason"],
		}
	case "capture_viewport", "capture_canvas", "capture_selected":
		return map[string]any{
			"transparent": act.Params["transparent"],
		}
	case "compare_assets":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		for _, item := range items {
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "count": len(summaries)}
	case "find_similar_assets":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"sources": []any{}, "items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"sources": []any{}, "items": []any{}, "error": err.Error()}
		}
		relatedSet := map[string]bool{}
		sources := make([]map[string]any, 0, len(items))
		for _, item := range items {
			for _, id := range item.Duplicates {
				relatedSet[id] = true
			}
			for _, id := range item.Similar {
				relatedSet[id] = true
			}
			sources = append(sources, map[string]any{
				"id":         item.ID,
				"repoPath":   item.RepoPath,
				"duplicates": item.Duplicates,
				"similar":    item.Similar,
			})
		}
		relatedIDs := make([]string, 0, len(relatedSet))
		for id := range relatedSet {
			relatedIDs = append(relatedIDs, id)
		}
		sort.Strings(relatedIDs)
		if l, ok := act.Params["limit"].(float64); ok && l > 0 && int(l) < len(relatedIDs) {
			relatedIDs = relatedIDs[:int(l)]
		}
		related, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, relatedIDs, settings)
		if err != nil {
			return map[string]any{"sources": sources, "items": []any{}, "error": err.Error()}
		}
		return map[string]any{"sources": sources, "items": related, "count": len(related)}
	case "inspect_image_quality":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		grouped := map[string]int{}
		for _, item := range items {
			for _, rec := range item.Optimization {
				grouped[rec.Category]++
			}
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "groups": grouped, "count": len(summaries)}
	case "generate_alt_text":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		for _, item := range items {
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "style": act.Params["style"], "instruction": "Generate one alt text candidate per asset from the metadata and visible image context available in the canvas."}
	default:
		return map[string]any{"error": "unknown safe tool: " + act.Tool}
	}
}

func (s *Server) executeCanvasOCRText(r *http.Request, act canvasAction, settings config.AppSettings, canvas canvasSnapshot) any {
	if !s.hasVLMBackend(settings) {
		return map[string]any{"items": []any{}, "error": "AI provider or agent adapter not configured"}
	}
	const maxCanvasOCRAssets = 12

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureOCR)
	engineVersion := providerName + "/" + modelName
	settingsHash := vlmOCRSettingsHash(modelName)
	prompt := buildVLMOCRPrompt(settings.LLMOcrPrompt, settings.LLMAutoLocale, r.URL.Query().Get("lang"))
	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)
	timeoutSec := settings.LLMTimeout
	saveRequested, _ := act.Params["saveToMetadata"].(bool)

	type itemResult struct {
		AssetID      string   `json:"assetId"`
		RepoPath     string   `json:"repoPath"`
		CardID       string   `json:"cardId,omitempty"`
		FileName     string   `json:"fileName,omitempty"`
		Source       string   `json:"source,omitempty"`
		Status       string   `json:"status"`
		Text         string   `json:"text,omitempty"`
		Languages    []string `json:"languages,omitempty"`
		ErrorMessage string   `json:"errorMessage,omitempty"`
		CacheHit     bool     `json:"cacheHit,omitempty"`
	}

	type ocrTarget struct {
		item     scanner.AssetItem
		assetID  string
		cardID   string
		repoPath string
		fileName string
		source   string
	}

	var targets []ocrTarget
	var results []itemResult
	assetIDs := canvasActionAssetIDs(act)
	assetCardIDs := map[string]string{}
	seenAssets := map[string]bool{}
	addAssetID := func(assetID, cardID string) {
		assetID = strings.TrimSpace(assetID)
		if assetID == "" || seenAssets[assetID] {
			return
		}
		seenAssets[assetID] = true
		assetIDs = append(assetIDs, assetID)
		if cardID != "" {
			assetCardIDs[assetID] = cardID
		}
	}

	for _, assetID := range assetIDs {
		seenAssets[assetID] = true
	}

	cardsByID := make(map[string]canvasCardSnapshot, len(canvas.Cards))
	for _, card := range canvas.Cards {
		cardsByID[card.ID] = card
	}
	seenUploadCards := map[string]bool{}
	for _, cardID := range canvasActionCardIDs(act) {
		card, ok := cardsByID[cardID]
		if !ok {
			results = append(results, itemResult{CardID: cardID, Source: "canvas", Status: ocr.StatusFailed, ErrorMessage: "canvas card not found"})
			continue
		}
		switch card.Kind {
		case "asset":
			if card.Asset == nil || card.Asset.ID == "" {
				results = append(results, itemResult{CardID: cardID, Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "canvas asset card has no asset id"})
				continue
			}
			addAssetID(card.Asset.ID, card.ID)
		case "upload":
			if seenUploadCards[card.ID] {
				continue
			}
			seenUploadCards[card.ID] = true
			if card.UploadToken == "" {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "upload token missing; re-upload this image to run OCR"})
				continue
			}
			download, ok := s.peekImageToolDownload(card.UploadToken)
			if !ok {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "uploaded image is no longer available; re-upload this image to run OCR"})
				continue
			}
			info, err := os.Stat(download.Path)
			if err != nil {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "uploaded image file is missing; re-upload this image to run OCR"})
				continue
			}
			ext := strings.ToLower(filepath.Ext(card.UploadFileName))
			if ext == "" {
				ext = strings.ToLower(filepath.Ext(download.Path))
			}
			item := scanner.AssetItem{
				ID:          "upload:" + card.ID,
				ProjectID:   "canvas-upload",
				ProjectName: "Canvas Upload",
				RepoPath:    card.UploadFileName,
				LocalPath:   download.Path,
				Ext:         ext,
				Bytes:       info.Size(),
				Image: imageproc.Metadata{
					Format: strings.TrimPrefix(ext, "."),
					Width:  card.UploadWidth,
					Height: card.UploadHeight,
				},
			}
			targets = append(targets, ocrTarget{
				item:     item,
				cardID:   card.ID,
				repoPath: card.UploadFileName,
				fileName: card.UploadFileName,
				source:   "upload",
			})
		default:
			results = append(results, itemResult{CardID: card.ID, Source: card.Kind, Status: ocr.StatusSkipped, ErrorMessage: "card is not an OCR image target"})
		}
	}

	if len(assetIDs) > 0 {
		if len(assetIDs) > maxCanvasOCRAssets {
			assetIDs = assetIDs[:maxCanvasOCRAssets]
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available for catalog OCR targets"}
		}
		items, err := s.store.CatalogItemsByIDs(scanID, assetIDs)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		foundAssetIDs := make(map[string]bool, len(items))
		for _, item := range items {
			foundAssetIDs[item.ID] = true
			if item.LocalPath == "" {
				results = append(results, itemResult{AssetID: item.ID, RepoPath: item.RepoPath, CardID: assetCardIDs[item.ID], FileName: filepath.Base(item.RepoPath), Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "project asset has no local path; rescan the project"})
				continue
			}
			if _, err := os.Stat(item.LocalPath); err != nil {
				results = append(results, itemResult{AssetID: item.ID, RepoPath: item.RepoPath, CardID: assetCardIDs[item.ID], FileName: filepath.Base(item.RepoPath), Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "original project file is missing; rescan the project or remove this canvas card"})
				continue
			}
			targets = append(targets, ocrTarget{
				item:     item,
				assetID:  item.ID,
				cardID:   assetCardIDs[item.ID],
				repoPath: item.RepoPath,
				fileName: filepath.Base(item.RepoPath),
				source:   "catalog",
			})
		}
		for _, assetID := range assetIDs {
			if !foundAssetIDs[assetID] {
				results = append(results, itemResult{AssetID: assetID, CardID: assetCardIDs[assetID], Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "catalog asset is no longer available; rescan the project or remove this canvas card"})
			}
		}
	}

	if len(targets) == 0 && len(results) == 0 {
		return map[string]any{"items": []any{}, "error": "no assetIds or upload cardIds provided"}
	}
	if len(targets) > maxCanvasOCRAssets {
		targets = targets[:maxCanvasOCRAssets]
	}

	counts := vlmOcrCounts{Queued: len(targets) + len(results)}
	for _, result := range results {
		switch result.Status {
		case ocr.StatusSkipped:
			counts.Skipped++
		default:
			counts.Failed++
		}
	}
	for _, target := range targets {
		item := target.item
		entry := itemResult{AssetID: target.assetID, RepoPath: target.repoPath, CardID: target.cardID, FileName: target.fileName, Source: target.source}
		if !eligibleForVLMOCR(item) {
			entry.Status = ocr.StatusSkipped
			entry.ErrorMessage = "asset is not eligible for VLM OCR"
			counts.Skipped++
			results = append(results, entry)
			continue
		}
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			sum, algorithm, herr := scanner.ContentHash(r.Context(), item.LocalPath)
			if herr != nil {
				entry.Status = ocr.StatusFailed
				entry.ErrorMessage = herr.Error()
				counts.Failed++
				results = append(results, entry)
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
		}

		var result ocr.Result
		if cached, found, cerr := s.store.VLMOCRResultForContentHash(item.ContentHash, item.HashAlgorithm, engineVersion, settingsHash); cerr != nil {
			entry.Status = ocr.StatusFailed
			entry.ErrorMessage = cerr.Error()
			counts.Failed++
			results = append(results, entry)
			continue
		} else if found && cached.Status == ocr.StatusReady {
			result = copyOCRResultForVLMItem(cached, item)
			entry.CacheHit = true
			counts.CacheHit++
		} else {
			processed, chatResp := s.processVLMOCR(r.Context(), item, backend, providerName, modelName, systemPrompt, prompt, timeoutSec)
			result = processed
			counts.InputTokens += chatResp.InputTokens
			counts.OutputTokens += chatResp.OutputTokens
		}

		entry.Status = result.Status
		entry.Text = result.Text
		entry.Languages = result.Languages
		entry.ErrorMessage = canvasOCRDisplayError(result.ErrorMessage)
		counts.Processed++
		if result.Status == ocr.StatusReady {
			counts.Ready++
		} else {
			counts.Failed++
		}
		results = append(results, entry)
	}

	return map[string]any{
		"items":                   results,
		"counts":                  counts,
		"providerName":            providerName,
		"modelName":               modelName,
		"mode":                    vlmOCRMode,
		"saveToMetadataRequested": saveRequested,
		"saveToMetadata":          false,
		"saveInstruction":         "Use update_ocr_text proposal to save OCR text into metadata.",
	}
}

func canvasOCRDisplayError(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}
	if idx := strings.Index(message, "{"); idx >= 0 {
		var payload struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(message[idx:]), &payload); err == nil {
			if text := strings.TrimSpace(payload.Error.Message); text != "" {
				return text
			}
		}
	}
	return message
}

func (s *Server) latestScanID() int64 {
	scan, err := s.store.LatestScan()
	if err != nil {
		return 0
	}
	return scan.ID
}

func (s *Server) canvasStrategyPrompt() string {
	presets, err := s.store.ListPromptPresets("canvas")
	if err != nil {
		return config.DefaultCanvasPrompt()
	}
	for _, preset := range presets {
		if preset.IsDefault {
			return config.FormatPrompt(preset.Content)
		}
	}
	if len(presets) > 0 {
		return config.FormatPrompt(presets[0].Content)
	}
	return config.DefaultCanvasPrompt()
}

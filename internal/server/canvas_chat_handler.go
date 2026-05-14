package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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
	ID                    string              `json:"id"`
	RepoPath              string              `json:"repoPath"`
	Ext                   string              `json:"ext"`
	Width                 int                 `json:"width"`
	Height                int                 `json:"height"`
	Bytes                 int64               `json:"bytes"`
	Tags                  []string            `json:"tags,omitempty"`
	Description           string              `json:"description,omitempty"`
	OcrText               string              `json:"ocrText,omitempty"`
	UsedByCount           int                 `json:"usedByCount"`
	SearchCategory        string              `json:"searchCategory,omitempty"`
	SearchTags            []string            `json:"searchTags,omitempty"`
	SearchDescription     string              `json:"searchDescription,omitempty"`
	SearchCategoryI18n    map[string]string   `json:"searchCategoryI18n,omitempty"`
	SearchTagsI18n        map[string][]string `json:"searchTagsI18n,omitempty"`
	SearchDescriptionI18n map[string]string   `json:"searchDescriptionI18n,omitempty"`
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
	Messages         []canvasChatMessage `json:"messages"`
	Canvas           canvasSnapshot      `json:"canvas"`
	Locale           string              `json:"locale"`
	Options          canvasChatOptions   `json:"options"`
	CanvasImage      string              `json:"canvasImage,omitempty"`
	AttachmentTokens []string            `json:"attachmentTokens,omitempty"`
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
var fallbackActionHeaderRe = regexp.MustCompile(`(?mi)^\s*(?:\[action:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]|action:\s*([A-Za-z_][A-Za-z0-9_]*)\s*)$`)
var fallbackActionCoordinateRe = regexp.MustCompile(`(?i)\bx\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*y\s*=\s*(-?\d+(?:\.\d+)?)`)

var toolCallCleanRe = regexp.MustCompile(`(?s)<\|?/?tool_call\|?>`)
var unquotedJSONKeyRe = regexp.MustCompile(`([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:`)
var hanTextRe = regexp.MustCompile(`\p{Han}`)
var kanaTextRe = regexp.MustCompile(`[ぁ-ゟ゠-ヿ]`)
var hangulTextRe = regexp.MustCompile(`[가-힣]`)
var filenameTokenRe = regexp.MustCompile(`(?i)([A-Za-z0-9][A-Za-z0-9_-]*)\.(png|jpe?g|webp|gif|svg|avif|heic)`)
var assetStemTokenRe = regexp.MustCompile(`[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+`)
var markdownImagePathRe = regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)
var absoluteImagePathRe = regexp.MustCompile("(?i)(^|[\\s('\"`<])((?:file://)?/[^\\s'\"<>)]*\\.(?:png|jpe?g|webp|gif|svg|avif|heic|heif))")

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

func findFallbackHeaderCanvasActionSpans(content string) []canvasActionSpan {
	matches := fallbackActionHeaderRe.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return nil
	}
	var spans []canvasActionSpan
	for i, loc := range matches {
		tool := fallbackActionHeaderToolName(content, loc)
		tool = canonicalFallbackCanvasToolName(tool)
		if tool == "" || canvasToolCardinality(tool) == "" {
			continue
		}
		bodyStart := loc[1]
		bodyLimit := len(content)
		if i+1 < len(matches) {
			bodyLimit = matches[i+1][0]
		}
		bodyEnd, act, ok := parseBracketCanvasAction(content, bodyStart, bodyLimit, tool)
		if !ok {
			continue
		}
		spans = append(spans, canvasActionSpan{
			start:   loc[0],
			end:     bodyEnd,
			actions: []canvasAction{act},
		})
	}
	return spans
}

func fallbackActionHeaderToolName(content string, loc []int) string {
	for i := 2; i+1 < len(loc); i += 2 {
		if loc[i] >= 0 && loc[i+1] >= loc[i] {
			return strings.TrimSpace(content[loc[i]:loc[i+1]])
		}
	}
	return ""
}

func canonicalFallbackCanvasToolName(tool string) string {
	switch strings.ToLower(strings.TrimSpace(tool)) {
	case "move_cards":
		return "arrange_cards"
	default:
		return strings.TrimSpace(tool)
	}
}

func parseBracketCanvasAction(content string, start, limit int, tool string) (int, canvasAction, bool) {
	act := canvasAction{Tool: tool, Params: map[string]any{}}
	listKey := ""
	var listItems []map[string]any
	var currentItem map[string]any
	parseEnd := start
	pos := start
	for pos < limit {
		lineStart := pos
		lineEnd := pos
		for lineEnd < limit && content[lineEnd] != '\n' && content[lineEnd] != '\r' {
			lineEnd++
		}
		next := lineEnd
		for next < limit && (content[next] == '\n' || content[next] == '\r') {
			next++
		}
		line := content[lineStart:lineEnd]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			pos = next
			continue
		}

		if key, value, ok := parseBracketCanvasActionBullet(trimmed); ok && listKey != "" {
			currentItem = map[string]any{key: parseBracketCanvasScalar(value)}
			listItems = append(listItems, currentItem)
			parseEnd = next
			pos = next
			continue
		}

		if listKey != "" && currentItem != nil && bracketCanvasLineIsIndented(line) {
			if key, value, ok := parseBracketCanvasActionPair(trimmed); ok {
				currentItem[key] = parseBracketCanvasScalar(value)
				parseEnd = next
				pos = next
				continue
			}
		}

		if listKey != "" {
			act.Params[listKey] = bracketCanvasActionListValue(listItems)
			listKey = ""
			listItems = nil
			currentItem = nil
		}

		key, value, ok := parseBracketCanvasActionPair(trimmed)
		if !ok {
			break
		}
		switch key {
		case "description":
			act.Description = strings.TrimSpace(fmt.Sprint(parseBracketCanvasScalar(value)))
		case "impact":
			act.Impact = strings.TrimSpace(fmt.Sprint(parseBracketCanvasScalar(value)))
		default:
			if strings.TrimSpace(value) == "" {
				listKey = key
				listItems = []map[string]any{}
				currentItem = nil
			} else {
				act.Params[key] = parseBracketCanvasScalar(value)
			}
		}
		parseEnd = next
		pos = next
	}
	if listKey != "" {
		act.Params[listKey] = bracketCanvasActionListValue(listItems)
	}
	if parseEnd <= start {
		return start, canvasAction{}, false
	}
	normalizeBracketCanvasActionParams(&act)
	return parseEnd, act, true
}

func parseBracketCanvasActionBullet(trimmed string) (string, string, bool) {
	for _, prefix := range []string{"•", "-", "*"} {
		if strings.HasPrefix(trimmed, prefix) {
			return parseBracketCanvasActionPair(strings.TrimSpace(strings.TrimPrefix(trimmed, prefix)))
		}
	}
	return "", "", false
}

func parseBracketCanvasActionPair(trimmed string) (string, string, bool) {
	colon := strings.Index(trimmed, ":")
	if colon <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(trimmed[:colon])
	if key == "" {
		return "", "", false
	}
	for i := 0; i < len(key); i++ {
		ch := key[i]
		if !isCanvasCallIdentChar(ch) {
			return "", "", false
		}
	}
	return key, strings.TrimSpace(trimmed[colon+1:]), true
}

func parseBracketCanvasScalar(value string) any {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '`' && value[len(value)-1] == '`') {
			return strings.TrimSpace(value[1 : len(value)-1])
		}
	}
	switch strings.ToLower(value) {
	case "true":
		return true
	case "false":
		return false
	}
	if n, err := strconv.ParseFloat(value, 64); err == nil {
		return n
	}
	return value
}

func splitBracketCanvasStringList(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	case string:
		parts := strings.Split(v, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			text := strings.TrimSpace(part)
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func parseFallbackActionCoordinatePairs(text string) [][2]float64 {
	matches := fallbackActionCoordinateRe.FindAllStringSubmatch(text, -1)
	out := make([][2]float64, 0, len(matches))
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		x, errX := strconv.ParseFloat(match[1], 64)
		y, errY := strconv.ParseFloat(match[2], 64)
		if errX != nil || errY != nil {
			continue
		}
		out = append(out, [2]float64{x, y})
	}
	return out
}

func bracketCanvasLineIsIndented(line string) bool {
	return len(line) > 0 && (line[0] == ' ' || line[0] == '\t')
}

func bracketCanvasActionListValue(items []map[string]any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func normalizeBracketCanvasActionParams(act *canvasAction) {
	if act.Tool != "arrange_cards" {
		return
	}
	if _, exists := act.Params["positions"]; exists {
		return
	}
	if cards, exists := act.Params["cards"]; exists {
		act.Params["positions"] = cards
		delete(act.Params, "cards")
		return
	}
	cardIDs := splitBracketCanvasStringList(act.Params["cardIds"])
	if len(cardIDs) == 0 {
		return
	}
	coords := parseFallbackActionCoordinatePairs(act.Impact)
	if len(coords) == 0 {
		coords = parseFallbackActionCoordinatePairs(act.Description)
	}
	if len(coords) != len(cardIDs) {
		return
	}
	positions := make([]any, 0, len(cardIDs))
	for i, cardID := range cardIDs {
		positions = append(positions, map[string]any{
			"cardId": cardID,
			"x":      coords[i][0],
			"y":      coords[i][1],
		})
	}
	act.Params["positions"] = positions
	delete(act.Params, "cardIds")
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
	bracketActionSpans := findFallbackHeaderCanvasActionSpans(content)

	if len(matches) == 0 && len(jsonMatches) == 0 && len(toolMatches) == 0 && len(plainCallSpans) == 0 && len(looseQuotedCallSpans) == 0 && len(bareCallSpans) == 0 && len(bracketActionSpans) == 0 {
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
	spans = append(spans, bracketActionSpans...)
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

func canvasActionsOnlyPreparatory(actions []canvasAction) bool {
	if len(actions) == 0 {
		return false
	}
	for _, act := range actions {
		if !canvasToolIsPreparatoryForCanvasWork(act.Tool) {
			return false
		}
	}
	return true
}

func canvasToolIsPreparatoryForCanvasWork(tool string) bool {
	switch tool {
	case "focus_card", "select_cards", "inspect_canvas":
		return true
	default:
		return false
	}
}

func canvasToolIsConcreteCanvasWork(tool string) bool {
	if canvasToolIsPreparatoryForCanvasWork(tool) {
		return false
	}
	switch tool {
	case "search_assets", "add_assets_to_canvas", "get_asset_detail", "extract_ocr_text",
		"compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text",
		"capture_viewport", "capture_canvas", "capture_selected":
		return false
	default:
		return canvasToolCardinality(tool) != ""
	}
}

func canvasActionStatusMessage(act canvasAction) string {
	switch act.Tool {
	case "focus_card":
		if label := strings.TrimSpace(fmt.Sprint(act.Params["label"])); label != "" {
			return "Confirming target: " + label
		}
		if cardID := strings.TrimSpace(fmt.Sprint(act.Params["cardId"])); cardID != "" {
			return "Confirming target card: " + cardID
		}
		return "Confirming the target card."
	case "select_cards":
		return "Confirming the target selection before applying canvas changes."
	case "inspect_canvas":
		return "Inspecting the canvas before deciding the final placement."
	case "resize_card":
		return "Applying visual resize on the canvas."
	case "move_card", "arrange_cards":
		return "Applying the planned canvas placement."
	case "align_cards", "distribute_cards", "bring_cards_to_front":
		return "Applying the planned layout adjustment."
	default:
		if !canvasToolSafe(act.Tool) {
			return "Preparing confirmation proposal: " + act.Tool
		}
		if canvasToolIsConcreteCanvasWork(act.Tool) {
			return "Applying canvas operation: " + act.Tool
		}
		return ""
	}
}

func canvasPlannedToolNames(latestUserMessage string) []string {
	var names []string
	add := func(name string) {
		for _, existing := range names {
			if existing == name {
				return
			}
		}
		names = append(names, name)
	}
	if containsAnyText(latestUserMessage, "放大", "縮小", "缩小", "resize", "bigger", "larger", "smaller") {
		add("resize_card")
	}
	if containsAnyText(latestUserMessage, "移動", "移动", "放到", "移到", "move", "position") {
		add("move_card")
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "排列", "整理", "排版", "arrange", "layout") {
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "對齊", "对齐", "align") {
		add("align_cards")
	}
	if len(names) == 0 && canvasUserWantsCanvasAction(latestUserMessage) {
		add("arrange_cards")
	}
	return names
}

func canvasFollowupStatusMessage(reason string, latestUserMessage string, preparatoryActionLoops int) string {
	planned := canvasPlannedToolNames(latestUserMessage)
	plannedText := strings.Join(planned, " / ")
	switch reason {
	case canvasLoopReasonFocusOnlyNeedsAnswer:
		if plannedText != "" {
			if preparatoryActionLoops > 1 {
				return "Target checks are done; next I will move from confirmation to operation tools: " + plannedText + "."
			}
			return "Target confirmed; next I am preparing the operation tools: " + plannedText + "."
		}
		return "Target confirmed; deciding the next canvas operation."
	case canvasLoopReasonToolResults:
		if plannedText != "" {
			return "Confirmation result received; continuing toward: " + plannedText + "."
		}
		return "Confirmation result received; deciding whether another canvas operation is needed."
	case canvasLoopReasonTextOnlyDeferredWork:
		if plannedText != "" {
			return "Converting the described plan into executable tools: " + plannedText + "."
		}
		return "Converting the described plan into executable canvas tools."
	case canvasLoopReasonCaptureOnlyWork:
		return "Capture is complete; continuing with the requested canvas edit."
	default:
		return ""
	}
}

func canvasTextOnlyResponseNeedsActionRepair(textBody string, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 || nonFocusToolExecuted || strings.TrimSpace(textBody) == "" {
		return false
	}
	return canvasTextLooksLikeDeferredWork(textBody)
}

func canvasTextLooksLikeDeferredWork(text string) bool {
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return false
	}

	futureMarkers := []string{
		"i will", "i'll", "i can", "i would", "i'm going to", "let me", "next, i", "here is the plan", "suggested",
		"我會", "我会", "我將", "我将", "我可以", "可以幫", "可以帮", "接下來", "接下来", "現在我將", "现在我将", "以下是", "建議", "建议",
	}
	hasFutureMarker := false
	for _, marker := range futureMarkers {
		if strings.Contains(text, marker) {
			hasFutureMarker = true
			break
		}
	}
	if !hasFutureMarker {
		return false
	}

	if containsAnyText(text,
		"imagegen", "image gen", "image generation", "generate image", "generated image",
		"use the image", "use imagegen", "built-in", "skill", "tool",
		"產出", "产出", "生成", "產生", "产生", "技能", "工具", "處理", "处理", "再產", "再产", "再做",
	) {
		return true
	}

	lineCount := 0
	listLikeLines := 0
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lineCount++
		if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") || strings.HasPrefix(line, "• ") ||
			(len(line) >= 2 && line[0] >= '1' && line[0] <= '9' && line[1] == '.') ||
			(len(line) >= len("1、") && line[0] >= '1' && line[0] <= '9' && strings.HasPrefix(line[1:], "、")) {
			listLikeLines++
		}
	}
	if listLikeLines > 0 {
		return true
	}
	return lineCount >= 3
}

func canvasActionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous response described intended canvas work without producing an executable non-focus action.
Do not continue explaining the plan. Convert the described work into the closest available canvas tool actions now.
Use native tool calls if available; otherwise use action blocks.

Required behavior:
- Use canvas layout tools for visual board changes.
- Use proposal tools for source-file or metadata changes.
- Use capture tools for screenshot/export work.
- If this is running inside Codex CLI and the work truly requires its built-in imagegen capability, use that capability now in this same response and return a concrete generated result. Do not merely say you will use imagegen later.
- If the work needs multiple steps, start with the first concrete tool action and continue after tool results.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasUserWantsCanvasAction(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"安排", "排版", "分鏡", "分镜", "對戰", "对战", "戰鬥", "战斗", "操控",
		"移動", "移动", "放到", "擺", "摆", "排列", "整理", "複製", "复制",
		"鏡像", "镜像", "反轉", "反转", "翻轉", "翻转", "靚相",
		"旋轉", "旋转", "轉", "转", "放大", "縮小", "缩小", "截圖", "截图", "匯出", "导出",
		"arrange", "layout", "storyboard", "battle", "fight", "move", "position",
		"duplicate", "copy", "mirror", "flip", "rotate", "resize", "bigger", "larger", "smaller", "capture", "export",
	)
}

func canvasFocusOnlyRepairPrompt(latestUserMessage string) string {
	if canvasUserWantsCanvasAction(latestUserMessage) {
		return fmt.Sprintf(`Your previous response only moved the cursor with focus_card, but the user's request requires canvas work.
	Every follow-up must either resolve a specific target/layout uncertainty or execute a concrete canvas operation.
	Do not repeat the same focus_card for the same target. If target confirmation is still needed, use select_cards or inspect_canvas with a precise reason. If the target is clear, call concrete operation tools such as arrange_cards, duplicate_cards, move_card, resize_card, capture_* tools, or image variant tools like mirror_image/rotate_image when image generation is requested.
	If this is running inside Codex CLI and the user is asking for newly generated artwork, use its built-in imagegen capability now. Do not only promise to use imagegen later.

	Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
	}
	return "Your previous response only moved the cursor with focus_card and did not answer the user's request. Do NOT call focus_card again. Now answer the user's latest question in prose, or use a non-focus tool if more data is required."
}

func canvasCaptureOnlyRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous response only captured the canvas, but the user's request requires canvas editing or multi-step composition work.
Do NOT call capture_* again as the next action.
Use the closest executable non-capture canvas tool action now, such as arrange_cards, duplicate_cards, move_card, resize_card, or image variant tools like mirror_image/rotate_image when image generation is requested.
If this is running inside Codex CLI and the user is asking for newly generated artwork, use its built-in imagegen capability now. Do not only promise to use imagegen later.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasInvalidActionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`Your previous canvas tool call had invalid arguments. The backend normalized common aliases and scalar values where possible, but one or more tool calls still missed required fields or used invalid enum/type values.
Do not explain the mistake. Call the same intended canvas tool again with valid arguments that match the tool schema.
Use native tool calls if available; otherwise use action blocks.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

const (
	canvasLoopReasonToolResults          = "tool_results"
	canvasLoopReasonTruncatedAction      = "truncated_action"
	canvasLoopReasonMissingCapture       = "missing_capture"
	canvasLoopReasonTextOnlyDeferredWork = "text_only_deferred_work"
	canvasLoopReasonFocusOnlyNeedsAnswer = "focus_only_needs_answer"
	canvasLoopReasonBlockedComment       = "blocked_comment"
	canvasLoopReasonCaptureOnlyWork      = "capture_only_deferred_work"
	canvasLoopReasonInvalidAction        = "invalid_action"
	canvasLoopReasonNativeEmptyFallback  = "native_empty_fallback"
)

type canvasNextLoopInput struct {
	Loop                      int
	MaxLoops                  int
	ToolResultCount           int
	TruncatedAction           bool
	MissingCapture            bool
	TextOnlyDeferredWork      bool
	FocusOnlyNeedsAnswer      bool
	BlockedCommentNeedsAnswer bool
	CaptureOnlyDeferredWork   bool
	InvalidAction             bool
}

func canvasNextLoopReason(input canvasNextLoopInput) string {
	if input.Loop >= input.MaxLoops-1 {
		return ""
	}
	if input.TruncatedAction {
		return canvasLoopReasonTruncatedAction
	}
	if input.InvalidAction {
		return canvasLoopReasonInvalidAction
	}
	if input.MissingCapture {
		return canvasLoopReasonMissingCapture
	}
	if input.CaptureOnlyDeferredWork {
		return canvasLoopReasonCaptureOnlyWork
	}
	if input.TextOnlyDeferredWork {
		return canvasLoopReasonTextOnlyDeferredWork
	}
	if input.FocusOnlyNeedsAnswer {
		return canvasLoopReasonFocusOnlyNeedsAnswer
	}
	if input.BlockedCommentNeedsAnswer {
		return canvasLoopReasonBlockedComment
	}
	if input.ToolResultCount > 0 {
		return canvasLoopReasonToolResults
	}
	return ""
}

type canvasCompactToolResult struct {
	Tool    string         `json:"tool"`
	Summary map[string]any `json:"summary,omitempty"`
}

func compactCanvasToolResult(tool string, result any) canvasCompactToolResult {
	summary, ok := compactCanvasValue("result", result).(map[string]any)
	if !ok {
		summary = map[string]any{"value": compactCanvasValue("value", result)}
	}
	return canvasCompactToolResult{Tool: tool, Summary: summary}
}

func compactCanvasValue(key string, value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		return truncate(v, 300)
	case bool, int, int64, float64:
		return v
	case []string:
		return v
	case []scanner.AssetItem:
		return compactCanvasAssetItems(v)
	case scanner.AssetItem:
		return compactCanvasAssetItem(v)
	case []any:
		limit := min(len(v), 20)
		out := make([]any, 0, limit)
		for _, item := range v[:limit] {
			out = append(out, compactCanvasValue(key, item))
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			if k == "items" {
				out[k] = compactCanvasValue(k, item)
				continue
			}
			out[k] = compactCanvasValue(k, item)
		}
		return out
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		var decoded any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return truncate(string(raw), 300)
		}
		return compactCanvasValue(key, decoded)
	}
}

func compactCanvasAssetItems(items []scanner.AssetItem) []map[string]any {
	limit := min(len(items), 8)
	out := make([]map[string]any, 0, limit)
	for _, item := range items[:limit] {
		out = append(out, compactCanvasAssetItem(item))
	}
	return out
}

func compactCanvasAssetItem(item scanner.AssetItem) map[string]any {
	summary := map[string]any{
		"assetId":     item.ID,
		"repoPath":    item.RepoPath,
		"projectName": item.ProjectName,
		"ext":         item.Ext,
		"bytes":       item.Bytes,
		"width":       item.Image.Width,
		"height":      item.Image.Height,
		"usedByCount": len(item.UsedBy),
	}
	if item.AITag != nil {
		summary["category"] = item.AITag.Category
		if len(item.AITag.Tags) > 0 {
			summary["tags"] = item.AITag.Tags
		}
		if item.AITag.Description != "" {
			summary["description"] = truncate(item.AITag.Description, 180)
		}
	}
	if item.OCR != nil && item.OCR.Text != "" {
		summary["ocrText"] = truncate(item.OCR.Text, 180)
	}
	return summary
}

func buildCanvasFollowupPrompt(reason string, latestUserMessage string, canvas canvasSnapshot, actions []canvasAction, toolResults []canvasCompactToolResult, previousAssistantText string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Original User Request\n%s\n\n", latestUserMessage)
	fmt.Fprintf(&b, "## Loop Reason\n%s\n\n", reason)

	if cards := compactCanvasRelevantCards(canvas, actions); len(cards) > 0 {
		cardJSON, _ := json.Marshal(cards)
		fmt.Fprintf(&b, "## Relevant Canvas Cards\n%s\n\n", string(cardJSON))
	}
	if previousAssistantText = strings.TrimSpace(previousAssistantText); previousAssistantText != "" {
		fmt.Fprintf(&b, "## Previous Assistant Text\n%s\n\n", truncate(previousAssistantText, 1200))
	}
	if len(toolResults) > 0 {
		resultJSON, _ := json.Marshal(toolResults)
		fmt.Fprintf(&b, "## Compact Tool Results\n%s\n\n", string(resultJSON))
	}

	b.WriteString("## Required Follow-up\n")
	b.WriteString(canvasFollowupInstruction(reason, latestUserMessage))
	return b.String()
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
	case canvasLoopReasonBlockedComment:
		return "Your previous response tried to create a comment, but the user did not ask for an annotation. Do NOT call create_comment. Answer the user's latest question in chat prose, and only mention uncertainty or next steps if needed."
	case canvasLoopReasonToolResults:
		return "Continue from the compact tool results above. Use the returned IDs exactly. If the user's request is fulfilled, give a short answer; otherwise call the next concrete tool."
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
	for _, token := range canvasCatalogSearchQueryCandidates(s) {
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

func isCanvasImageTransformTool(tool string) bool {
	switch tool {
	case "mirror_image", "rotate_image":
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
	if isCanvasImageTransformTool(tool) {
		return containsAnyText(latestUserMessage,
			"mirror", "flip", "flipped", "rotate", "rotation", "turn",
			"鏡像", "镜像", "鏡相", "镜相", "靚相", "靓相",
			"反轉", "反转", "翻轉", "翻转", "水平翻", "垂直翻", "左右翻", "上下翻", "左右反", "上下反", "水平反", "垂直反",
			"旋轉", "旋转", "選轉", "选转", "轉 90", "转 90",
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

func canvasActionPositionCardIDs(act canvasAction) []string {
	if act.Params == nil {
		return nil
	}
	rawPositions, ok := act.Params["positions"]
	if !ok {
		return nil
	}
	addFromMap := func(out []string, item map[string]any) []string {
		id := strings.TrimSpace(fmt.Sprint(item["cardId"]))
		if id != "" {
			out = append(out, id)
		}
		return out
	}
	var ids []string
	switch positions := rawPositions.(type) {
	case []any:
		for _, raw := range positions {
			if item, ok := raw.(map[string]any); ok {
				ids = addFromMap(ids, item)
			}
		}
	case []map[string]any:
		for _, item := range positions {
			ids = addFromMap(ids, item)
		}
	}
	return ids
}

func canvasActionDedupeKey(act canvasAction) string {
	ids := append([]string{}, canvasActionCardIDs(act)...)
	ids = append(ids, canvasActionPositionCardIDs(act)...)
	ids = append(ids, canvasActionAssetIDs(act)...)
	if len(ids) == 0 {
		return act.Tool
	}
	seen := map[string]bool{}
	uniq := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	sort.Strings(uniq)
	return act.Tool + "|" + strings.Join(uniq, ",")
}

func filterCanvasFallbackActions(actions []canvasAction, executed map[string]bool) []canvasAction {
	if len(actions) == 0 || len(executed) == 0 {
		return actions
	}
	out := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		if executed[canvasActionDedupeKey(act)] {
			continue
		}
		out = append(out, act)
	}
	return out
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
		"mirror_image",
		"rotate_image",
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

func canvasFollowupShouldRetainImages(reason string, latestUserMessage string) bool {
	if reason == canvasLoopReasonMissingCapture {
		return true
	}
	if canvasUserWantsCanvasAction(latestUserMessage) && (reason == canvasLoopReasonFocusOnlyNeedsAnswer || reason == canvasLoopReasonTextOnlyDeferredWork || reason == canvasLoopReasonCaptureOnlyWork) {
		return true
	}
	return containsAnyText(latestUserMessage,
		"看圖", "看图", "看一下這張", "看一下这张", "看看這張", "看看这张",
		"分析這張", "分析这张", "比較", "比较", "對比", "对比",
		"辨識", "识别", "描述這張", "描述这张",
		"畫面內容", "画面内容", "圖片內容", "图片内容", "影像內容", "图裡", "圖裡", "图中", "圖中",
		"look at", "inspect", "compare", "analyze", "analyse", "describe",
		"what is in", "what's in", "visual", "image quality", "quality issue",
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
If the user asked for transparent or no-background output, set {"transparent": true}; otherwise false.

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
		if canvasToolPreservesExplicitAssetTargets(act.Tool) && len(targetAssetIDs) > 0 {
			expanded = append(expanded, act)
			continue
		}
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

func canvasToolPreservesExplicitAssetTargets(tool string) bool {
	switch tool {
	case "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image":
		return true
	default:
		return false
	}
}

func refineCanvasImageVariantTargets(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	fallbackByTool := map[string]canvasAction{}
	for _, act := range fallbackCanvasManipulationActions(latestUserMessage, canvas, nil) {
		if isCanvasImageTransformTool(act.Tool) && len(canvasActionAssetIDs(act)) > 0 {
			fallbackByTool[act.Tool] = act
		}
	}
	if len(fallbackByTool) == 0 {
		return actions
	}
	refined := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		fallback, ok := fallbackByTool[act.Tool]
		if !ok || !isCanvasImageTransformTool(act.Tool) {
			refined = append(refined, act)
			continue
		}
		targetIDs := canvasActionAssetIDs(fallback)
		if len(targetIDs) == 0 {
			refined = append(refined, act)
			continue
		}
		clone := act
		setCanvasActionAssetIDs(&clone, targetIDs)
		if clone.Params == nil {
			clone.Params = map[string]any{}
		}
		for _, key := range []string{"outputFormat", "flip"} {
			if _, exists := clone.Params[key]; !exists {
				if value, ok := fallback.Params[key]; ok {
					clone.Params[key] = value
				}
			}
		}
		if act.Tool == "rotate_image" && !canvasTextHasExplicitRotationDegrees(latestUserMessage) {
			if value, ok := fallback.Params["degrees"]; ok {
				clone.Params["degrees"] = value
			}
		}
		refined = append(refined, clone)
	}
	return refined
}

func refineCanvasLayoutActionTargets(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	if canvasFallbackClauseTargetsSelection(latestUserMessage) {
		return actions
	}
	fallbackByTool := map[string]canvasAction{}
	for _, act := range fallbackCanvasManipulationActions(latestUserMessage, canvas, nil) {
		switch act.Tool {
		case "resize_card":
			if cardID, _ := act.Params["cardId"].(string); strings.TrimSpace(cardID) != "" {
				fallbackByTool[act.Tool] = act
			}
		case "duplicate_cards":
			if len(canvasActionCardIDs(act)) > 0 {
				fallbackByTool[act.Tool] = act
			}
		case "arrange_cards":
			if len(canvasActionPositionCardIDs(act)) > 0 {
				fallbackByTool[act.Tool] = act
			}
		}
	}
	if len(fallbackByTool) == 0 {
		return actions
	}
	refined := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		switch act.Tool {
		case "resize_card":
			fallback, ok := fallbackByTool[act.Tool]
			if !ok {
				refined = append(refined, act)
				continue
			}
			cardID, _ := fallback.Params["cardId"].(string)
			cardID = strings.TrimSpace(cardID)
			if cardID == "" {
				refined = append(refined, act)
				continue
			}
			clone := act
			clone.Params = cloneCanvasActionParams(act.Params)
			clone.Params["cardId"] = cardID
			if width, ok := fallback.Params["width"]; ok {
				clone.Params["width"] = width
			}
			refined = append(refined, clone)
		case "duplicate_cards":
			fallback, ok := fallbackByTool[act.Tool]
			if !ok {
				refined = append(refined, act)
				continue
			}
			cardIDs := canvasActionCardIDs(fallback)
			if len(cardIDs) == 0 {
				refined = append(refined, act)
				continue
			}
			clone := act
			clone.Params = cloneCanvasActionParams(act.Params)
			setCanvasActionCardIDs(&clone, cardIDs)
			for _, key := range []string{"count", "layout", "label"} {
				if value, ok := fallback.Params[key]; ok {
					clone.Params[key] = value
				}
			}
			refined = append(refined, clone)
		case "arrange_cards":
			fallback, ok := fallbackByTool[act.Tool]
			if !ok {
				refined = append(refined, act)
				continue
			}
			positions := fallback.Params["positions"]
			if len(canvasActionPositionCardIDs(fallback)) == 0 {
				refined = append(refined, act)
				continue
			}
			clone := act
			clone.Params = cloneCanvasActionParams(act.Params)
			clone.Params["positions"] = positions
			refined = append(refined, clone)
		default:
			refined = append(refined, act)
		}
	}
	return refined
}

func refineCanvasActionTargets(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	actions = refineCanvasImageVariantTargets(actions, canvas, latestUserMessage)
	actions = refineCanvasLayoutActionTargets(actions, canvas, latestUserMessage)
	mentioned := canvasMentionedActionTargetCardIDs(latestUserMessage, canvas)
	if !canvasFallbackClauseKeepsMultipleTargets(latestUserMessage) {
		for id := range canvasFallbackLayoutTargetCardIDs(latestUserMessage, canvas) {
			if mentioned == nil {
				mentioned = map[string]bool{}
			}
			mentioned[id] = true
		}
	}
	if len(mentioned) == 0 {
		return actions
	}
	refined := make([]canvasAction, 0, len(actions))
	for _, act := range actions {
		switch act.Tool {
		case "focus_card", "move_card", "resize_card":
			cardID, _ := act.Params["cardId"].(string)
			cardID = strings.TrimSpace(cardID)
			if cardID != "" && !mentioned[cardID] {
				continue
			}
		case "arrange_cards":
			positions := filterCanvasActionPositionsByMentioned(act.Params["positions"], mentioned)
			if len(positions) == 0 {
				continue
			}
			clone := act
			clone.Params = cloneCanvasActionParams(act.Params)
			clone.Params["positions"] = positions
			refined = append(refined, clone)
			continue
		case "duplicate_cards", "select_cards", "remove_cards", "align_cards", "distribute_cards", "bring_cards_to_front":
			cardIDs := filterCanvasActionCardIDsByMentioned(canvasActionCardIDs(act), mentioned)
			if len(cardIDs) == 0 {
				continue
			}
			clone := act
			setCanvasActionCardIDs(&clone, cardIDs)
			refined = append(refined, clone)
			continue
		}
		refined = append(refined, act)
	}
	return refined
}

func canvasFallbackLayoutTargetCardIDs(latestUserMessage string, canvas canvasSnapshot) map[string]bool {
	if canvasFallbackClauseTargetsSelection(latestUserMessage) {
		return nil
	}
	ids := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id != "" {
			ids[id] = true
		}
	}
	for _, act := range fallbackCanvasManipulationActions(latestUserMessage, canvas, nil) {
		switch act.Tool {
		case "focus_card", "move_card", "resize_card":
			if id, _ := act.Params["cardId"].(string); id != "" {
				add(id)
			}
		case "duplicate_cards", "select_cards", "remove_cards", "align_cards", "distribute_cards", "bring_cards_to_front":
			for _, id := range canvasActionCardIDs(act) {
				add(id)
			}
		case "arrange_cards":
			for _, id := range canvasActionPositionCardIDs(act) {
				add(id)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return ids
}

func canvasMentionedActionTargetCardIDs(text string, canvas canvasSnapshot) map[string]bool {
	queryTerms := canvasFallbackQueryTerms(text)
	if len(queryTerms) == 0 {
		return nil
	}
	type cardMatch struct {
		cardID  string
		aliases []string
	}
	var matches []cardMatch
	aliasCardCounts := map[string]int{}
	for _, card := range canvas.Cards {
		if !canvasCardCanBeVisuallyArranged(card) {
			continue
		}
		score, aliases := canvasFallbackCardScore(card, queryTerms)
		if score <= 0 || len(aliases) == 0 {
			continue
		}
		matches = append(matches, cardMatch{cardID: card.ID, aliases: aliases})
		seenAliases := map[string]bool{}
		for _, alias := range aliases {
			alias = strings.ToLower(strings.TrimSpace(alias))
			if alias == "" || seenAliases[alias] {
				continue
			}
			seenAliases[alias] = true
			aliasCardCounts[alias]++
		}
	}
	mentioned := map[string]bool{}
	for _, match := range matches {
		for _, alias := range match.aliases {
			if aliasCardCounts[strings.ToLower(strings.TrimSpace(alias))] == 1 {
				mentioned[match.cardID] = true
				break
			}
		}
	}
	if len(mentioned) == 0 || len(mentioned) > max(8, len(canvas.Cards)/2) {
		return nil
	}
	return mentioned
}

func cloneCanvasActionParams(params map[string]any) map[string]any {
	next := make(map[string]any, len(params))
	for key, value := range params {
		next[key] = value
	}
	return next
}

func filterCanvasActionCardIDsByMentioned(cardIDs []string, mentioned map[string]bool) []string {
	out := make([]string, 0, len(cardIDs))
	seen := map[string]bool{}
	for _, id := range cardIDs {
		id = strings.TrimSpace(id)
		if id == "" || !mentioned[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func filterCanvasActionPositionsByMentioned(rawPositions any, mentioned map[string]bool) []any {
	add := func(out []any, item map[string]any) []any {
		cardID := strings.TrimSpace(fmt.Sprint(item["cardId"]))
		if cardID == "" || !mentioned[cardID] {
			return out
		}
		next := make(map[string]any, len(item))
		for key, value := range item {
			next[key] = value
		}
		return append(out, next)
	}
	var out []any
	switch positions := rawPositions.(type) {
	case []any:
		for _, raw := range positions {
			if item, ok := raw.(map[string]any); ok {
				out = add(out, item)
			}
		}
	case []map[string]any:
		for _, item := range positions {
			out = add(out, item)
		}
	}
	return out
}

func canvasTextHasExplicitRotationDegrees(text string) bool {
	return containsAnyText(text,
		"90", "180", "270", "九十", "一百八十", "百八", "兩百七十", "两百七十",
		"ninety", "one eighty", "one-eighty", "hundred eighty", "two seventy", "two-seventy",
	)
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
	latestUserMessage := latestCanvasUserMessage(req.Messages)
	selectedSkillIDs := classifyCanvasSkillFamilies(canvasSkillClassifyInput{
		Message: latestUserMessage,
		Canvas:  req.Canvas,
		Options: req.Options,
	})
	canvasTools := canvasLLMToolsForSkills(selectedSkillIDs)
	usingNativeTools := len(canvasTools) > 0
	systemPrompt := canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
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
	for _, token := range req.AttachmentTokens {
		if len(images) >= 4 {
			break
		}
		if token == "" {
			continue
		}
		download, ok := s.peekImageToolDownload(token)
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
	proposalIndex := 0
	captureRequested := canvasCaptureRequested(latestUserMessage)
	captureSeen := false
	var totalInputTokens, totalOutputTokens int64
	start := time.Now()

	const canvasOutputTokenLimit = 900
	promptKind := vlmPromptKindFull
	loopReason := "initial"
	var loopStats []vlmChatRoundStats
	generatedImagePaths := map[string]bool{}
	concreteCanvasActionSeen := false
	searchCatalogActionSeen := false
	preparatoryActionLoops := 0
	executedCanvasActionKeys := map[string]bool{}
	rememberExecutedCanvasAction := func(act canvasAction) {
		if strings.TrimSpace(act.Tool) == "" {
			return
		}
		executedCanvasActionKeys[canvasActionDedupeKey(act)] = true
		if canvasToolIsCatalogSearchWork(act.Tool) {
			searchCatalogActionSeen = true
		}
	}
	confirmedFallbackCardIDSeen := map[string]bool{}
	var confirmedFallbackCardIDs []string
	rememberConfirmedFallbackCardID := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || confirmedFallbackCardIDSeen[id] {
			return
		}
		confirmedFallbackCardIDSeen[id] = true
		confirmedFallbackCardIDs = append(confirmedFallbackCardIDs, id)
	}
	rememberConfirmedFallbackAction := func(act canvasAction) {
		switch act.Tool {
		case "focus_card", "select_cards":
			for _, id := range canvasActionCardIDs(act) {
				rememberConfirmedFallbackCardID(id)
			}
		}
	}
	for loop := 0; loop < maxToolLoops; loop++ {
		round := s.chatVLMRound(r.Context(), vlmChatRoundRequest{
			Images:           images,
			Backend:          backend,
			ModelName:        modelName,
			SystemPrompt:     systemPrompt,
			Prompt:           currentPrompt,
			Purpose:          "canvas",
			TimeoutSec:       canvasOutputTokenLimit,
			Tools:            canvasTools,
			SelectedSkillIDs: selectedSkillIDs,
			Loop:             loop,
			PromptKind:       promptKind,
			LoopReason:       loopReason,
		})
		loopStats = append(loopStats, round.Stats)
		statIndex := len(loopStats) - 1
		if round.Err != nil {
			sendNDJSON(w, map[string]any{
				"type":  "error",
				"error": map[string]string{"code": "canvas_chat_llm_failed", "message": round.Err.Error()},
			})
			return
		}
		content := round.Content
		chatResp := round.Response
		totalInputTokens += chatResp.InputTokens
		totalOutputTokens += chatResp.OutputTokens
		if usingNativeTools && strings.TrimSpace(content) == "" && len(chatResp.ToolCalls) == 0 && loop < maxToolLoops-1 {
			loopStats[statIndex].ToolUseSource = "native_empty"
			loopStats[statIndex].NextReason = canvasLoopReasonNativeEmptyFallback
			canvasTools = nil
			usingNativeTools = false
			systemPrompt = canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
			currentPrompt = userPrompt
			promptKind = vlmPromptKindFull
			loopReason = canvasLoopReasonNativeEmptyFallback
			sendNDJSON(w, map[string]any{"type": "thinking"})
			continue
		}
		for _, image := range s.canvasGeneratedImagesFromContent(content, generatedImagePaths) {
			sendNDJSON(w, map[string]any{
				"type":             "generated_image",
				"token":            image.Token,
				"thumbnailDataUrl": image.ThumbnailDataURL,
				"fileName":         image.FileName,
				"width":            image.Width,
				"height":           image.Height,
			})
		}

		textBody, actions := parseCanvasActions(content)
		fallbackActionCount := len(actions)
		toolCallActions := canvasActionsFromToolCalls(chatResp.ToolCalls)
		toolUseSource := ""
		if len(toolCallActions) > 0 {
			actions = toolCallActions
			textBody = strings.TrimSpace(content)
			toolUseSource = "native_tool_call"
		} else if fallbackActionCount > 0 {
			toolUseSource = "fallback_parse"
		}
		loopStats[statIndex].ToolUseSource = toolUseSource
		loopStats[statIndex].NativeToolCallCount = len(toolCallActions)
		loopStats[statIndex].FallbackActionCount = fallbackActionCount
		truncatedAction := canvasActionBlockLikelyTruncated(content) && loop < maxToolLoops-1
		var invalidActionIssues []canvasActionValidationIssue
		actions, invalidActionIssues = normalizeCanvasActions(actions, false)
		actions = expandCanvasMultiSelectedActions(actions, req.Canvas, latestUserMessage)
		actions = refineCanvasActionTargets(actions, req.Canvas, latestUserMessage)
		actions = refineCanvasSearchActions(actions, latestUserMessage)
		var postExpansionIssues []canvasActionValidationIssue
		actions, postExpansionIssues = normalizeCanvasActions(actions, true)
		invalidActionIssues = append(invalidActionIssues, postExpansionIssues...)
		invalidActionNeedsRepair := len(invalidActionIssues) > 0 && loop < maxToolLoops-1
		loopStats[statIndex].ActionCount = len(actions)
		loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		hasCaptureAction := false
		for _, act := range actions {
			if canvasToolIsCapture(act.Tool) {
				hasCaptureAction = true
				break
			}
		}
		missingCapture := captureRequested && !captureSeen && !hasCaptureAction && loop < maxToolLoops-1

		var compactToolResults []canvasCompactToolResult
		captureExecutedThisLoop := false
		nonCaptureToolExecutedThisLoop := false
		nonFocusToolExecutedThisLoop := false
		blockedCommentNeedsAnswer := false
		executedActionCount := 0
		safeActionCount := 0
		proposalCount := 0
		blockedProposalCount := 0
		blockedCommentCount := 0
		for _, issue := range invalidActionIssues {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
		}
		for _, act := range actions {
			rememberConfirmedFallbackAction(act)
			if status := canvasActionStatusMessage(act); status != "" {
				sendNDJSON(w, map[string]any{
					"type":    "status",
					"phase":   "confirming",
					"content": status,
				})
			}
			if act.Tool == "focus_card" {
				executedActionCount++
				safeActionCount++
				sendNDJSON(w, map[string]any{
					"type":   "focus",
					"cardId": act.Params["cardId"],
					"label":  act.Params["label"],
				})
				rememberExecutedCanvasAction(act)
				time.Sleep(300 * time.Millisecond)
				continue
			}
			if act.Tool == "create_comment" && !canvasUserAsksAnnotation(latestUserMessage) {
				blockedCommentNeedsAnswer = true
				blockedCommentCount++
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
				executedActionCount++
				safeActionCount++
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				rememberExecutedCanvasAction(act)
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					concreteCanvasActionSeen = true
				}
				if !canvasToolIsCapture(act.Tool) && act.Tool != "extract_ocr_text" {
					nonCaptureToolExecutedThisLoop = true
					if !canvasToolIsConcreteCanvasWork(act.Tool) {
						compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
					}
				}
			} else {
				if !canvasProposalAllowed(act.Tool, latestUserMessage, req.Options) {
					blockedProposalCount++
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
				rememberExecutedCanvasAction(act)
				executedActionCount++
				proposalCount++
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					concreteCanvasActionSeen = true
				}
				nonCaptureToolExecutedThisLoop = true
			}
			time.Sleep(150 * time.Millisecond)
		}
		loopStats[statIndex].ExecutedActionCount = executedActionCount
		loopStats[statIndex].SafeActionCount = safeActionCount
		loopStats[statIndex].ProposalCount = proposalCount
		loopStats[statIndex].BlockedProposalCount = blockedProposalCount
		loopStats[statIndex].BlockedCommentCount = blockedCommentCount

		actionRequestNeedsTool := canvasTextOnlyResponseNeedsActionRepair(textBody, nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		if canvasUserWantsCanvasAction(latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen {
			preparatoryActionLoops++
		}
		focusOnlyNeedsAnswer := (canvasActionsOnlyFocus(actions) || (canvasUserWantsCanvasAction(latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen)) && !actionRequestNeedsTool && loop < maxToolLoops-1 && (textBody == "" || canvasUserWantsCanvasAction(latestUserMessage))
		if textBody != "" && !truncatedAction && !nonFocusToolExecutedThisLoop && !actionRequestNeedsTool && !focusOnlyNeedsAnswer && !invalidActionNeedsRepair {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(w, map[string]any{"type": "text", "content": p})
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		captureOnlyDeferredWork := captureExecutedThisLoop && canvasUserWantsCanvasAction(latestUserMessage) && !nonCaptureToolExecutedThisLoop && loop < maxToolLoops-1
		if captureExecutedThisLoop && !truncatedAction && !captureOnlyDeferredWork {
			break
		}
		nextLoopReason := canvasNextLoopReason(canvasNextLoopInput{
			Loop:                      loop,
			MaxLoops:                  maxToolLoops,
			ToolResultCount:           len(compactToolResults),
			TruncatedAction:           truncatedAction,
			MissingCapture:            missingCapture,
			TextOnlyDeferredWork:      actionRequestNeedsTool,
			FocusOnlyNeedsAnswer:      focusOnlyNeedsAnswer,
			BlockedCommentNeedsAnswer: blockedCommentNeedsAnswer,
			CaptureOnlyDeferredWork:   captureOnlyDeferredWork,
			InvalidAction:             invalidActionNeedsRepair,
		})
		loopStats[statIndex].NextReason = nextLoopReason
		if nextLoopReason == "" {
			break
		}
		if status := canvasFollowupStatusMessage(nextLoopReason, latestUserMessage, preparatoryActionLoops); status != "" {
			sendNDJSON(w, map[string]any{
				"type":    "status",
				"phase":   "planning",
				"content": status,
			})
		}
		if !canvasFollowupShouldRetainImages(nextLoopReason, latestUserMessage) {
			images = nil
		}
		selectedSkillIDs = expandCanvasSkillFamiliesForLoopReason(selectedSkillIDs, nextLoopReason, latestUserMessage, req.Options)
		if usingNativeTools {
			canvasTools = canvasLLMToolsForSkills(selectedSkillIDs)
			systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		} else {
			canvasTools = nil
			systemPrompt = canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		}
		currentPrompt = buildCanvasFollowupPrompt(nextLoopReason, latestUserMessage, req.Canvas, actions, compactToolResults, content)
		promptKind = vlmPromptKindFollowup
		loopReason = nextLoopReason
		sendNDJSON(w, map[string]any{"type": "thinking"})
	}

	if !searchCatalogActionSeen {
		if act, ok := fallbackCanvasCatalogSearchAction(latestUserMessage, selectedSkillIDs); ok {
			fallbackSearchActions, _ := normalizeCanvasActions([]canvasAction{act}, true)
			fallbackSearchActions = filterCanvasFallbackActions(fallbackSearchActions, executedCanvasActionKeys)
			for _, searchAct := range fallbackSearchActions {
				result := s.executeCanvasSafeAction(r, searchAct, settings, req.Canvas)
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   searchAct.Tool,
					"result": result,
				})
				rememberExecutedCanvasAction(searchAct)
				time.Sleep(150 * time.Millisecond)
			}
		}
	}

	if canvasUserWantsCanvasAction(latestUserMessage) {
		fallbackActions := fallbackCanvasManipulationActions(latestUserMessage, req.Canvas, confirmedFallbackCardIDs)
		fallbackActions, _ = normalizeCanvasActions(fallbackActions, true)
		fallbackActions = refineCanvasActionTargets(fallbackActions, req.Canvas, latestUserMessage)
		fallbackActions = filterCanvasFallbackActions(fallbackActions, executedCanvasActionKeys)
		if len(fallbackActions) > 0 || preparatoryActionLoops > 0 || concreteCanvasActionSeen || len(confirmedFallbackCardIDs) > 0 {
			if status := canvasFallbackManipulationStatus(fallbackActions); status != "" {
				sendNDJSON(w, map[string]any{
					"type":    "status",
					"phase":   "operation",
					"content": status,
				})
			}
			for _, act := range fallbackActions {
				if status := canvasActionStatusMessage(act); status != "" {
					sendNDJSON(w, map[string]any{
						"type":    "status",
						"phase":   "operation",
						"content": status,
					})
				}
				if canvasToolSafe(act.Tool) {
					result := s.executeCanvasSafeAction(r, act, settings, req.Canvas)
					if act.Tool == "duplicate_cards" {
						result = canvasFallbackAugmentDuplicateResult(result, latestUserMessage, req.Canvas)
					}
					sendNDJSON(w, map[string]any{
						"type":   "action_result",
						"tool":   act.Tool,
						"result": result,
					})
					rememberExecutedCanvasAction(act)
					if canvasToolIsConcreteCanvasWork(act.Tool) {
						concreteCanvasActionSeen = true
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
					rememberExecutedCanvasAction(act)
					if canvasToolIsConcreteCanvasWork(act.Tool) {
						concreteCanvasActionSeen = true
					}
				}
				time.Sleep(150 * time.Millisecond)
			}
			if !concreteCanvasActionSeen {
				sendNDJSON(w, map[string]any{
					"type":    "status",
					"phase":   "blocked",
					"content": "Target confirmation finished, but no safe concrete canvas operation could be inferred.",
				})
			}
		}
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
		"loopStats":    loopStats,
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
		fetchLimit := limit
		if strings.TrimSpace(q) != "" && fetchLimit < 18 {
			fetchLimit = max(18, limit*4)
			if fetchLimit > 18 {
				fetchLimit = 18
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
				Limit:  fetchLimit,
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
		items = canvasRankCatalogSearchItems(items, q)
		if len(items) > limit {
			items = items[:limit]
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
	case "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image":
		return map[string]any{
			"assetIds":       canvasActionAssetIDs(act),
			"assetId":        act.Params["assetId"],
			"operation":      act.Tool,
			"outputFormat":   act.Params["outputFormat"],
			"quality":        act.Params["quality"],
			"maxDimensionPx": act.Params["maxDimensionPx"],
			"flip":           act.Params["flip"],
			"degrees":        act.Params["degrees"],
			"label":          act.Params["label"],
		}
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

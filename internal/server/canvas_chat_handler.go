package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
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
	"aisets/internal/semantic"
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
	FileName              string              `json:"fileName,omitempty"`
	ProjectName           string              `json:"projectName,omitempty"`
	RepoPath              string              `json:"repoPath"`
	Ext                   string              `json:"ext"`
	Width                 int                 `json:"width"`
	Height                int                 `json:"height"`
	ImageFormat           string              `json:"imageFormat,omitempty"`
	Animated              bool                `json:"animated,omitempty"`
	Alpha                 bool                `json:"alpha,omitempty"`
	Pages                 int                 `json:"pages,omitempty"`
	Bytes                 int64               `json:"bytes"`
	URL                   string              `json:"url,omitempty"`
	ThumbnailURL          string              `json:"thumbnailUrl,omitempty"`
	Tags                  []string            `json:"tags,omitempty"`
	Description           string              `json:"description,omitempty"`
	OcrText               string              `json:"ocrText,omitempty"`
	UsedByCount           int                 `json:"usedByCount"`
	SearchCategory        string              `json:"searchCategory,omitempty"`
	SearchTags            []string            `json:"searchTags,omitempty"`
	SearchDescription     string              `json:"searchDescription,omitempty"`
	SearchLanguages       []string            `json:"searchLanguages,omitempty"`
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
		if value[0] == '{' || value[0] == '[' {
			var decoded any
			if err := json.Unmarshal([]byte(normalizeCanvasActionJSON(value)), &decoded); err == nil {
				return decoded
			}
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
	normalizeBracketCanvasRegionParams(act)
	normalizeBracketCanvasVisualCueParams(act)
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

func normalizeBracketCanvasRegionParams(act *canvasAction) {
	if act.Params == nil || !canvasToolHasImageRegion(act.Tool) {
		return
	}
	if raw, ok := act.Params["region"].(string); ok {
		var decoded map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &decoded); err == nil {
			act.Params["region"] = decoded
		}
	}
	if _, exists := act.Params["region"]; exists {
		return
	}
	x, okX := canvasBracketNumberParam(act.Params["regionX"])
	y, okY := canvasBracketNumberParam(act.Params["regionY"])
	width, okWidth := canvasBracketNumberParam(act.Params["regionWidth"])
	height, okHeight := canvasBracketNumberParam(act.Params["regionHeight"])
	if !okX || !okY || !okWidth || !okHeight {
		return
	}
	act.Params["region"] = map[string]any{
		"x":      x,
		"y":      y,
		"width":  width,
		"height": height,
	}
	delete(act.Params, "regionX")
	delete(act.Params, "regionY")
	delete(act.Params, "regionWidth")
	delete(act.Params, "regionHeight")
}

func normalizeBracketCanvasVisualCueParams(act *canvasAction) {
	if act.Params == nil || !canvasToolHasImageRegion(act.Tool) {
		return
	}
	if raw, ok := act.Params["visualCue"].(string); ok {
		var decoded map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &decoded); err == nil {
			act.Params["visualCue"] = decoded
		}
	}
	if _, exists := act.Params["visualCue"]; exists {
		return
	}
	targetDescription := strings.TrimSpace(fmt.Sprint(act.Params["visualCueTargetDescription"]))
	colorHex := strings.TrimSpace(fmt.Sprint(act.Params["visualCueColorHex"]))
	if targetDescription == "" && colorHex == "" {
		return
	}
	visualCue := map[string]any{}
	if targetDescription != "" {
		visualCue["targetDescription"] = targetDescription
	}
	if colorHex != "" {
		visualCue["colorHex"] = colorHex
	}
	act.Params["visualCue"] = visualCue
	delete(act.Params, "visualCueTargetDescription")
	delete(act.Params, "visualCueColorHex")
}

func canvasBracketNumberParam(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	case string:
		n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return n, err == nil
	default:
		return 0, false
	}
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

func canvasActionToolNames(actions []canvasAction) []string {
	names := make([]string, 0, len(actions))
	for _, action := range actions {
		if action.Tool != "" {
			names = append(names, action.Tool)
		}
	}
	return names
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

func filterCanvasIncidentalCatalogSearchActions(actions []canvasAction) []canvasAction {
	hasImageOperation := false
	for _, act := range actions {
		if isCanvasOptimizationTool(act.Tool) || isCanvasImageTransformTool(act.Tool) {
			hasImageOperation = true
			break
		}
	}
	if !hasImageOperation {
		return actions
	}
	out := actions[:0]
	for _, act := range actions {
		if act.Tool == "search_assets" {
			continue
		}
		out = append(out, act)
	}
	return out
}

func canvasActionStatusMessage(act canvasAction) string {
	switch act.Tool {
	case "focus_card":
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

func canvasActionStreamParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(params))
	for key, value := range params {
		if key == "label" {
			continue
		}
		out[key] = value
	}
	return out
}

func canvasToolDescription(tool string) string {
	for _, def := range canvasToolRegistry() {
		if def.Name == tool {
			return def.Description
		}
	}
	return "Canvas operation"
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
	if canvasMessageWantsVisualResize(latestUserMessage) {
		add("resize_card")
	}
	if canvasMessageWantsVisualMove(latestUserMessage) {
		add("move_card")
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "arrange", "layout") {
		add("arrange_cards")
	}
	if containsAnyText(latestUserMessage, "align") {
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
	case canvasLoopReasonOCRTextExtraction:
		return "Text-bearing assets are on the canvas; extracting OCR before creating annotations."
	case canvasLoopReasonOCRTextAnnotation:
		return "OCR text is ready; creating the requested text annotations."
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

func canvasActionBlockTextNeedsActionRepair(usingNativeTools bool, loopReason string, textBody string, actionCount int, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if usingNativeTools || loop >= maxLoops-1 || nonFocusToolExecuted || actionCount > 0 || strings.TrimSpace(textBody) == "" {
		return false
	}
	switch loopReason {
	case "initial", canvasLoopReasonTextOnlyDeferredWork, canvasLoopReasonTruncatedAction, canvasLoopReasonMissingCapture, canvasLoopReasonCaptureOnlyWork, canvasLoopReasonInvalidAction, canvasLoopReasonNativeEmptyFallback, canvasLoopReasonOCRTextExtraction, canvasLoopReasonOCRTextAnnotation:
		return true
	default:
		return false
	}
}

func canvasRequiredNativeToolCallMissing(usingNativeTools bool, toolChoice string, textBody string, actionCount int, nonFocusToolExecuted bool, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 || nonFocusToolExecuted || actionCount > 0 {
		return false
	}
	return usingNativeTools && toolChoice == "required" && strings.TrimSpace(textBody) != ""
}

func canvasActionMentionsAssetOCR(act canvasAction, canvas canvasSnapshot) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	text := strings.TrimSpace(fmt.Sprint(act.Params["text"]))
	if text == "" {
		return false
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor == nil || anchor.Asset == nil {
		return false
	}
	ocrText := strings.TrimSpace(anchor.Asset.OcrText)
	return ocrText != "" && strings.Contains(text, ocrText)
}

func canvasActionTargetsTextRegion(act canvasAction) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	if !ok {
		return false
	}
	return cue.HasColor && canvasVisualCueLooksLikeText(cue)
}

func canvasActionHasVerifiableNonTextCue(act canvasAction) bool {
	if act.Tool != "create_comment" && act.Tool != "update_comment" {
		return false
	}
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	return ok && cue.HasColor && !canvasVisualCueLooksLikeText(cue)
}

func canvasActionHasRefinableVisualCue(act canvasAction) bool {
	cue, ok := canvasRegionVisualCueFromParams(act.Params)
	return ok && strings.TrimSpace(cue.TargetDescription) != "" && cue.HasColor
}

func canvasActionHasImageRegion(act canvasAction) bool {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return false
	}
	_, ok := canvasRegionFromValue(act.Params["region"])
	return ok
}

func canvasActionHasGenericPlaceholderRegion(act canvasAction) bool {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return false
	}
	region, ok := canvasRegionFromValue(act.Params["region"])
	return ok && canvasRegionLooksGenericPlaceholder(region)
}

func canvasRegionLooksGenericPlaceholder(region canvasRegion) bool {
	return math.Abs(region.X-0.1) <= 0.015 &&
		math.Abs(region.Y-0.2) <= 0.015 &&
		math.Abs(region.Width-0.2) <= 0.015 &&
		math.Abs(region.Height-0.1) <= 0.015
}

func canvasTextRegionActionDedupeKey(act canvasAction, canvas canvasSnapshot) string {
	if act.Tool != "create_comment" || !canvasActionTargetsTextRegion(act) {
		return ""
	}
	region, ok := canvasRegionFromValue(act.Params["region"])
	if !ok {
		return ""
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor == nil || anchor.ID == "" {
		return ""
	}
	return fmt.Sprintf(
		"%s:%s:%.3f:%.3f:%.3f:%.3f",
		act.Tool,
		anchor.ID,
		region.X,
		region.Y,
		region.Width,
		region.Height,
	)
}

func canvasIncompleteTextAnnotationNeedsRepair(actions []canvasAction, canvas canvasSnapshot, loop int, maxLoops int) bool {
	if loop >= maxLoops-1 {
		return false
	}
	mentionsOCR := false
	hasTextRegion := false
	for _, act := range actions {
		if canvasActionTargetsTextRegion(act) {
			hasTextRegion = true
		}
		if canvasActionMentionsAssetOCR(act, canvas) {
			mentionsOCR = true
		}
	}
	return mentionsOCR && !hasTextRegion
}

func filterCanvasUnverifiableTextMentionActions(actions []canvasAction, canvas canvasSnapshot) ([]canvasAction, int) {
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		if canvasActionMentionsAssetOCR(act, canvas) && !canvasActionTargetsTextRegion(act) && !canvasActionHasVerifiableNonTextCue(act) {
			blocked++
			continue
		}
		filtered = append(filtered, act)
	}
	return filtered, blocked
}

func filterCanvasFallbackImageRegionActionsMissingVisualCue(actions []canvasAction, requireVisualCue bool) ([]canvasAction, []canvasActionValidationIssue) {
	if !requireVisualCue {
		return actions, nil
	}
	filtered := make([]canvasAction, 0, len(actions))
	var issues []canvasActionValidationIssue
	for _, act := range actions {
		if canvasActionHasImageRegion(act) && !canvasActionHasRefinableVisualCue(act) {
			issues = append(issues, canvasActionValidationIssue{
				Tool:   act.Tool,
				Reason: "fallback image-region actions must include visualCue.targetDescription and visualCue.colorHex so the marker can be refined against the original image pixels",
			})
			continue
		}
		filtered = append(filtered, act)
	}
	return filtered, issues
}

func filterCanvasIncompleteTextAnnotationActions(actions []canvasAction, loopReason string, repairPending bool) ([]canvasAction, int) {
	if loopReason != canvasLoopReasonIncompleteTextAnnotation && !repairPending {
		return actions, 0
	}
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		if act.Tool == "create_comment" && canvasActionTargetsTextRegion(act) {
			filtered = append(filtered, act)
			continue
		}
		blocked++
	}
	return filtered, blocked
}

func filterCanvasOCRTextAnnotationActions(actions []canvasAction, loopReason string) ([]canvasAction, int) {
	if loopReason != canvasLoopReasonOCRTextAnnotation {
		return actions, 0
	}
	filtered := make([]canvasAction, 0, len(actions))
	blocked := 0
	for _, act := range actions {
		switch act.Tool {
		case "create_comment":
			if canvasActionHasImageRegion(act) && canvasActionTargetsTextRegion(act) {
				filtered = append(filtered, act)
				continue
			}
			blocked++
		case "remove_cards", "arrange_cards", "copy_asset":
			filtered = append(filtered, act)
		default:
			blocked++
		}
	}
	return filtered, blocked
}

func canvasTextLooksLikeDeferredWork(text string) bool {
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return false
	}

	futureMarkers := []string{
		"i will", "i'll", "i can", "i would", "i'm going to", "let me", "next, i", "here is the plan", "suggested",
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
			(len(line) >= 2 && line[0] >= '1' && line[0] <= '9' && line[1] == ')') {
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
- Use create_comment with region for annotation, circle, mark, highlight, or object-location requests; put the location answer in the comment text.
- Use proposal tools for source-file or metadata changes.
- Use capture tools for screenshot/export work.
- If this is running inside Codex CLI and the work truly requires its built-in imagegen capability, use that capability now in this same response and return a concrete generated result. Do not merely say you will use imagegen later.
- If the work needs multiple steps, start with the first concrete tool action and continue after tool results.
- For CLI/text transport, output bracket action blocks like [action: create_comment] with param lines. Do not output only "done", "already", or a natural-language completion claim.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasIncompleteTextAnnotationRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`A previous comment mentioned OCR/text content from the asset, but no separate region-bearing text annotation was produced.
Add one create_comment for each missing OCR text target listed above. Do not repeat existing non-text comments.
For text, box the actual visible characters themselves, not the banner, sign, label, or container.
Required params: anchorCardId, text, region, visualCue.targetDescription, visualCue.colorHex.
Use a text visual cue such as targetDescription: "white text characters" and the text pixel color.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasOCRTextAnnotationRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The previous tool results contain OCR items for text-bearing candidates on the canvas.
Complete the visual text-annotation workflow now:
- Allowed tools in this round are create_comment, remove_cards, arrange_cards, and copy_asset only.
- Do not call search_assets, add_assets_to_canvas, extract_ocr_text, focus_card, inspect_canvas, or any prose-only response; those cannot complete this repair round.
- For each extract_ocr_text item with status "ready" and non-empty text, call create_comment on that same card or asset. Put the OCR text in the comment text.
- For each extract_ocr_text item with no readable text, call remove_cards for that card or asset because the user asked to show text-bearing images.
- If cards are removed, call arrange_cards for the remaining text-bearing cards so the layout stays even.
- Use the returned cardId when present. If only assetId is present for a newly added card, use that assetId as anchorCardId/cardId; the frontend resolves it to the created canvas card.
- For text, box the visible text area. If the exact character box is uncertain from metadata alone, box the visible text-bearing label/sign/image region rather than inventing unrelated coordinates.
- Include visualCue.targetDescription in English and visualCue.colorHex for text pixels when calling create_comment.
- If the original request also asks to copy files using the OCR text as filenames, call copy_asset in this same response after the comments. Use perAssetDestPaths with one assetId and OCR-derived destPath per source asset. This must create a proposal, not directly write files.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasOCRTextExtractionRepairPrompt(latestUserMessage string) string {
	return fmt.Sprintf(`The previous tool results show a text-bearing catalog search and assets were added to the canvas, but the OCR text needed for annotations has not been extracted yet.
Call extract_ocr_text for the added assetIds or cardIds from the compact tool results.
Required params: assetIds or cardIds, mode: "vlm", saveToMetadata: false.
Do not call selection, layout, focus, or prose-only tools in this repair round.

Latest user request: %q

Reply with only tool calls or action blocks and no prose.`, latestUserMessage)
}

func canvasUserWantsCanvasAction(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"arrange", "layout", "storyboard", "battle", "fight", "move", "position",
		"duplicate", "copy", "mirror", "flip", "rotate", "resize", "bigger", "larger", "smaller", "capture", "export",
	) || canvasMessageWantsVisualResize(latestUserMessage) ||
		canvasMessageWantsVisualMove(latestUserMessage) ||
		canvasMessageWantsVisualDuplicate(latestUserMessage)
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
	return "Your previous response only moved the cursor with focus_card and did not answer or complete the user's request. Do NOT call focus_card again. If the original request asks for an edit, layout change, or file operation in any language, call the concrete non-focus tool now. If it is a visual question, answer the user's latest question in prose, or use a non-focus inspection/detail tool if more data is required."
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
	canvasLoopReasonToolResults              = "tool_results"
	canvasLoopReasonTruncatedAction          = "truncated_action"
	canvasLoopReasonMissingCapture           = "missing_capture"
	canvasLoopReasonTextOnlyDeferredWork     = "text_only_deferred_work"
	canvasLoopReasonFocusOnlyNeedsAnswer     = "focus_only_needs_answer"
	canvasLoopReasonBlockedComment           = "blocked_comment"
	canvasLoopReasonCaptureOnlyWork          = "capture_only_deferred_work"
	canvasLoopReasonInvalidAction            = "invalid_action"
	canvasLoopReasonNativeEmptyFallback      = "native_empty_fallback"
	canvasLoopReasonIncompleteTextAnnotation = "incomplete_text_annotation"
	canvasLoopReasonOCRTextExtraction        = "ocr_text_extraction"
	canvasLoopReasonOCRTextAnnotation        = "ocr_text_annotation"
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
	IncompleteTextAnnotation  bool
	OCRTextExtraction         bool
	OCRTextAnnotation         bool
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
	if input.IncompleteTextAnnotation {
		return canvasLoopReasonIncompleteTextAnnotation
	}
	if input.OCRTextExtraction {
		return canvasLoopReasonOCRTextExtraction
	}
	if input.OCRTextAnnotation {
		return canvasLoopReasonOCRTextAnnotation
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
		"fileName":    canvasAssetFileName("", item.RepoPath),
		"repoPath":    item.RepoPath,
		"projectName": item.ProjectName,
		"ext":         item.Ext,
		"usedByCount": len(item.UsedBy),
		"image": map[string]any{
			"format":   item.Image.Format,
			"width":    item.Image.Width,
			"height":   item.Image.Height,
			"animated": item.Image.Animated,
			"alpha":    item.Image.Alpha,
			"pages":    item.Image.Pages,
			"bytes":    item.Bytes,
		},
		"visual": map[string]any{
			"url":          item.URL,
			"thumbnailUrl": item.ThumbnailURL,
		},
	}
	if item.AITag != nil {
		ai := map[string]any{}
		if item.AITag.Category != "" {
			ai["category"] = item.AITag.Category
		}
		if len(item.AITag.Tags) > 0 {
			ai["tags"] = item.AITag.Tags
		}
		if item.AITag.Description != "" {
			ai["description"] = truncate(item.AITag.Description, 180)
		}
		if len(item.AITag.Languages) > 0 {
			ai["languages"] = item.AITag.Languages
		}
		if len(ai) > 0 {
			summary["ai"] = ai
		}
	}
	if item.OCR != nil && item.OCR.Text != "" {
		summary["ocrText"] = truncate(item.OCR.Text, 180)
	}
	return summary
}

type canvasOCRAnnotationItem struct {
	AssetID      string `json:"assetId"`
	RepoPath     string `json:"repoPath"`
	CardID       string `json:"cardId"`
	FileName     string `json:"fileName"`
	Status       string `json:"status"`
	Text         string `json:"text"`
	ErrorMessage string `json:"errorMessage"`
}

func canvasOCRAnnotationItems(result any) []canvasOCRAnnotationItem {
	raw, err := json.Marshal(result)
	if err != nil {
		return nil
	}
	var decoded struct {
		Items []canvasOCRAnnotationItem `json:"items"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	return decoded.Items
}

func canvasOCRTextAnnotationWorkflowRequested(latestUserMessage string, selectedSkillIDs []string, executed map[string]bool) bool {
	if !executed["add_assets_to_canvas"] {
		return false
	}
	if canvasUserAsksAnnotation(latestUserMessage) {
		return true
	}
	return canvasStringListContains(selectedSkillIDs, canvasSkillComments) && canvasStringListContains(selectedSkillIDs, canvasSkillOCR)
}

func markCanvasOCRResultAsIntermediate(result any) {
	if values, ok := result.(map[string]any); ok {
		values["displayToUser"] = false
		values["useForFollowup"] = "text_annotation"
	}
}

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

func buildCanvasFollowupPrompt(reason string, latestUserMessage string, canvas canvasSnapshot, actions []canvasAction, toolResults []canvasCompactToolResult, completedTools []string, previousAssistantText string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Original User Request\n%s\n\n", latestUserMessage)
	fmt.Fprintf(&b, "## Loop Reason\n%s\n\n", reason)

	cards := compactCanvasRelevantCards(canvas, actions)
	if canvasCompletedToolsContain(completedTools, "duplicate_cards") {
		cards = compactCanvasCards(canvas.Cards, 12)
	}
	if len(cards) > 0 {
		cardJSON, _ := json.Marshal(cards)
		fmt.Fprintf(&b, "## Relevant Canvas Cards\n%s\n\n", string(cardJSON))
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

	b.WriteString("## Required Follow-up\n")
	if canvasToolResultsNeedUserConfirmation(toolResults) {
		b.WriteString("The latest search result is marked needsUserConfirmation=true. Do not call add_assets_to_canvas, arrange_cards, or any other canvas mutation. Answer in chat that no suitable direct match was found, mention that candidate previews are shown for review, and ask the user to confirm which candidate should be added.")
		return b.String()
	}
	b.WriteString(canvasFollowupInstruction(reason, latestUserMessage))
	return b.String()
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
		return "Continue from the compact tool results above. Use the returned IDs exactly. Do not repeat completed tool calls. For duplicate workflows, arrange returned newCardIds but do not remove returned newCardIds as cleanup; remove_cards is only for pre-existing unrelated visible cards. For multi-step operation patterns, call the next distinct missing tool; if the user's request is fulfilled, give a short answer."
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
	latestUserMessage := latestCanvasUserMessage(messages)
	promptCards := canvasPromptRelevantCards(canvas, latestUserMessage, 10)

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
	if len(promptCards) > 0 {
		cardJSON, _ := json.Marshal(compactCanvasCards(promptCards, len(promptCards)))
		fmt.Fprintf(&b, "\n## AI-Readable Canvas Cards JSON\n%s\n", string(cardJSON))
	}

	b.WriteString("\n## Layout Facts\n")
	if options.CanvasImageAttached {
		b.WriteString("- A hidden AI-only screenshot of the current canvas is attached. Use it to judge visual overlap, spacing, scale, and composition before arranging cards.\n")
	}
	b.WriteString("- Asset JSON includes visual.url and visual.thumbnailUrl references for the actual image; use those references or the attached canvas screenshot when visual details matter.\n")
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

	if lang := canvasLatestUserLanguage(latestUserMessage, locale); lang != "" {
		fmt.Fprintf(&b, "\n## Response Language Override\n- The latest user message is written in %s. Use %s only for natural-language assistant text. Keep tool labels, descriptions, impacts, status codes, action metadata, and internal reasoning in English.\n", lang, lang)
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

func canvasNativeToolsEnabled(backend string, tools []llm.ChatTool) bool {
	if len(tools) == 0 {
		return false
	}
	if _, ok := agent.AgentBackendID(backend); ok {
		return false
	}
	return true
}

func canvasNativeToolChoice(tools []llm.ChatTool, loopReason string) string {
	if len(tools) == 0 {
		return ""
	}
	switch loopReason {
	case "initial",
		canvasLoopReasonTruncatedAction,
		canvasLoopReasonMissingCapture,
		canvasLoopReasonTextOnlyDeferredWork,
		canvasLoopReasonFocusOnlyNeedsAnswer,
		canvasLoopReasonCaptureOnlyWork,
		canvasLoopReasonInvalidAction,
		canvasLoopReasonIncompleteTextAnnotation,
		canvasLoopReasonOCRTextExtraction,
		canvasLoopReasonOCRTextAnnotation:
		return "required"
	default:
		return ""
	}
}

func canvasNativeToolsForRound(tools []llm.ChatTool, loopReason string) []llm.ChatTool {
	if loopReason == canvasLoopReasonOCRTextExtraction {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{"extract_ocr_text": true}); len(filtered) > 0 {
			return filtered
		}
	}
	if loopReason == canvasLoopReasonOCRTextAnnotation {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{
			"create_comment": true,
			"remove_cards":   true,
			"arrange_cards":  true,
			"copy_asset":     true,
		}); len(filtered) > 0 {
			return requireCanvasNativeToolParams(filtered, "create_comment", "anchorCardId", "text", "region", "visualCue")
		}
	}
	if loopReason == canvasLoopReasonIncompleteTextAnnotation {
		if filtered := filterCanvasNativeToolsByName(tools, map[string]bool{"create_comment": true}); len(filtered) > 0 {
			return filtered
		}
	}
	if loopReason != canvasLoopReasonFocusOnlyNeedsAnswer {
		if loopReason == "initial" {
			if initialTools := filterCanvasNativeToolsByName(tools, canvasNativeInitialToolNames()); len(initialTools) > 0 {
				return initialTools
			}
		}
		return tools
	}
	filtered := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if canvasToolIsConcreteCanvasWork(tool.Name) {
			filtered = append(filtered, tool)
		}
	}
	if len(filtered) == 0 {
		return tools
	}
	return filtered
}

func requireCanvasNativeToolParams(tools []llm.ChatTool, toolName string, required ...string) []llm.ChatTool {
	out := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if tool.Name != toolName || len(tool.Parameters) == 0 {
			out = append(out, tool)
			continue
		}
		params := make(map[string]any, len(tool.Parameters)+1)
		for key, value := range tool.Parameters {
			params[key] = value
		}
		seen := map[string]bool{}
		nextRequired := make([]string, 0, len(required))
		for _, key := range canvasSchemaRequired(params) {
			if !seen[key] {
				seen[key] = true
				nextRequired = append(nextRequired, key)
			}
		}
		for _, key := range required {
			if !seen[key] {
				seen[key] = true
				nextRequired = append(nextRequired, key)
			}
		}
		params["required"] = nextRequired
		tool.Parameters = params
		out = append(out, tool)
	}
	return out
}

func canvasNativeInitialToolNames() map[string]bool {
	return map[string]bool{
		"focus_card":            true,
		"search_assets":         true,
		"add_assets_to_canvas":  true,
		"get_asset_detail":      true,
		"select_cards":          true,
		"distribute_cards":      true,
		"align_cards":           true,
		"resize_card":           true,
		"move_card":             true,
		"arrange_cards":         true,
		"bring_cards_to_front":  true,
		"duplicate_cards":       true,
		"remove_cards":          true,
		"extract_ocr_text":      true,
		"create_comment":        true,
		"update_comment":        true,
		"delete_comment":        true,
		"capture_viewport":      true,
		"capture_selected":      true,
		"compare_assets":        true,
		"find_similar_assets":   true,
		"inspect_image_quality": true,
		"generate_alt_text":     true,
		"rotate_image":          true,
		"mirror_image":          true,
		"rename_asset":          true,
		"copy_asset":            true,
	}
}

func filterCanvasNativeToolsByName(tools []llm.ChatTool, allowed map[string]bool) []llm.ChatTool {
	if len(allowed) == 0 {
		return tools
	}
	out := make([]llm.ChatTool, 0, len(tools))
	for _, tool := range tools {
		if allowed[tool.Name] {
			out = append(out, tool)
		}
	}
	return out
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

func canvasToolCompletesKnownChain(tool string, executed map[string]bool) bool {
	switch tool {
	case "align_cards":
		return true
	case "bring_cards_to_front":
		return executed["resize_card"] || executed["move_card"] || executed["arrange_cards"]
	case "remove_cards":
		return executed["duplicate_cards"] || executed["search_assets"]
	case "create_comment", "update_comment":
		return true
	case "capture_selected":
		return executed["capture_viewport"] || executed["capture_canvas"]
	case "generate_alt_text":
		return executed["compare_assets"] || executed["find_similar_assets"] || executed["inspect_image_quality"]
	default:
		return false
	}
}

func canvasUserAsksVisualIdentification(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"what is this", "what's this", "what is it", "what's it", "what is this doing", "what are they doing", "identify this", "recognize this",
	)
}

func canvasUserAsksOptimizationReview(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"issue", "problem", "quality", "review", "audit", "delivery", "performance", "file size", "too large",
	)
}

func canvasUserAsksAnnotation(latestUserMessage string) bool {
	return containsAnyText(latestUserMessage,
		"annotate", "annotation", "comment", "comments", "commend", "commends", "add a note", "leave a note", "mark", "mark up", "circle", "highlight", "point to", "pin",
	)
}

func canvasFallbackCommentAllowed(latestUserMessage string, selectedSkillIDs []string) bool {
	return canvasUserAsksAnnotation(latestUserMessage) || canvasStringListContains(selectedSkillIDs, canvasSkillComments)
}

func canvasProposalAllowed(tool string, latestUserMessage string, options canvasChatOptions, nativeToolCall bool) bool {
	if canvasToolSafe(tool) {
		return true
	}
	if options.ImageOptimizationAdvice && isCanvasOptimizationTool(tool) && !canvasUserAsksVisualIdentification(latestUserMessage) {
		return true
	}
	if isCanvasOptimizationTool(tool) {
		return containsAnyText(latestUserMessage,
			"optimize", "optimization", "compress", "resize", "convert", "webp", "avif",
		)
	}
	if isCanvasImageTransformTool(tool) {
		return containsAnyText(latestUserMessage,
			"mirror", "flip", "flipped", "rotate", "rotation", "turn",
		)
	}

	mutationIntent := containsAnyText(latestUserMessage,
		"add", "update", "set", "save", "write", "apply", "change", "edit", "create", "generate",
	)

	switch tool {
	case "update_tags", "batch_update_tags":
		return mutationIntent && containsAnyText(latestUserMessage, "tag", "tags")
	case "update_description":
		return mutationIntent && containsAnyText(latestUserMessage, "description", "describe", "caption")
	case "update_ocr_text":
		return mutationIntent && containsAnyText(latestUserMessage, "ocr", "text")
	case "rename_asset":
		return containsAnyText(latestUserMessage, "rename")
	case "move_asset":
		return containsAnyText(latestUserMessage, "move")
	case "copy_asset":
		return containsAnyText(latestUserMessage, "copy", "duplicate")
	case "delete_asset":
		return containsAnyText(latestUserMessage, "delete", "remove")
	case "favorite_asset", "batch_favorite_assets":
		return containsAnyText(latestUserMessage, "favorite", "favourite")
	case "export_asset":
		return containsAnyText(latestUserMessage, "export", "download")
	default:
		return false
	}
}

func canvasProposalAllowedForAction(act canvasAction, latestUserMessage string, options canvasChatOptions, nativeToolCall bool) bool {
	if act.Tool == "copy_asset" && canvasCopyAssetProposalHasDestination(act) {
		return true
	}
	return canvasProposalAllowed(act.Tool, latestUserMessage, options, nativeToolCall)
}

func canvasCopyAssetProposalHasDestination(act canvasAction) bool {
	if act.Params == nil {
		return false
	}
	if text, ok := act.Params["destPath"].(string); ok && strings.TrimSpace(text) != "" {
		return len(canvasActionAssetIDs(act)) > 0
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok {
		return false
	}
	for _, row := range rows {
		values, ok := row.(map[string]any)
		if !ok {
			return false
		}
		assetID, _ := values["assetId"].(string)
		destPath, _ := values["destPath"].(string)
		if strings.TrimSpace(assetID) == "" || strings.TrimSpace(destPath) == "" {
			return false
		}
	}
	return len(rows) > 0
}

func fillCanvasCopyAssetDestPathsFromOCR(act canvasAction, items []canvasOCRAnnotationItem) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil || len(items) == 0 || canvasCopyAssetProposalHasDestination(act) {
		return act
	}
	assetIDs := canvasActionAssetIDs(act)
	if len(assetIDs) == 0 {
		return act
	}
	byAssetID := map[string]canvasOCRAnnotationItem{}
	for _, item := range items {
		assetID := strings.TrimSpace(item.AssetID)
		if assetID != "" {
			byAssetID[assetID] = item
		}
	}
	destDir, _ := act.Params["destDir"].(string)
	destDir = strings.Trim(strings.TrimSpace(destDir), "/")
	rows := make([]any, 0, len(assetIDs))
	for _, assetID := range assetIDs {
		item, ok := byAssetID[assetID]
		if !ok || strings.TrimSpace(item.Text) == "" {
			continue
		}
		fileName := canvasTextDerivedCopyFileName(item.Text, item.FileName)
		destPath := fileName
		if destDir != "" {
			destPath = path.Join(destDir, fileName)
		}
		rows = append(rows, map[string]any{
			"assetId":  assetID,
			"destPath": destPath,
		})
	}
	if len(rows) == 0 {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = rows
	return next
}

func sanitizeCanvasCopyAssetDestPathsFromOCR(act canvasAction, items []canvasOCRAnnotationItem) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil || len(items) == 0 {
		return act
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) == 0 {
		return act
	}
	byAssetID := map[string]canvasOCRAnnotationItem{}
	for _, item := range items {
		assetID := strings.TrimSpace(item.AssetID)
		if assetID != "" {
			byAssetID[assetID] = item
		}
	}
	nextRows := make([]any, 0, len(rows))
	changed := false
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			nextRows = append(nextRows, raw)
			continue
		}
		nextRow := make(map[string]any, len(row))
		for key, value := range row {
			nextRow[key] = value
		}
		assetID, _ := row["assetId"].(string)
		destPath, _ := row["destPath"].(string)
		item, found := byAssetID[strings.TrimSpace(assetID)]
		if found && canvasCopyDestPathStem(destPath) == strings.TrimSpace(item.Text) {
			safeFileName := canvasTextDerivedCopyFileName(item.Text, item.FileName)
			if safeFileName != destPath {
				nextRow["destPath"] = safeFileName
				changed = true
			}
		}
		nextRows = append(nextRows, nextRow)
	}
	if !changed {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = nextRows
	return next
}

func canvasCopyDestPathStem(destPath string) string {
	destPath = strings.TrimSpace(destPath)
	ext := filepath.Ext(destPath)
	if ext == "" {
		return destPath
	}
	return strings.TrimSuffix(destPath, ext)
}

func normalizeCanvasCopyAssetDestPaths(act canvasAction) canvasAction {
	if act.Tool != "copy_asset" || act.Params == nil {
		return act
	}
	rows, ok := act.Params["perAssetDestPaths"].([]any)
	if !ok || len(rows) == 0 {
		return act
	}
	used := map[string]bool{}
	nextRows := make([]any, 0, len(rows))
	changed := false
	var rowAssetIDs []string
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			nextRows = append(nextRows, raw)
			continue
		}
		assetID, _ := row["assetId"].(string)
		assetID = strings.TrimSpace(assetID)
		if assetID != "" {
			rowAssetIDs = append(rowAssetIDs, assetID)
		}
		destPath, _ := row["destPath"].(string)
		destPath = strings.TrimSpace(destPath)
		uniqueDestPath := uniqueCanvasCopyDestPath(destPath, used)
		if uniqueDestPath != destPath {
			changed = true
		}
		nextRow := make(map[string]any, len(row))
		for key, value := range row {
			nextRow[key] = value
		}
		nextRow["destPath"] = uniqueDestPath
		nextRows = append(nextRows, nextRow)
	}
	if len(canvasActionAssetIDs(act)) == 0 && len(rowAssetIDs) > 0 {
		changed = true
	}
	if !changed {
		return act
	}
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["perAssetDestPaths"] = nextRows
	if len(canvasActionAssetIDs(next)) == 0 && len(rowAssetIDs) > 0 {
		setCanvasActionAssetIDs(&next, rowAssetIDs)
	}
	return next
}

func canvasTextDerivedCopyFileName(text string, fallbackFileName string) string {
	ext := strings.TrimSpace(filepath.Ext(fallbackFileName))
	if ext == "" {
		ext = ".png"
	}
	base := strings.TrimSpace(text)
	var b strings.Builder
	for _, r := range base {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			b.WriteRune('_')
		default:
			if r < 32 {
				b.WriteRune('_')
			} else {
				b.WriteRune(r)
			}
		}
	}
	name := strings.Trim(strings.TrimSpace(b.String()), ". ")
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(fallbackFileName), filepath.Ext(fallbackFileName))
	}
	if name == "" {
		name = "asset"
	}
	name = truncate(name, 120)
	if filepath.Ext(name) != "" {
		return name
	}
	return name + ext
}

func uniqueCanvasCopyDestPath(destPath string, used map[string]bool) string {
	if destPath == "" {
		return destPath
	}
	candidate := destPath
	for index := 1; ; index++ {
		key := strings.ToLower(candidate)
		if !used[key] {
			used[key] = true
			return candidate
		}
		ext := filepath.Ext(destPath)
		stem := strings.TrimSuffix(destPath, ext)
		candidate = fmt.Sprintf("%s-%d%s", stem, index+1, ext)
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
	byID := map[string]canvasCardSnapshot{}
	for _, card := range canvas.Cards {
		byID[card.ID] = card
	}
	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		if id = strings.TrimSpace(id); id == "" || seen[id] {
			return
		}
		card, ok := byID[id]
		if !ok {
			return
		}
		if card.Kind != "asset" && card.Kind != "upload" && card.Kind != "variant" {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, id := range canvas.SelectedCardIDs {
		card, ok := byID[id]
		if !ok {
			continue
		}
		if card.Kind == "comment" {
			add(card.AnchorID)
			continue
		}
		add(card.ID)
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

func filterCanvasRemoveActionProtectedCards(act canvasAction, protected map[string]bool) canvasAction {
	if act.Tool != "remove_cards" || len(protected) == 0 {
		return act
	}
	var filtered []string
	for _, id := range canvasActionCardIDs(act) {
		if protected[id] {
			continue
		}
		filtered = append(filtered, id)
	}
	setCanvasActionCardIDs(&act, filtered)
	return act
}

func canvasCleanupCandidateCardIDs(canvas canvasSnapshot, protected map[string]bool) []string {
	var ids []string
	for _, card := range canvas.Cards {
		if protected[card.ID] {
			continue
		}
		if card.Kind != "asset" && card.Kind != "upload" && card.Kind != "variant" {
			continue
		}
		ids = append(ids, card.ID)
	}
	return ids
}

func normalizeCanvasImageRegionAction(act canvasAction, canvas canvasSnapshot) canvasAction {
	if !canvasToolHasImageRegion(act.Tool) || act.Params == nil {
		return act
	}
	rawRegion, ok := act.Params["region"]
	if !ok {
		return act
	}
	region, ok := canvasRegionFromValue(rawRegion)
	if !ok {
		return act
	}
	anchor := canvasImageRegionAnchorCard(act, canvas)
	if anchor != nil && canvasRegionLooksPixelBased(region) {
		width, height := canvasCardImageDisplaySize(*anchor)
		if width > 0 && height > 0 {
			region.X /= width
			region.Width /= width
			region.Y /= height
			region.Height /= height
		}
	}
	region = clampCanvasRegion(region)
	next := act
	next.Params = cloneCanvasActionParams(act.Params)
	next.Params["region"] = map[string]any{
		"x":      region.X,
		"y":      region.Y,
		"width":  region.Width,
		"height": region.Height,
	}
	return next
}

func canvasToolHasImageRegion(tool string) bool {
	switch tool {
	case "create_comment", "update_comment":
		return true
	default:
		return false
	}
}

func canvasImageRegionAnchorCard(act canvasAction, canvas canvasSnapshot) *canvasCardSnapshot {
	if act.Params == nil {
		return nil
	}
	switch act.Tool {
	case "create_comment":
		anchorID, _ := act.Params["anchorCardId"].(string)
		return canvasCardByID(canvas, anchorID)
	case "update_comment":
		commentID, _ := act.Params["commentCardId"].(string)
		comment := canvasCardByID(canvas, commentID)
		if comment == nil || comment.AnchorID == "" {
			return nil
		}
		return canvasCardByID(canvas, comment.AnchorID)
	default:
		return nil
	}
}

func canvasCardByID(canvas canvasSnapshot, id string) *canvasCardSnapshot {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	for i := range canvas.Cards {
		if canvas.Cards[i].ID == id {
			return &canvas.Cards[i]
		}
	}
	return nil
}

func canvasRegionFromValue(value any) (canvasRegion, bool) {
	raw, ok := value.(map[string]any)
	if !ok {
		return canvasRegion{}, false
	}
	number := func(key string) (float64, bool) {
		switch v := raw[key].(type) {
		case float64:
			return v, true
		case int:
			return float64(v), true
		case json.Number:
			n, err := v.Float64()
			return n, err == nil
		case string:
			n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			return n, err == nil
		default:
			return 0, false
		}
	}
	x, okX := number("x")
	y, okY := number("y")
	width, okWidth := number("width")
	height, okHeight := number("height")
	if !okX || !okY || !okWidth || !okHeight {
		return canvasRegion{}, false
	}
	return canvasRegion{X: x, Y: y, Width: width, Height: height}, true
}

func canvasRegionLooksPixelBased(region canvasRegion) bool {
	return region.X > 1 || region.Y > 1 || region.Width > 1 || region.Height > 1
}

func clampCanvasRegion(region canvasRegion) canvasRegion {
	region.Width = min(max(region.Width, 0.02), 1)
	region.Height = min(max(region.Height, 0.02), 1)
	region.X = min(max(region.X, 0), 1-region.Width)
	region.Y = min(max(region.Y, 0), 1-region.Height)
	return region
}

func canvasCardImageDisplaySize(card canvasCardSnapshot) (float64, float64) {
	width := card.Width
	if width <= 0 {
		width = 320
	}
	if card.Height > 0 {
		return width, card.Height
	}
	if card.Asset != nil && card.Asset.Width > 0 && card.Asset.Height > 0 {
		return width, width * float64(card.Asset.Height) / float64(card.Asset.Width)
	}
	if card.UploadWidth > 0 && card.UploadHeight > 0 {
		return width, width * float64(card.UploadHeight) / float64(card.UploadWidth)
	}
	return width, 240
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
		"capture", "screenshot", "photo", "picture", "export", "download",
	)
}

func canvasFollowupShouldRetainImages(reason string, latestUserMessage string) bool {
	if reason == canvasLoopReasonMissingCapture {
		return true
	}
	if reason == canvasLoopReasonFocusOnlyNeedsAnswer {
		return true
	}
	if reason == canvasLoopReasonIncompleteTextAnnotation {
		return true
	}
	if reason == canvasLoopReasonOCRTextExtraction {
		return true
	}
	if reason == canvasLoopReasonOCRTextAnnotation {
		return true
	}
	if canvasUserWantsCanvasAction(latestUserMessage) && (reason == canvasLoopReasonFocusOnlyNeedsAnswer || reason == canvasLoopReasonTextOnlyDeferredWork || reason == canvasLoopReasonCaptureOnlyWork) {
		return true
	}
	return containsAnyText(latestUserMessage,
		"look at", "inspect", "compare", "analyze", "analyse", "describe",
		"what is in", "what's in", "visual", "image quality", "quality issue",
	)
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

func refineCanvasActionTargets(actions []canvasAction, canvas canvasSnapshot, latestUserMessage string) []canvasAction {
	return actions
}

func cloneStringBoolMap(values map[string]bool) map[string]bool {
	next := make(map[string]bool, len(values))
	for key, value := range values {
		next[key] = value
	}
	return next
}

func cloneCanvasActionParams(params map[string]any) map[string]any {
	next := make(map[string]any, len(params))
	for key, value := range params {
		next[key] = value
	}
	return next
}

func canvasTextHasExplicitRotationDegrees(text string) bool {
	return containsAnyText(text,
		"90", "180", "270",
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
	if canvasLatestUserLanguage(latestUserMessage, locale) != "" {
		selectedSkillIDs = canvasAllSkillIDs()
	}
	canvasTools := canvasLLMToolsForSkills(selectedSkillIDs)
	usingNativeTools := canvasNativeToolsEnabled(backend, canvasTools)
	systemPrompt := canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	if usingNativeTools {
		canvasTools = canvasNativeLLMToolsForSkills(selectedSkillIDs)
		systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	} else {
		canvasTools = nil
	}
	userPrompt := buildCanvasUserPrompt(req.Messages, req.Canvas, req.Options, locale)

	var images []vlmImage
	var canvasImage *vlmImage
	if req.CanvasImage != "" {
		path, cleanup, err := canvasImageTempFile(req.CanvasImage)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_canvas_image"))
			return
		}
		defer cleanup()
		canvasImage = &vlmImage{Path: path, Ext: ".png"}
	}
	imageLimit := 4
	useSelectedCoordinateGrid := len(selectedCanvasImageCardIDs(req.Canvas)) == 1
	selectedImageLimit := imageLimit
	if canvasImage != nil {
		selectedImageLimit--
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
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(item.LocalPath); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: item.LocalPath, Ext: item.Ext})
		if len(images) >= selectedImageLimit {
			break
		}
	}
	for _, card := range req.Canvas.Cards {
		if len(images) >= selectedImageLimit {
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
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(download.Path); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
	}
	if canvasImage != nil && len(images) < imageLimit {
		images = append(images, *canvasImage)
	}
	for _, token := range req.AttachmentTokens {
		if len(images) >= imageLimit {
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
		})
		time.Sleep(800 * time.Millisecond)
	}
	sendNDJSON(w, map[string]any{"type": "thinking"})

	const maxToolLoops = 5
	currentPrompt := userPrompt
	proposalIndex := 0
	captureRequested := canvasCaptureRequested(latestUserMessage)
	executedCaptureTools := map[string]bool{}
	var totalInputTokens, totalOutputTokens int64
	start := time.Now()

	const canvasOutputTokenLimit = 900
	promptKind := vlmPromptKindFull
	loopReason := "initial"
	var loopStats []vlmChatRoundStats
	generatedImagePaths := map[string]bool{}
	concreteCanvasActionSeen := false
	preparatoryActionLoops := 0
	textEmitted := false
	var addedCatalogItemsForAnswer []scanner.AssetItem
	var createdCommentTexts []string
	executedCanvasTools := map[string]bool{}
	executedCanvasActionKeys := map[string]bool{}
	executedCanvasTextRegionKeys := map[string]bool{}
	cleanupProtectedCardIDs := map[string]bool{}
	var executedCanvasToolSequence []string
	textAnnotationRepairPending := false
	textAssetSearchSeen := false
	ocrTextAnnotationRepairPending := false
	var latestOCRAnnotationItems []canvasOCRAnnotationItem
	protectCleanupCardIDs := func(ids []string) {
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id != "" {
				cleanupProtectedCardIDs[id] = true
			}
		}
	}
	canvasActionAlreadyExecuted := func(act canvasAction) bool {
		key := canvasActionExecutionKey(act)
		if key == "" {
			return false
		}
		return executedCanvasActionKeys[key]
	}
	rememberExecutedCanvasAction := func(act canvasAction) {
		if strings.TrimSpace(act.Tool) == "" {
			return
		}
		executedCanvasTools[act.Tool] = true
		executedCanvasToolSequence = append(executedCanvasToolSequence, act.Tool)
		if key := canvasActionExecutionKey(act); key != "" {
			executedCanvasActionKeys[key] = true
		}
	}
	for loop := 0; loop < maxToolLoops; loop++ {
		roundTools := canvasTools
		roundToolChoice := ""
		if usingNativeTools {
			roundTools = canvasNativeToolsForRound(canvasTools, loopReason)
			roundToolChoice = canvasNativeToolChoice(roundTools, loopReason)
		}
		round := s.chatVLMRound(r.Context(), vlmChatRoundRequest{
			Images:           images,
			Backend:          backend,
			ModelName:        modelName,
			SystemPrompt:     systemPrompt,
			Prompt:           currentPrompt,
			Purpose:          "canvas",
			TimeoutSec:       canvasOutputTokenLimit,
			Tools:            roundTools,
			ToolChoice:       roundToolChoice,
			ImageDetail:      "high",
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
			textBody = ""
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
		if usingNativeTools && len(chatResp.ToolCalls) > 0 && len(toolCallActions) == 0 && strings.TrimSpace(content) == "" {
			for _, call := range chatResp.ToolCalls {
				invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
					Tool:   call.Name,
					Reason: "unknown or unsupported native tool call",
				})
			}
		}
		actions = expandCanvasMultiSelectedActions(actions, req.Canvas, latestUserMessage)
		actions = refineCanvasActionTargets(actions, req.Canvas, latestUserMessage)
		actions = refineCanvasSearchActions(actions, latestUserMessage)
		actions = filterCanvasIncidentalCatalogSearchActions(actions)
		var postExpansionIssues []canvasActionValidationIssue
		actions, postExpansionIssues = normalizeCanvasActions(actions, true)
		var blockedUnverifiableTextActionCount int
		actions, blockedUnverifiableTextActionCount = filterCanvasUnverifiableTextMentionActions(actions, req.Canvas)
		var missingVisualCueIssues []canvasActionValidationIssue
		actions, missingVisualCueIssues = filterCanvasFallbackImageRegionActionsMissingVisualCue(actions, toolUseSource != "native_tool_call")
		var blockedIncompleteTextActionCount int
		actions, blockedIncompleteTextActionCount = filterCanvasIncompleteTextAnnotationActions(actions, loopReason, textAnnotationRepairPending)
		var blockedOCRTextAnnotationActionCount int
		actions, blockedOCRTextAnnotationActionCount = filterCanvasOCRTextAnnotationActions(actions, loopReason)
		invalidActionIssues = append(invalidActionIssues, postExpansionIssues...)
		invalidActionIssues = append(invalidActionIssues, missingVisualCueIssues...)
		if usingNativeTools && len(chatResp.ToolCalls) > 0 && len(actions) == 0 && strings.TrimSpace(content) == "" {
			invalidActionIssues = append(invalidActionIssues, canvasActionValidationIssue{
				Tool:   "native_tool_call",
				Reason: "native tool calls did not produce executable canvas actions: " + strings.Join(canvasActionToolNames(toolCallActions), ", "),
			})
		}
		invalidActionNeedsRepair := len(invalidActionIssues) > 0 && loop < maxToolLoops-1
		loopStats[statIndex].ActionCount = len(actions)
		loopStats[statIndex].InvalidActionCount = len(invalidActionIssues)
		loopStats[statIndex].InvalidActionIssues = invalidActionIssues
		hasCaptureAction := false
		for _, act := range actions {
			if canvasToolIsCapture(act.Tool) {
				hasCaptureAction = true
				break
			}
		}
		missingCapture := captureRequested && len(executedCaptureTools) == 0 && !hasCaptureAction && loop < maxToolLoops-1

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
		executedTextAnnotation := false
		ocrTextExtractionNeededThisLoop := false
		ocrTextAnnotationNeededThisLoop := false
		blockedGenericTextRegionCount := 0
		var executedCommentResults []canvasCompactToolResult
		for _, issue := range invalidActionIssues {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", issue))
		}
		for i := 0; i < blockedUnverifiableTextActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "comment mentioned OCR/text content but did not include a verifiable visualCue for either the non-text target or the text characters",
			}))
		}
		for i := 0; i < blockedIncompleteTextActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "text annotation repair requires a create_comment whose visualCue.targetDescription identifies text, letters, words, glyphs, or characters and whose visualCue.colorHex provides the text pixel color",
			}))
		}
		for i := 0; i < blockedOCRTextAnnotationActionCount; i++ {
			compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
				Tool:   "create_comment",
				Reason: "OCR text annotation repair requires create_comment with a text visualCue, remove_cards for non-text results, arrange_cards for layout, or copy_asset with perAssetDestPaths when the original request asks for text-derived filenames",
			}))
		}
		for _, act := range actions {
			if act.Tool == "search_assets" && canvasSearchActionRequestsOCRText(act) {
				textAssetSearchSeen = true
			}
			if act.Tool == "remove_cards" {
				requestedRemoveIDs := canvasActionCardIDs(act)
				act = filterCanvasRemoveActionProtectedCards(act, cleanupProtectedCardIDs)
				if len(canvasActionCardIDs(act)) == 0 && len(requestedRemoveIDs) > 0 && executedCanvasTools["duplicate_cards"] {
					setCanvasActionCardIDs(&act, canvasCleanupCandidateCardIDs(req.Canvas, cleanupProtectedCardIDs))
				}
				if len(canvasActionCardIDs(act)) == 0 {
					continue
				}
			}
			act = normalizeCanvasImageRegionAction(act, req.Canvas)
			act = s.refineCanvasImageRegionAction(r.Context(), act, req.Canvas)
			act = fillCanvasCopyAssetDestPathsFromOCR(act, latestOCRAnnotationItems)
			act = sanitizeCanvasCopyAssetDestPathsFromOCR(act, latestOCRAnnotationItems)
			act = normalizeCanvasCopyAssetDestPaths(act)
			if loopReason == canvasLoopReasonOCRTextAnnotation && act.Tool == "create_comment" && canvasActionTargetsTextRegion(act) && canvasActionHasGenericPlaceholderRegion(act) {
				blockedGenericTextRegionCount++
				compactToolResults = append(compactToolResults, compactCanvasToolResult("invalid_action", canvasActionValidationIssue{
					Tool:   "create_comment",
					Reason: "OCR text annotation still used a generic placeholder region after image refinement; provide a specific box around the visible text pixels",
				}))
				continue
			}
			if canvasActionAlreadyExecuted(act) {
				continue
			}
			if key := canvasTextRegionActionDedupeKey(act, req.Canvas); key != "" {
				if executedCanvasTextRegionKeys[key] {
					continue
				}
				executedCanvasTextRegionKeys[key] = true
			}
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
				})
				rememberExecutedCanvasAction(act)
				time.Sleep(300 * time.Millisecond)
				continue
			}
			if act.Tool == "create_comment" && toolUseSource != "native_tool_call" && !canvasFallbackCommentAllowed(latestUserMessage, selectedSkillIDs) {
				blockedCommentNeedsAnswer = true
				blockedCommentCount++
				continue
			}
			if canvasToolSafe(act.Tool) {
				if canvasToolIsCapture(act.Tool) {
					if executedCaptureTools[act.Tool] {
						continue
					}
					executedCaptureTools[act.Tool] = true
					captureExecutedThisLoop = true
				}
				result := s.executeCanvasSafeAction(r, act, settings, req.Canvas)
				if act.Tool == "extract_ocr_text" && canvasOCRTextAnnotationWorkflowRequested(latestUserMessage, selectedSkillIDs, executedCanvasTools) {
					markCanvasOCRResultAsIntermediate(result)
					if items := canvasOCRAnnotationItems(result); len(items) > 0 {
						latestOCRAnnotationItems = items
						if !executedCanvasTools["create_comment"] {
							ocrTextAnnotationNeededThisLoop = true
						}
					}
					if len(latestOCRAnnotationItems) > 0 && !executedCanvasTools["create_comment"] {
						ocrTextAnnotationNeededThisLoop = true
					}
					compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
				}
				executedActionCount++
				safeActionCount++
				sendNDJSON(w, map[string]any{
					"type":   "action_result",
					"tool":   act.Tool,
					"result": result,
				})
				if act.Tool == "add_assets_to_canvas" {
					addedCatalogItemsForAnswer = appendCanvasAssetItemsUnique(addedCatalogItemsForAnswer, canvasAssetItemsFromActionResult(result))
				}
				if act.Tool == "duplicate_cards" {
					if values, ok := result.(map[string]any); ok {
						protectCleanupCardIDs(canvasParamStringSlice(values["cardIds"]))
						protectCleanupCardIDs(canvasParamStringSlice(values["newCardIds"]))
					}
				}
				if act.Tool == "create_comment" {
					if values, ok := result.(map[string]any); ok {
						if text, ok := values["text"].(string); ok && strings.TrimSpace(text) != "" {
							createdCommentTexts = append(createdCommentTexts, strings.TrimSpace(text))
						}
					}
					if canvasActionTargetsTextRegion(act) {
						executedTextAnnotation = true
					}
					executedCommentResults = append(executedCommentResults, compactCanvasToolResult(act.Tool, result))
				}
				rememberExecutedCanvasAction(act)
				if canvasToolSuppressesSameTurnText(act.Tool) {
					nonFocusToolExecutedThisLoop = true
				}
				if canvasToolIsConcreteCanvasWork(act.Tool) {
					concreteCanvasActionSeen = true
				}
				if act.Tool != "extract_ocr_text" {
					if !canvasToolIsCapture(act.Tool) {
						nonCaptureToolExecutedThisLoop = true
					}
					if !canvasToolCompletesKnownChain(act.Tool, executedCanvasTools) {
						compactToolResults = append(compactToolResults, compactCanvasToolResult(act.Tool, result))
					}
				}
			} else {
				if !canvasProposalAllowedForAction(act, latestUserMessage, req.Options, toolUseSource == "native_tool_call") {
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
					"params":         canvasActionStreamParams(act.Params),
					"description":    canvasToolDescription(act.Tool),
					"impact":         "Requires confirmation before applying.",
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

		requiredNativeToolCallMissing := canvasRequiredNativeToolCallMissing(usingNativeTools, roundToolChoice, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionBlockTextNeedsRepair := canvasActionBlockTextNeedsActionRepair(usingNativeTools, loopReason, textBody, len(actions), nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		actionRequestNeedsTool := requiredNativeToolCallMissing || actionBlockTextNeedsRepair || canvasTextOnlyResponseNeedsActionRepair(textBody, nonFocusToolExecutedThisLoop, loop, maxToolLoops)
		incompleteTextAnnotation := blockedUnverifiableTextActionCount > 0 || blockedIncompleteTextActionCount > 0 || blockedGenericTextRegionCount > 0 || canvasIncompleteTextAnnotationNeedsRepair(actions, req.Canvas, loop, maxToolLoops)
		if executedTextAnnotation {
			textAnnotationRepairPending = false
		}
		if textAnnotationRepairPending && !executedTextAnnotation {
			incompleteTextAnnotation = true
		}
		if incompleteTextAnnotation {
			textAnnotationRepairPending = true
		}
		if textAssetSearchSeen &&
			executedCanvasTools["add_assets_to_canvas"] &&
			!executedCanvasTools["extract_ocr_text"] &&
			!executedCanvasTools["create_comment"] &&
			canvasStringListContains(selectedSkillIDs, canvasSkillComments) &&
			loop < maxToolLoops-1 {
			ocrTextExtractionNeededThisLoop = true
		}
		ocrTextAnnotation := ocrTextAnnotationNeededThisLoop
		if blockedOCRTextAnnotationActionCount > 0 {
			ocrTextAnnotation = true
		}
		if executedTextAnnotation {
			ocrTextAnnotationRepairPending = false
		}
		if ocrTextAnnotationRepairPending && !executedTextAnnotation {
			ocrTextAnnotation = true
		}
		if ocrTextAnnotation {
			ocrTextAnnotationRepairPending = true
		}
		if incompleteTextAnnotation {
			compactToolResults = append(compactToolResults, executedCommentResults...)
		}
		if canvasUserWantsCanvasAction(latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen {
			preparatoryActionLoops++
		}
		focusOnlyNeedsAnswer := (canvasActionsOnlyFocus(actions) || (canvasUserWantsCanvasAction(latestUserMessage) && canvasActionsOnlyPreparatory(actions) && !concreteCanvasActionSeen)) && !actionRequestNeedsTool && loop < maxToolLoops-1 && (textBody == "" || canvasUserWantsCanvasAction(latestUserMessage))
		if incompleteTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if ocrTextAnnotation {
			invalidActionNeedsRepair = false
			focusOnlyNeedsAnswer = false
		}
		if textBody != "" && !truncatedAction && !nonFocusToolExecutedThisLoop && !actionRequestNeedsTool && !focusOnlyNeedsAnswer && !invalidActionNeedsRepair && !incompleteTextAnnotation && !textAnnotationRepairPending && !ocrTextAnnotation && !ocrTextAnnotationRepairPending && len(addedCatalogItemsForAnswer) == 0 {
			paragraphs := splitParagraphs(textBody)
			for _, p := range paragraphs {
				sendNDJSON(w, map[string]any{"type": "text", "content": p})
				textEmitted = true
				if len(paragraphs) > 1 {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}

		captureResultNeedsFollowup := captureExecutedThisLoop && len(compactToolResults) > 0 && !nonCaptureToolExecutedThisLoop && loop < maxToolLoops-1
		captureOnlyDeferredWork := false
		if captureExecutedThisLoop && !truncatedAction && !captureResultNeedsFollowup {
			break
		}
		if proposalCount > 0 && !truncatedAction {
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
			IncompleteTextAnnotation:  incompleteTextAnnotation,
			OCRTextExtraction:         ocrTextExtractionNeededThisLoop,
			OCRTextAnnotation:         ocrTextAnnotation,
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
			canvasTools = canvasNativeLLMToolsForSkills(selectedSkillIDs)
			systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		} else {
			canvasTools = nil
			systemPrompt = canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
		}
		currentPrompt = buildCanvasFollowupPrompt(nextLoopReason, latestUserMessage, req.Canvas, actions, compactToolResults, executedCanvasToolSequence, content)
		promptKind = vlmPromptKindFollowup
		loopReason = nextLoopReason
		sendNDJSON(w, map[string]any{"type": "thinking"})
	}

	if !executedCanvasTools["arrange_cards"] && len(addedCatalogItemsForAnswer) > 1 {
		act := canvasArrangeAddedCatalogItemsAction(addedCatalogItemsForAnswer)
		if status := canvasActionStatusMessage(act); status != "" {
			sendNDJSON(w, map[string]any{
				"type":    "status",
				"phase":   "operation",
				"content": status,
			})
		}
		result := s.executeCanvasSafeAction(r, act, settings, req.Canvas)
		sendNDJSON(w, map[string]any{
			"type":   "action_result",
			"tool":   act.Tool,
			"result": result,
		})
		rememberExecutedCanvasAction(act)
	}

	if !textEmitted && !textAnnotationRepairPending && !ocrTextAnnotationRepairPending {
		if answer := canvasCreatedCommentsAnswerText(createdCommentTexts, locale); answer != "" {
			sendNDJSON(w, map[string]any{"type": "text", "content": answer})
			textEmitted = true
		}
	}

	if !textEmitted {
		if answer := canvasAddedAssetsAnswerText(addedCatalogItemsForAnswer, locale); answer != "" {
			sendNDJSON(w, map[string]any{"type": "text", "content": answer})
			textEmitted = true
		}
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

func canvasArrangeAddedCatalogItemsAction(items []scanner.AssetItem) canvasAction {
	const (
		cols   = 4
		startX = 100
		startY = 100
		gapX   = 380
		gapY   = 340
	)
	positions := make([]any, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.ID == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		index := len(positions)
		positions = append(positions, map[string]any{
			"cardId": item.ID,
			"x":      float64(startX + (index%cols)*gapX),
			"y":      float64(startY + (index/cols)*gapY),
		})
	}
	return canvasAction{
		Tool:        "arrange_cards",
		Params:      map[string]any{"positions": positions},
		Description: "Arrange newly added catalog assets",
		Impact:      "Places newly added cards into a scannable layout on the canvas",
	}
}

func canvasActionExecutionKey(act canvasAction) string {
	tool := strings.TrimSpace(act.Tool)
	if tool == "" {
		return ""
	}
	params, err := json.Marshal(canvasActionStreamParams(act.Params))
	if err != nil {
		return tool
	}
	return tool + ":" + string(params)
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

func (s *Server) canvasSemanticCatalogSearch(ctx context.Context, scanID int64, q string, limit int, settings config.AppSettings) ([]scanner.AssetItem, bool) {
	if s.llmProvider == nil || strings.TrimSpace(settings.LLMEmbedModel) == "" {
		return nil, false
	}
	if limit <= 0 {
		limit = 12
	}
	query := semantic.Query{
		Text:       q,
		Type:       "hybrid",
		Limit:      limit,
		ProjectIDs: s.store.ActiveProjectIDs(),
	}
	if len(query.ProjectIDs) == 0 {
		query.ProjectIDs = nil
	}
	response, err := semantic.Search(ctx, s.store, s.llmProvider, settings, query)
	if err != nil || len(response.Results) == 0 {
		return nil, false
	}
	ids := make([]string, 0, len(response.Results))
	for _, result := range response.Results {
		if strings.TrimSpace(result.AssetID) != "" {
			ids = append(ids, result.AssetID)
		}
	}
	items, err := s.fetchCanvasCatalogItemsByIDs(ctx, scanID, ids, settings)
	if err != nil || len(items) == 0 {
		return nil, false
	}
	byID := make(map[string]scanner.AssetItem, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]scanner.AssetItem, 0, len(ids))
	for _, id := range ids {
		if item, ok := byID[id]; ok {
			ordered = append(ordered, item)
		}
	}
	if len(ordered) == 0 {
		return nil, false
	}
	return ordered, true
}

func canvasSearchOCRStatus(hasText bool) string {
	if hasText {
		return "ocrTextReady"
	}
	return ""
}

func canvasSearchTextQueryIsGeneric(q string) bool {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return true
	}
	q = strings.ReplaceAll(q, "-", " ")
	q = strings.ReplaceAll(q, "_", " ")
	q = strings.Join(strings.Fields(q), " ")
	switch q {
	case "text", "visible text", "readable text", "ocr", "ocr text", "has text", "with text":
		return true
	default:
		return false
	}
}

func canvasFilterCatalogItemsWithOCRText(items []scanner.AssetItem) []scanner.AssetItem {
	if len(items) == 0 {
		return items
	}
	out := items[:0]
	for _, item := range items {
		if item.OCR != nil && strings.TrimSpace(item.OCR.Text) != "" {
			out = append(out, item)
		}
	}
	return out
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
		hasText, _ := act.Params["hasText"].(bool)
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
		candidates := canvasSearchQueryCandidates(q)
		if hasText && canvasSearchTextQueryIsGeneric(q) {
			candidates = []string{""}
		}
		searchCatalog := func(candidates []string) (config.CatalogItemsPage, string, error) {
			var result config.CatalogItemsPage
			var matchedQ string
			for _, candidate := range candidates {
				query := config.CatalogItemQuery{
					ScanID:      scanID,
					Query:       candidate,
					AIOcrStatus: canvasSearchOCRStatus(hasText),
					Limit:       fetchLimit,
				}
				result, err = s.store.CatalogItems(query)
				if err != nil {
					return result, matchedQ, err
				}
				if result.Total > 0 {
					matchedQ = candidate
					break
				}
			}
			return result, matchedQ, nil
		}
		page, matchedQ, err := searchCatalog(candidates)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		if matchedQ != "" {
			q = matchedQ
		}
		if page.Total == 0 && strings.TrimSpace(q) != "" && !hasText {
			candidatePage, candidateQ, err := searchCatalog(canvasAdditionalCatalogSearchCandidates(candidates))
			if err != nil {
				return map[string]any{"items": []any{}, "error": err.Error()}
			}
			if candidatePage.Total > 0 {
				candidateItems, err := s.enrichCanvasCatalogItems(r.Context(), scanID, candidatePage.Items, settings)
				if err != nil {
					return map[string]any{"items": []any{}, "error": err.Error()}
				}
				candidateItems = canvasRankCatalogSearchItems(candidateItems, candidateQ)
				if len(candidateItems) > limit {
					candidateItems = candidateItems[:limit]
				}
				return map[string]any{
					"items":                 []scanner.AssetItem{},
					"candidatePreviews":     candidateItems,
					"candidateCount":        len(candidateItems),
					"candidateQ":            candidateQ,
					"total":                 0,
					"q":                     q,
					"matchType":             "catalog_candidate",
					"hasText":               hasText,
					"needsUserConfirmation": true,
					"reason":                "No direct catalog match was found. Expanded matches are shown only for user confirmation.",
				}
			}
		}
		items, err := s.enrichCanvasCatalogItems(r.Context(), scanID, page.Items, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		if hasText {
			items = canvasFilterCatalogItemsWithOCRText(items)
		}
		items = canvasRankCatalogSearchItems(items, q)
		matchType := "catalog"
		if len(items) == 0 && strings.TrimSpace(q) != "" {
			if semanticItems, ok := s.canvasSemanticCatalogSearch(r.Context(), scanID, q, limit, settings); ok {
				if canvasSemanticSearchNeedsUserConfirmation(q, semanticItems) {
					if len(semanticItems) > limit {
						semanticItems = semanticItems[:limit]
					}
					return map[string]any{
						"items":                 []scanner.AssetItem{},
						"candidatePreviews":     semanticItems,
						"candidateCount":        len(semanticItems),
						"total":                 0,
						"q":                     q,
						"matchType":             "semantic_candidate",
						"hasText":               hasText,
						"needsUserConfirmation": true,
						"reason":                "Semantic matches had no direct metadata overlap with the query. They are shown only for user confirmation.",
					}
				}
				items = semanticItems
				if hasText {
					items = canvasFilterCatalogItemsWithOCRText(items)
				}
				matchType = "semantic"
			}
		}
		if len(items) > limit {
			items = items[:limit]
		}
		return map[string]any{"items": items, "total": len(items), "q": q, "matchType": matchType, "hasText": hasText}
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
		return map[string]any{"items": items, "count": len(items), "assetIds": assetIDs}
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
			"region":        act.Params["region"],
		}
	case "delete_comment":
		return map[string]any{
			"commentCardId": act.Params["commentCardId"],
		}
	case "select_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
		}
	case "remove_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
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
		}
	case "distribute_cards":
		return map[string]any{
			"cardIds":   act.Params["cardIds"],
			"direction": act.Params["direction"],
			"gap":       act.Params["gap"],
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

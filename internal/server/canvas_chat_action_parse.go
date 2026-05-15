package server

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

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

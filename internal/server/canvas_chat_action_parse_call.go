package server

import (
	"encoding/json"
	"strings"
)

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
	if strings.HasPrefix(content[start:], `<|"|>`) || strings.HasPrefix(content[start:], `<|"|>`) || strings.HasPrefix(content[start:], `<|"|>`) {
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

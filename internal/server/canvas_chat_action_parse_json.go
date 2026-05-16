package server

import (
	"encoding/json"
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
	raw = strings.ReplaceAll(raw, `<|"|>`, `"`)
	raw = strings.ReplaceAll(raw, `<|"|>`, `"`)
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

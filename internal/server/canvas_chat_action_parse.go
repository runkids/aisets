package server

import (
	"sort"
	"strings"
)

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

package server

import (
	"aisets/internal/llm"
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func decodeCanvasHarnessEvents(t *testing.T, body string) []canvasHarnessEvent {
	t.Helper()
	var events []canvasHarnessEvent
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event canvasHarnessEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode event %q: %v", line, err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}

func firstCanvasHarnessEvent(events []canvasHarnessEvent, eventType, tool string) (canvasHarnessEvent, bool) {
	for _, event := range events {
		if event["type"] != eventType {
			continue
		}
		if tool != "" && event["tool"] != tool {
			continue
		}
		return event, true
	}
	return nil, false
}

func requireCanvasHarnessEvent(t *testing.T, events []canvasHarnessEvent, eventType, tool string) canvasHarnessEvent {
	t.Helper()
	event, ok := firstCanvasHarnessEvent(events, eventType, tool)
	if !ok {
		t.Fatalf("missing event type=%s tool=%s in %#v", eventType, tool, events)
	}
	return event
}

func requireCanvasHarnessToolEventOrder(t *testing.T, events []canvasHarnessEvent, tools ...string) {
	t.Helper()
	index := 0
	for _, event := range events {
		if event["type"] != "action_result" || event["tool"] != tools[index] {
			continue
		}
		index++
		if index == len(tools) {
			return
		}
	}
	t.Fatalf("missing ordered action_result tools %v in %#v", tools, events)
}

func rejectCanvasHarnessEvent(t *testing.T, events []canvasHarnessEvent, eventType, tool string) {
	t.Helper()
	if event, ok := firstCanvasHarnessEvent(events, eventType, tool); ok {
		t.Fatalf("unexpected event type=%s tool=%s: %#v", eventType, tool, event)
	}
}

func canvasHarnessEventStringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func canvasHarnessAnyString(values []any, want string) bool {
	for _, value := range values {
		if text, ok := value.(string); ok && text == want {
			return true
		}
	}
	return false
}

func requireCanvasHarnessStatusContaining(t *testing.T, events []canvasHarnessEvent, text string) {
	t.Helper()
	for _, event := range events {
		if event["type"] == "status" && strings.Contains(fmt.Sprint(event["content"]), text) {
			return
		}
	}
	t.Fatalf("missing status containing %q in %#v", text, events)
}

func requireCanvasActionTool(t *testing.T, actions []canvasAction, tool string) canvasAction {
	t.Helper()
	for _, action := range actions {
		if action.Tool == tool {
			return action
		}
	}
	t.Fatalf("missing action tool=%s in %#v", tool, actions)
	return canvasAction{}
}

func canvasHarnessRequestHasTool(req llm.ChatRequest, name string) bool {
	for _, tool := range req.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func requireCanvasHarnessRequestTool(t *testing.T, req llm.ChatRequest, name string) {
	t.Helper()
	if !canvasHarnessRequestHasTool(req, name) {
		t.Fatalf("request missing tool %s in %#v", name, req.Tools)
	}
}

func rejectCanvasHarnessRequestTool(t *testing.T, req llm.ChatRequest, name string) {
	t.Helper()
	if canvasHarnessRequestHasTool(req, name) {
		t.Fatalf("request should not include tool %s in %#v", name, req.Tools)
	}
}

func requireCanvasHarnessRequestTools(t *testing.T, req llm.ChatRequest, names ...string) {
	t.Helper()
	for _, name := range names {
		requireCanvasHarnessRequestTool(t, req, name)
	}
}

func requireCanvasHarnessToolRequiredParams(t *testing.T, req llm.ChatRequest, name string, params ...string) {
	t.Helper()
	for _, tool := range req.Tools {
		if tool.Name != name {
			continue
		}
		required := map[string]bool{}
		for _, key := range canvasSchemaRequired(tool.Parameters) {
			required[key] = true
		}
		for _, param := range params {
			if !required[param] {
				t.Fatalf("tool %s required params = %#v, missing %s", name, required, param)
			}
		}
		return
	}
	t.Fatalf("request missing tool %s in %#v", name, req.Tools)
}

func requireCanvasHarnessToolChoice(t *testing.T, req llm.ChatRequest, want string) {
	t.Helper()
	if req.ToolChoice != want {
		t.Fatalf("tool choice = %q, want %q", req.ToolChoice, want)
	}
}

func requireCanvasHarnessLoopStat(t *testing.T, events []canvasHarnessEvent, index int) map[string]any {
	t.Helper()
	done := requireCanvasHarnessEvent(t, events, "done", "")
	rawStats, ok := done["loopStats"].([]any)
	if !ok {
		t.Fatalf("loopStats = %#v", done["loopStats"])
	}
	if index < 0 || index >= len(rawStats) {
		t.Fatalf("loopStats[%d] missing in %#v", index, rawStats)
	}
	stat, ok := rawStats[index].(map[string]any)
	if !ok {
		t.Fatalf("loopStats[%d] = %#v", index, rawStats[index])
	}
	return stat
}

func requireCanvasHarnessStatNumber(t *testing.T, stat map[string]any, key string) float64 {
	t.Helper()
	value, ok := stat[key].(float64)
	if !ok {
		t.Fatalf("stat[%s] = %#v", key, stat[key])
	}
	return value
}

func canvasHarnessToolCall(tool string, args map[string]any) llm.ChatResponse {
	return llm.ChatResponse{
		Content: "native content should not be rendered after tool execution",
		ToolCalls: []llm.ChatToolCall{{
			Name:      tool,
			Arguments: args,
		}},
		InputTokens:  3,
		OutputTokens: 4,
		DurationMs:   5,
	}
}

func canvasHarnessToolCalls(calls ...llm.ChatToolCall) llm.ChatResponse {
	return llm.ChatResponse{
		Content:      "native content should not be rendered after tool execution",
		ToolCalls:    calls,
		InputTokens:  3,
		OutputTokens: 4,
		DurationMs:   5,
	}
}

func canvasHarnessText(content string) llm.ChatResponse {
	return llm.ChatResponse{Content: content, InputTokens: 1, OutputTokens: 1, DurationMs: 1}
}

package agent

import (
	"context"
	"time"
)

var defaultAdapters = []Adapter{
	&CLIAdapter{AdapterCodex, "Codex CLI", "codex"},
	&CLIAdapter{AdapterClaude, "Claude Code", "claude"},
	&CLIAdapter{AdapterCursorAgent, "Cursor Agent", "cursor-agent"},
	&CLIAdapter{AdapterAntigravity, "Antigravity 2.0", "agy"},
	&CLIAdapter{AdapterCopilot, "Copilot CLI", "copilot"},
	&CLIAdapter{AdapterPi, "Pi", "pi"},
}

func DetectAll(ctx context.Context, llm LLMInfo) []AdapterInfo {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var found []AdapterInfo
	for _, a := range defaultAdapters {
		info, err := a.Detect(ctx)
		if err != nil || info == nil {
			continue
		}
		found = append(found, *info)
	}
	localLLM := NewLocalLLMAdapter(llm)
	if info, _ := localLLM.Detect(ctx); info != nil {
		found = append(found, *info)
	}
	return found
}

func ResolveActive(adapters []AdapterInfo, preference string) string {
	if preference != "" && preference != "auto" {
		for _, a := range adapters {
			if a.ID == preference {
				return preference
			}
		}
		return ""
	}
	if len(adapters) > 0 {
		return adapters[0].ID
	}
	return ""
}

func BuildRuntimeStatus(ctx context.Context, adapter string, llm LLMInfo) RuntimeStatus {
	adapters := DetectAll(ctx, llm)
	active := ResolveActive(adapters, adapter)
	return RuntimeStatus{
		Adapters:  adapters,
		Active:    active,
		Available: active != "",
	}
}

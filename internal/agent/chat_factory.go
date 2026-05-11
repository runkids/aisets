package agent

import (
	"aisets/internal/llm"
	"fmt"
)

func NewChatProvider(adapterID string, info AdapterInfo, llmProvider llm.Provider, prepareImage PrepareImageFunc) (ChatProvider, error) {
	switch adapterID {
	case "claude":
		return NewClaudeChatProvider(info.Path), nil
	case "codex":
		return NewCodexChatProvider(info.Path), nil
	case "gemini":
		return NewGeminiChatProvider(info.Path), nil
	case "copilot":
		return NewCopilotChatProvider(info.Path), nil
	case "cursor-agent":
		return NewCursorChatProvider(info.Path), nil
	case "pi":
		return NewPiChatProvider(info.Path), nil
	case "local-llm":
		if llmProvider == nil {
			return nil, fmt.Errorf("local-llm adapter requires an LLM provider")
		}
		return NewLocalLLMChatProvider(llmProvider, prepareImage), nil
	default:
		return nil, fmt.Errorf("unsupported agent adapter: %s", adapterID)
	}
}

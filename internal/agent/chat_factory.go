package agent

import (
	"aisets/internal/llm"
	"fmt"
)

func NewChatProvider(adapterID string, info AdapterInfo, llmProvider llm.Provider, prepareImage PrepareImageFunc) (ChatProvider, error) {
	switch adapterID {
	case AdapterClaude:
		return newClaudeChatProvider(info.Path), nil
	case AdapterCodex:
		return newCodexChatProvider(info.Path), nil
	case AdapterGemini:
		return newGeminiChatProvider(info.Path), nil
	case AdapterCopilot:
		return newCopilotChatProvider(info.Path), nil
	case AdapterCursorAgent:
		return newCursorChatProvider(info.Path), nil
	case AdapterPi:
		return newPiChatProvider(info.Path), nil
	case AdapterLocalLLM:
		if llmProvider == nil {
			return nil, fmt.Errorf("local-llm adapter requires an LLM provider")
		}
		return NewLocalLLMChatProvider(llmProvider, prepareImage), nil
	default:
		return nil, fmt.Errorf("unsupported agent adapter: %s", adapterID)
	}
}

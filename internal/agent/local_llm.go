package agent

import "context"

type LLMInfo struct {
	Enabled  bool
	Provider string
	Model    string
}

type LocalLLMAdapter struct {
	llm LLMInfo
}

func NewLocalLLMAdapter(info LLMInfo) *LocalLLMAdapter {
	return &LocalLLMAdapter{llm: info}
}

func (a *LocalLLMAdapter) ID() string { return "local-llm" }

func (a *LocalLLMAdapter) Detect(_ context.Context) (*AdapterInfo, error) {
	if !a.llm.Enabled || a.llm.Provider == "" {
		return nil, nil
	}
	return &AdapterInfo{
		ID:      "local-llm",
		Name:    "Local LLM",
		Version: a.llm.Provider + "/" + a.llm.Model,
		Path:    "",
	}, nil
}

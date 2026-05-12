package llm

func NewProvider(provider, endpoint, apiKey string) Provider {
	switch provider {
	case "ollama":
		return NewOllamaProvider(endpoint)
	case "openai-compat":
		return NewOpenAICompatProvider(endpoint, apiKey)
	case "omlx":
		return NewOMLXProvider(endpoint, apiKey)
	default:
		return nil
	}
}

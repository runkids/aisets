package llm

import "context"

// OMLXProvider wraps OpenAICompatProvider for oMLX, a local LLM inference
// server optimised for Apple Silicon that exposes OpenAI-compatible endpoints.
type OMLXProvider struct {
	inner *OpenAICompatProvider
}

func NewOMLXProvider(endpoint, apiKey string) *OMLXProvider {
	return &OMLXProvider{inner: NewOpenAICompatProvider(endpoint, apiKey)}
}

func (p *OMLXProvider) Name() string                                        { return "omlx" }
func (p *OMLXProvider) Available(ctx context.Context) error                 { return p.inner.Available(ctx) }
func (p *OMLXProvider) ListModels(ctx context.Context) ([]Model, error)     { return p.inner.ListModels(ctx) }
func (p *OMLXProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) { return p.inner.Chat(ctx, req) }
func (p *OMLXProvider) Embed(ctx context.Context, req EmbedRequest) (EmbedResponse, error) { return p.inner.Embed(ctx, req) }

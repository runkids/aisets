package llm

import "context"

type Provider interface {
	Name() string
	Available(ctx context.Context) error
	ListModels(ctx context.Context) ([]Model, error)
	Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
	Embed(ctx context.Context, req EmbedRequest) (EmbedResponse, error)
}

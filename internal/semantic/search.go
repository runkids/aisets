package semantic

import (
	"context"
	"sort"
	"strings"
	"time"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/embedding"
	"aisets/internal/llm"
	"aisets/internal/scanner"
)

type MatchReason struct {
	Kind  string  `json:"kind"`
	Label string  `json:"label"`
	Value string  `json:"value,omitempty"`
	Score float32 `json:"score,omitempty"`
}

type Result struct {
	AssetID      string             `json:"assetId"`
	ProjectID    string             `json:"projectId"`
	RepoPath     string             `json:"repoPath"`
	Similarity   float32            `json:"similarity"`
	ThumbnailURL string             `json:"thumbnailUrl"`
	MatchType    string             `json:"matchType"`
	MatchReasons []MatchReason      `json:"matchReasons,omitempty"`
	Item         *scanner.AssetItem `json:"item,omitempty"`
}

type Response struct {
	Results         []Result `json:"results"`
	QueryDurationMs int64    `json:"queryDurationMs"`
	TotalEmbeddings int      `json:"totalEmbeddings"`
	Query           string   `json:"query"`
	TranslatedQuery string   `json:"translatedQuery,omitempty"`
}

type Query struct {
	Text       string
	Type       string
	Limit      int
	Threshold  float32
	Filter     config.CatalogItemQuery
	ProjectIDs []string
}

type assetScore struct {
	projectID   string
	repoPath    string
	contentHash string
	similarity  float32
	embedType   string
}

func Search(ctx context.Context, store *config.Store, provider llm.Provider, settings config.AppSettings, query Query) (Response, error) {
	text := strings.TrimSpace(query.Text)
	if text == "" {
		return Response{}, apierr.New("embed_search_empty", "query parameter q is required")
	}
	if !settings.LLMEnabled || provider == nil || settings.LLMEmbedModel == "" {
		return Response{}, apierr.New("embed_not_configured", "LLM provider or embed model not configured")
	}

	embedType := query.Type
	if embedType == "" {
		embedType = settings.EmbedSearchType
	}
	if embedType == "" {
		embedType = "hybrid"
	}
	if embedType != "text" && embedType != "image" && embedType != "hybrid" {
		return Response{}, apierr.WithParams("embed_search_type_invalid", "embed search type must be text, image, or hybrid", map[string]any{"type": embedType})
	}

	limit := query.Limit
	if limit == 0 {
		limit = settings.EmbedSearchLimit
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	threshold := query.Threshold
	if threshold == 0 {
		threshold = float32(settings.EmbedSearchThreshold)
	}
	if threshold == 0 {
		threshold = 0.5
	}

	start := time.Now()
	searchText := text
	if containsNonLatin(text) && settings.LLMVisionModel != "" {
		if translated := translateToEnglish(ctx, provider, text, settings.LLMVisionModel); translated != "" && translated != text {
			searchText = translated
		}
	}

	resp, err := provider.Embed(ctx, llm.EmbedRequest{
		Model: settings.LLMEmbedModel,
		Input: searchText,
	})
	if err != nil {
		return Response{}, apierr.From(err, "embed_query_failed")
	}
	queryDimensions := len(resp.Embedding)
	providerName := provider.Name()

	var allowed map[string]struct{}
	if catalogFilterActive(query.Filter) {
		ids, err := store.CatalogItemIDs(query.Filter)
		if err != nil {
			return Response{}, err
		}
		allowed = make(map[string]struct{}, len(ids))
		for _, id := range ids {
			allowed[id] = struct{}{}
		}
		if len(allowed) == 0 {
			return Response{
				Results:         []Result{},
				QueryDurationMs: time.Since(start).Milliseconds(),
				Query:           text,
				TranslatedQuery: translatedQuery(text, searchText),
			}, nil
		}
	}

	typesToQuery := []string{embedType}
	if embedType == "hybrid" {
		typesToQuery = []string{"text", "image"}
	}

	bestPerAsset := map[string]*assetScore{}
	totalEmbeddings := 0
	for _, currentType := range typesToQuery {
		embs, err := store.ReadyEmbeddings(config.EmbeddingQuery{
			EmbedType:    currentType,
			ProviderName: providerName,
			ModelName:    settings.LLMEmbedModel,
			Dimensions:   queryDimensions,
			ProjectIDs:   query.ProjectIDs,
		})
		if err != nil {
			return Response{}, apierr.From(err, "embed_load_failed")
		}
		totalEmbeddings += len(embs)
		for _, emb := range embs {
			if allowed != nil {
				if _, ok := allowed[emb.AssetID]; !ok {
					continue
				}
			}
			similarity := embedding.CosineSimilarity(resp.Embedding, emb.Vector)
			if prev, ok := bestPerAsset[emb.AssetID]; ok {
				if similarity > prev.similarity {
					prev.similarity = similarity
					prev.embedType = currentType
				}
				continue
			}
			bestPerAsset[emb.AssetID] = &assetScore{
				projectID:   emb.ProjectID,
				repoPath:    emb.RepoPath,
				contentHash: emb.ContentHash,
				similarity:  similarity,
				embedType:   currentType,
			}
		}
	}

	results := make([]Result, 0, len(bestPerAsset))
	for assetID, score := range bestPerAsset {
		if score.similarity < threshold {
			continue
		}
		results = append(results, Result{
			AssetID:      assetID,
			ProjectID:    score.projectID,
			RepoPath:     score.repoPath,
			Similarity:   score.similarity,
			ThumbnailURL: "/api/thumbs/" + assetID + "?v=" + score.contentHash,
			MatchType:    score.embedType,
			MatchReasons: []MatchReason{{
				Kind:  "semantic",
				Label: score.embedType + " embedding",
				Score: score.similarity,
			}},
		})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Similarity > results[j].Similarity })
	if len(results) > limit {
		results = results[:limit]
	}

	return Response{
		Results:         results,
		QueryDurationMs: time.Since(start).Milliseconds(),
		TotalEmbeddings: totalEmbeddings,
		Query:           text,
		TranslatedQuery: translatedQuery(text, searchText),
	}, nil
}

func containsNonLatin(s string) bool {
	for _, r := range s {
		if r > 0x024F {
			return true
		}
	}
	return false
}

func translateToEnglish(ctx context.Context, provider llm.Provider, text, model string) string {
	resp, err := provider.Chat(ctx, llm.ChatRequest{
		Model: model,
		Messages: []llm.ChatMessage{
			{Role: "system", Content: "Translate the user's text to English. Output ONLY the English translation, nothing else. Keep it concise."},
			{Role: "user", Content: text},
		},
		TimeoutSec: 10,
	})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(resp.Content)
}

func translatedQuery(original, translated string) string {
	if translated != "" && translated != original {
		return translated
	}
	return ""
}

func catalogFilterActive(query config.CatalogItemQuery) bool {
	return strings.TrimSpace(query.AssetID) != "" ||
		strings.TrimSpace(query.ProjectID) != "" ||
		strings.TrimSpace(query.ProjectName) != "" ||
		strings.TrimSpace(query.Ext) != "" ||
		strings.TrimSpace(query.Folder) != "" ||
		strings.TrimSpace(query.Query) != "" ||
		strings.TrimSpace(query.Status) != "" ||
		strings.TrimSpace(query.CustomFilterID) != "" ||
		strings.TrimSpace(query.OptimizationCategory) != "" ||
		strings.TrimSpace(query.OptimizationSeverity) != "" ||
		strings.TrimSpace(query.Operation) != "" ||
		strings.TrimSpace(query.AICategory) != "" ||
		strings.TrimSpace(query.AIOcrStatus) != "" ||
		query.HasGPS != nil
}

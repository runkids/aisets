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
	Results         []Result          `json:"results"`
	QueryDurationMs int64             `json:"queryDurationMs"`
	TotalEmbeddings int               `json:"totalEmbeddings"`
	Query           string            `json:"query"`
	TranslatedQuery string            `json:"translatedQuery,omitempty"`
	Thresholds      AppliedThresholds `json:"thresholds"`
}

type AppliedThresholds struct {
	Text                float32 `json:"text"`
	Image               float32 `json:"image"`
	ImageDynamicEnabled bool    `json:"imageDynamicEnabled"`
	ImageDynamicMargin  float32 `json:"imageDynamicMargin"`
}

type Query struct {
	Text                   string
	Type                   string
	Limit                  int
	Threshold              float32
	TextThreshold          float32
	ImageThreshold         float32
	ImageDynamicEnabled    *bool
	ImageDynamicMargin     float32
	DisableDynamicImageCut bool
	Filter                 config.CatalogItemQuery
	ProjectIDs             []string
}

type assetScore struct {
	projectID   string
	repoPath    string
	contentHash string
	similarity  float32
	embedType   string
}

type candidateScore struct {
	assetID string
	assetScore
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

	thresholds := resolveThresholds(settings, query)

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
				Thresholds:      thresholds,
			}, nil
		}
	}

	typesToQuery := []string{embedType}
	if embedType == "hybrid" {
		typesToQuery = []string{"text", "image"}
	}

	bestPerAsset := map[string]*assetScore{}
	totalEmbeddings := 0
	queryVector := embedding.NormalizeVector(resp.Embedding)
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
		candidates := make([]candidateScore, 0, len(embs))
		for _, emb := range embs {
			if allowed != nil {
				if _, ok := allowed[emb.AssetID]; !ok {
					continue
				}
			}
			similarity := embedding.DotProduct(queryVector, emb.Vector)
			candidates = append(candidates, candidateScore{
				assetID: emb.AssetID,
				assetScore: assetScore{
					projectID:   emb.ProjectID,
					repoPath:    emb.RepoPath,
					contentHash: emb.ContentHash,
					similarity:  similarity,
					embedType:   currentType,
				},
			})
		}
		floor := thresholdForType(thresholds, currentType)
		if currentType == "image" && thresholds.ImageDynamicEnabled && !query.DisableDynamicImageCut {
			floor = dynamicImageFloor(candidates, floor, thresholds.ImageDynamicMargin)
		}
		for _, candidate := range candidates {
			if candidate.similarity < floor {
				continue
			}
			if prev, ok := bestPerAsset[candidate.assetID]; ok {
				if candidate.similarity > prev.similarity {
					prev.similarity = candidate.similarity
					prev.embedType = currentType
				}
				continue
			}
			score := candidate.assetScore
			bestPerAsset[candidate.assetID] = &score
		}
	}

	results := make([]Result, 0, len(bestPerAsset))
	for assetID, score := range bestPerAsset {
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
		Thresholds:      thresholds,
	}, nil
}

func resolveThresholds(settings config.AppSettings, query Query) AppliedThresholds {
	text := float32(settings.EmbedSearchThreshold)
	if text == 0 {
		text = config.DefaultEmbedSearchThreshold
	}
	image := float32(settings.EmbedImageSearchThreshold)
	if image == 0 {
		image = config.DefaultEmbedImageSearchThreshold
	}
	if query.Threshold != 0 {
		text = query.Threshold
		image = query.Threshold
	}
	if query.TextThreshold != 0 {
		text = query.TextThreshold
	}
	if query.ImageThreshold != 0 {
		image = query.ImageThreshold
	}
	margin := float32(settings.EmbedImageDynamicMargin)
	if margin == 0 {
		margin = config.DefaultEmbedImageDynamicMargin
	}
	if query.ImageDynamicMargin != 0 {
		margin = query.ImageDynamicMargin
	}
	enabled := settings.EmbedImageDynamicEnabled
	if query.ImageDynamicEnabled != nil {
		enabled = *query.ImageDynamicEnabled
	}
	return AppliedThresholds{
		Text:                text,
		Image:               image,
		ImageDynamicEnabled: enabled,
		ImageDynamicMargin:  margin,
	}
}

func thresholdForType(thresholds AppliedThresholds, embedType string) float32 {
	if embedType == "image" {
		return thresholds.Image
	}
	return thresholds.Text
}

func dynamicImageFloor(candidates []candidateScore, floor, margin float32) float32 {
	if margin <= 0 {
		return floor
	}
	var top float32
	found := false
	for _, candidate := range candidates {
		if candidate.similarity < floor {
			continue
		}
		if !found || candidate.similarity > top {
			top = candidate.similarity
			found = true
		}
	}
	if !found {
		return floor
	}
	dynamic := top - margin
	if dynamic > floor {
		return dynamic
	}
	return floor
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

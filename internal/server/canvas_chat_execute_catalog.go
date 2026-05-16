package server

import (
	"aisets/internal/config"
	"aisets/internal/scanner"
	"aisets/internal/semantic"
	"context"
	"strings"
)

func (s *Server) enrichCanvasCatalogItems(ctx context.Context, scanID int64, items []scanner.AssetItem, settings config.AppSettings) ([]scanner.AssetItem, error) {
	catalog := scanner.Catalog{Items: items}
	var err error
	catalog, err = s.enrichCatalogOCR(ctx, catalog)
	if err != nil {
		return nil, err
	}
	catalog, err = s.enrichCatalogAITag(catalog, settings)
	if err != nil {
		return nil, err
	}
	catalog, err = s.enrichCatalogEXIF(catalog, scanID)
	if err != nil {
		return nil, err
	}
	return catalog.Items, nil
}

func (s *Server) fetchCanvasCatalogItemsByIDs(ctx context.Context, scanID int64, assetIDs []string, settings config.AppSettings) ([]scanner.AssetItem, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	items, err := s.store.CatalogItemsByIDs(scanID, assetIDs)
	if err != nil {
		return nil, err
	}
	return s.enrichCanvasCatalogItems(ctx, scanID, items, settings)
}

func (s *Server) canvasSemanticCatalogSearch(ctx context.Context, scanID int64, q string, limit int, settings config.AppSettings) ([]scanner.AssetItem, bool) {
	if s.llmProvider == nil || strings.TrimSpace(settings.LLMEmbedModel) == "" {
		return nil, false
	}
	if limit <= 0 {
		limit = 12
	}
	query := semantic.Query{
		Text:       q,
		Type:       "hybrid",
		Limit:      limit,
		ProjectIDs: s.store.ActiveProjectIDs(),
	}
	if len(query.ProjectIDs) == 0 {
		query.ProjectIDs = nil
	}
	response, err := semantic.Search(ctx, s.store, s.llmProvider, settings, query)
	if err != nil || len(response.Results) == 0 {
		return nil, false
	}
	ids := make([]string, 0, len(response.Results))
	for _, result := range response.Results {
		if strings.TrimSpace(result.AssetID) != "" {
			ids = append(ids, result.AssetID)
		}
	}
	items, err := s.fetchCanvasCatalogItemsByIDs(ctx, scanID, ids, settings)
	if err != nil || len(items) == 0 {
		return nil, false
	}
	byID := make(map[string]scanner.AssetItem, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	ordered := make([]scanner.AssetItem, 0, len(ids))
	for _, id := range ids {
		if item, ok := byID[id]; ok {
			ordered = append(ordered, item)
		}
	}
	if len(ordered) == 0 {
		return nil, false
	}
	return ordered, true
}

func canvasSearchOCRStatus(hasText bool) string {
	if hasText {
		return "ocrTextReady"
	}
	return ""
}

func canvasSearchTextQueryIsGeneric(q string) bool {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return true
	}
	q = strings.ReplaceAll(q, "-", " ")
	q = strings.ReplaceAll(q, "_", " ")
	q = strings.Join(strings.Fields(q), " ")
	switch q {
	case "text", "visible text", "readable text", "ocr", "ocr text", "has text", "with text":
		return true
	default:
		return false
	}
}

func canvasFilterCatalogItemsWithOCRText(items []scanner.AssetItem) []scanner.AssetItem {
	if len(items) == 0 {
		return items
	}
	out := items[:0]
	for _, item := range items {
		if item.OCR != nil && strings.TrimSpace(item.OCR.Text) != "" {
			out = append(out, item)
		}
	}
	return out
}

func canvasAssetSummary(item scanner.AssetItem) map[string]any {
	summary := map[string]any{
		"id":             item.ID,
		"repoPath":       item.RepoPath,
		"projectId":      item.ProjectID,
		"projectName":    item.ProjectName,
		"ext":            item.Ext,
		"bytes":          item.Bytes,
		"width":          item.Image.Width,
		"height":         item.Image.Height,
		"animated":       item.Image.Animated,
		"alpha":          item.Image.Alpha,
		"usedByCount":    len(item.UsedBy),
		"favorite":       item.Favorite,
		"duplicates":     item.Duplicates,
		"similar":        item.Similar,
		"optimization":   item.Optimization,
		"duplicateGroup": item.DuplicateGroupID,
	}
	if item.AITag != nil {
		summary["tags"] = item.AITag.Tags
		summary["description"] = item.AITag.Description
		summary["category"] = item.AITag.Category
	}
	if item.OCR != nil {
		summary["ocrStatus"] = item.OCR.Status
		summary["ocrText"] = item.OCR.Text
	}
	return summary
}

func canvasPerAssetTextParam(params map[string]any, assetID string, field string, perAssetField string) string {
	if params == nil {
		return ""
	}
	if rows, ok := params[perAssetField].([]any); ok {
		for _, raw := range rows {
			row, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			id, _ := row["assetId"].(string)
			value, _ := row[field].(string)
			if id == assetID {
				return value
			}
		}
	}
	value, _ := params[field].(string)
	return value
}


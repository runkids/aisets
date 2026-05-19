package server

import (
	"aisets/internal/config"
	"aisets/internal/scanner"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (s *Server) executeCanvasSafeAction(r *http.Request, act canvasAction, settings config.AppSettings, canvas canvasSnapshot) any {
	switch act.Tool {
	case "focus_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
		}
	case "get_asset_detail":
		assetID, _ := act.Params["assetId"].(string)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"error": "no scan available"}
		}
		item, err := s.store.CatalogItem(scanID, assetID)
		if err != nil {
			return map[string]any{"error": "asset not found: " + err.Error()}
		}
		detail := map[string]any{
			"id":            item.ID,
			"repoPath":      item.RepoPath,
			"localPath":     item.LocalPath,
			"projectId":     item.ProjectID,
			"projectName":   item.ProjectName,
			"ext":           item.Ext,
			"width":         item.Image.Width,
			"height":        item.Image.Height,
			"bytes":         item.Bytes,
			"contentHash":   item.ContentHash,
			"hashAlgorithm": item.HashAlgorithm,
			"usedByCount":   len(item.UsedBy),
		}
		if item.AITag != nil {
			detail["aiTag"] = map[string]any{
				"category":    item.AITag.Category,
				"tags":        item.AITag.Tags,
				"description": item.AITag.Description,
			}
		}
		if item.OCR != nil && item.OCR.Text != "" {
			detail["ocrText"] = item.OCR.Text
		}
		if len(item.UsedBy) > 0 && len(item.UsedBy) <= 10 {
			detail["usedBy"] = item.UsedBy
		}
		return detail
	case "search_assets":
		q, _ := act.Params["q"].(string)
		hasText, _ := act.Params["hasText"].(bool)
		limit := 12
		if l, ok := act.Params["limit"].(float64); ok && l > 0 {
			limit = int(l)
			if limit > 18 {
				limit = 18
			}
		}
		fetchLimit := limit
		if strings.TrimSpace(q) != "" && fetchLimit < 18 {
			fetchLimit = max(18, limit*4)
			if fetchLimit > 18 {
				fetchLimit = 18
			}
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		var page config.CatalogItemsPage
		var err error
		candidates := canvasSearchQueryCandidates(q)
		if hasText && canvasSearchTextQueryIsGeneric(q) {
			candidates = []string{""}
		}
		searchCatalog := func(candidates []string) (config.CatalogItemsPage, string, error) {
			var result config.CatalogItemsPage
			var matchedQ string
			for _, candidate := range candidates {
				query := config.CatalogItemQuery{
					ScanID:      scanID,
					Query:       candidate,
					AIOcrStatus: canvasSearchOCRStatus(hasText),
					Limit:       fetchLimit,
				}
				result, err = s.store.CatalogItems(query)
				if err != nil {
					return result, matchedQ, err
				}
				if result.Total > 0 {
					matchedQ = candidate
					break
				}
			}
			return result, matchedQ, nil
		}
		page, matchedQ, err := searchCatalog(candidates)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		if matchedQ != "" {
			q = matchedQ
		}
		if page.Total == 0 && strings.TrimSpace(q) != "" && !hasText {
			candidatePage, candidateQ, err := searchCatalog(canvasAdditionalCatalogSearchCandidates(candidates))
			if err != nil {
				return map[string]any{"items": []any{}, "error": err.Error()}
			}
			if candidatePage.Total > 0 {
				candidateItems, err := s.enrichCanvasCatalogItems(r.Context(), scanID, candidatePage.Items, settings)
				if err != nil {
					return map[string]any{"items": []any{}, "error": err.Error()}
				}
				candidateItems = canvasRankCatalogSearchItems(candidateItems, candidateQ)
				if len(candidateItems) > limit {
					candidateItems = candidateItems[:limit]
				}
				return map[string]any{
					"items":                 []scanner.AssetItem{},
					"candidatePreviews":     candidateItems,
					"candidateCount":        len(candidateItems),
					"candidateQ":            candidateQ,
					"total":                 0,
					"q":                     q,
					"matchType":             "catalog_candidate",
					"hasText":               hasText,
					"needsUserConfirmation": true,
					"reason":                "No direct catalog match was found. Expanded matches are shown only for user confirmation.",
				}
			}
		}
		items, err := s.enrichCanvasCatalogItems(r.Context(), scanID, page.Items, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		if hasText {
			items = canvasFilterCatalogItemsWithOCRText(items)
		}
		items = canvasRankCatalogSearchItems(items, q)
		matchType := "catalog"
		if len(items) == 0 && strings.TrimSpace(q) != "" {
			if semanticItems, ok := s.canvasSemanticCatalogSearch(r.Context(), scanID, q, limit, settings); ok {
				if canvasSemanticSearchNeedsUserConfirmation(q, semanticItems) {
					if len(semanticItems) > limit {
						semanticItems = semanticItems[:limit]
					}
					return map[string]any{
						"items":                 []scanner.AssetItem{},
						"candidatePreviews":     semanticItems,
						"candidateCount":        len(semanticItems),
						"total":                 0,
						"q":                     q,
						"matchType":             "semantic_candidate",
						"hasText":               hasText,
						"needsUserConfirmation": true,
						"reason":                "Semantic matches had no direct metadata overlap with the query. They are shown only for user confirmation.",
					}
				}
				items = semanticItems
				if hasText {
					items = canvasFilterCatalogItemsWithOCRText(items)
				}
				matchType = "semantic"
			}
		}
		if len(items) > limit {
			items = items[:limit]
		}
		return map[string]any{"items": items, "total": len(items), "q": q, "matchType": matchType, "hasText": hasText}
	case "add_assets_to_canvas":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		return map[string]any{"items": items, "count": len(items), "assetIds": assetIDs}
	case "extract_ocr_text":
		return s.executeCanvasOCRText(r, act, settings, canvas)
	case "compress_image", "resize_image", "convert_image", "mirror_image", "rotate_image":
		return map[string]any{
			"assetIds":       canvasActionAssetIDs(act),
			"assetId":        act.Params["assetId"],
			"operation":      act.Tool,
			"outputFormat":   act.Params["outputFormat"],
			"quality":        act.Params["quality"],
			"maxDimensionPx": act.Params["maxDimensionPx"],
			"flip":           act.Params["flip"],
			"degrees":        act.Params["degrees"],
		}
	case "create_comment":
		return map[string]any{
			"anchorCardId": act.Params["anchorCardId"],
			"text":         act.Params["text"],
			"region":       act.Params["region"],
		}
	case "update_comment":
		return map[string]any{
			"commentCardId": act.Params["commentCardId"],
			"text":          act.Params["text"],
			"region":        act.Params["region"],
		}
	case "delete_comment":
		return map[string]any{
			"commentCardId": act.Params["commentCardId"],
		}
	case "select_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
		}
	case "remove_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
		}
	case "group_cards":
		groupID := fmt.Sprintf("group-%x", time.Now().UnixNano())
		name, _ := act.Params["name"].(string)
		return map[string]any{
			"cardIds": act.Params["cardIds"],
			"groupId": groupID,
			"name":    strings.TrimSpace(name),
		}
	case "ungroup_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
		}
	case "rename_group":
		name, _ := act.Params["name"].(string)
		return map[string]any{
			"cardId": act.Params["cardId"],
			"name":   strings.TrimSpace(name),
		}
	case "duplicate_cards":
		sourceCardIDs := canvasActionCardIDs(act)
		count := 1
		if l, ok := act.Params["count"].(float64); ok && l > 0 {
			count = int(l)
		}
		count = min(max(count, 1), 12)
		type cardCopy struct {
			SourceCardID string `json:"sourceCardId"`
			CardID       string `json:"cardId"`
		}
		copies := make([]cardCopy, 0, len(sourceCardIDs)*count)
		now := time.Now().UnixNano()
		for sourceIndex, sourceCardID := range sourceCardIDs {
			for copyIndex := 0; copyIndex < count; copyIndex++ {
				copies = append(copies, cardCopy{
					SourceCardID: sourceCardID,
					CardID:       fmt.Sprintf("dup-%x-%d-%d", now, sourceIndex, copyIndex),
				})
			}
		}
		cardIDs := make([]string, 0, len(copies))
		for _, copy := range copies {
			cardIDs = append(cardIDs, copy.CardID)
		}
		return map[string]any{
			"cardIds":    sourceCardIDs,
			"count":      count,
			"copies":     copies,
			"newCardIds": cardIDs,
			"layout":     act.Params["layout"],
		}
	case "move_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
			"x":      act.Params["x"],
			"y":      act.Params["y"],
		}
	case "arrange_cards":
		return map[string]any{
			"positions": act.Params["positions"],
		}
	case "align_cards":
		return map[string]any{
			"cardIds": act.Params["cardIds"],
			"axis":    act.Params["axis"],
		}
	case "distribute_cards":
		return map[string]any{
			"cardIds":   act.Params["cardIds"],
			"direction": act.Params["direction"],
			"gap":       act.Params["gap"],
		}
	case "resize_card":
		return map[string]any{
			"cardId": act.Params["cardId"],
			"width":  act.Params["width"],
		}
	case "bring_cards_to_front":
		return map[string]any{
			"cardIds":     act.Params["cardIds"],
			"afterCardId": act.Params["afterCardId"],
		}
	case "inspect_canvas":
		return map[string]any{
			"imageAttached": true,
			"reason":        act.Params["reason"],
		}
	case "capture_viewport", "capture_canvas", "capture_selected":
		return map[string]any{
			"transparent": act.Params["transparent"],
		}
	case "create_text_card":
		content, _ := act.Params["content"].(string)
		result := map[string]any{"content": content}
		if v, ok := act.Params["fontSize"]; ok {
			result["fontSize"] = v
		}
		if v, ok := act.Params["fontWeight"]; ok {
			result["fontWeight"] = v
		}
		if v, ok := act.Params["fontStyle"]; ok {
			result["fontStyle"] = v
		}
		if v, ok := act.Params["color"]; ok {
			result["color"] = v
		}
		if v, ok := act.Params["textAlign"]; ok {
			result["textAlign"] = v
		}
		if v, ok := act.Params["x"]; ok {
			result["x"] = v
		}
		if v, ok := act.Params["y"]; ok {
			result["y"] = v
		}
		if v, ok := act.Params["width"]; ok {
			result["width"] = v
		}
		if v, ok := act.Params["height"]; ok {
			result["height"] = v
		}
		return result
	case "update_text_card":
		cardId, _ := act.Params["cardId"].(string)
		result := map[string]any{"cardId": cardId}
		if v, ok := act.Params["content"]; ok {
			result["content"] = v
		}
		if v, ok := act.Params["fontSize"]; ok {
			result["fontSize"] = v
		}
		if v, ok := act.Params["fontWeight"]; ok {
			result["fontWeight"] = v
		}
		if v, ok := act.Params["fontStyle"]; ok {
			result["fontStyle"] = v
		}
		if v, ok := act.Params["color"]; ok {
			result["color"] = v
		}
		if v, ok := act.Params["textAlign"]; ok {
			result["textAlign"] = v
		}
		return result
	case "compare_assets":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		for _, item := range items {
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "count": len(summaries)}
	case "find_similar_assets":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"sources": []any{}, "items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"sources": []any{}, "items": []any{}, "error": err.Error()}
		}
		relatedSet := map[string]bool{}
		sources := make([]map[string]any, 0, len(items))
		for _, item := range items {
			for _, id := range item.Duplicates {
				relatedSet[id] = true
			}
			for _, id := range item.Similar {
				relatedSet[id] = true
			}
			sources = append(sources, map[string]any{
				"id":         item.ID,
				"repoPath":   item.RepoPath,
				"duplicates": item.Duplicates,
				"similar":    item.Similar,
			})
		}
		relatedIDs := make([]string, 0, len(relatedSet))
		for id := range relatedSet {
			relatedIDs = append(relatedIDs, id)
		}
		sort.Strings(relatedIDs)
		if l, ok := act.Params["limit"].(float64); ok && l > 0 && int(l) < len(relatedIDs) {
			relatedIDs = relatedIDs[:int(l)]
		}
		related, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, relatedIDs, settings)
		if err != nil {
			return map[string]any{"sources": sources, "items": []any{}, "error": err.Error()}
		}
		return map[string]any{"sources": sources, "items": related, "count": len(related)}
	case "inspect_image_quality":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		grouped := map[string]int{}
		for _, item := range items {
			for _, rec := range item.Optimization {
				grouped[rec.Category]++
			}
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "groups": grouped, "count": len(summaries)}
	case "generate_alt_text":
		assetIDs := canvasActionAssetIDs(act)
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available"}
		}
		items, err := s.fetchCanvasCatalogItemsByIDs(r.Context(), scanID, assetIDs, settings)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		summaries := make([]map[string]any, 0, len(items))
		for _, item := range items {
			summaries = append(summaries, canvasAssetSummary(item))
		}
		return map[string]any{"items": summaries, "style": act.Params["style"], "instruction": "Generate one alt text candidate per asset from the metadata and visible image context available in the canvas."}
	default:
		return map[string]any{"error": "unknown safe tool: " + act.Tool}
	}
}

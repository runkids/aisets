package server

import (
	"aisets/internal/agent"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
	"aisets/internal/semantic"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
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

func (s *Server) executeCanvasOCRText(r *http.Request, act canvasAction, settings config.AppSettings, canvas canvasSnapshot) any {
	if !s.hasVLMBackend(settings) {
		return map[string]any{"items": []any{}, "error": "AI provider or agent adapter not configured"}
	}
	const maxCanvasOCRAssets = 12

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureOCR)
	engineVersion := providerName + "/" + modelName
	settingsHash := vlmOCRSettingsHash(modelName)
	prompt := buildVLMOCRPrompt(settings.LLMOcrPrompt, settings.LLMAutoLocale, r.URL.Query().Get("lang"))
	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)
	timeoutSec := settings.LLMTimeout
	saveRequested, _ := act.Params["saveToMetadata"].(bool)

	type itemResult struct {
		AssetID      string   `json:"assetId"`
		RepoPath     string   `json:"repoPath"`
		CardID       string   `json:"cardId,omitempty"`
		FileName     string   `json:"fileName,omitempty"`
		Source       string   `json:"source,omitempty"`
		Status       string   `json:"status"`
		Text         string   `json:"text,omitempty"`
		Languages    []string `json:"languages,omitempty"`
		ErrorMessage string   `json:"errorMessage,omitempty"`
		CacheHit     bool     `json:"cacheHit,omitempty"`
	}

	type ocrTarget struct {
		item     scanner.AssetItem
		assetID  string
		cardID   string
		repoPath string
		fileName string
		source   string
	}

	var targets []ocrTarget
	var results []itemResult
	assetIDs := canvasActionAssetIDs(act)
	assetCardIDs := map[string]string{}
	seenAssets := map[string]bool{}
	addAssetID := func(assetID, cardID string) {
		assetID = strings.TrimSpace(assetID)
		if assetID == "" || seenAssets[assetID] {
			return
		}
		seenAssets[assetID] = true
		assetIDs = append(assetIDs, assetID)
		if cardID != "" {
			assetCardIDs[assetID] = cardID
		}
	}

	for _, assetID := range assetIDs {
		seenAssets[assetID] = true
	}

	cardsByID := make(map[string]canvasCardSnapshot, len(canvas.Cards))
	for _, card := range canvas.Cards {
		cardsByID[card.ID] = card
	}
	seenUploadCards := map[string]bool{}
	for _, cardID := range canvasActionCardIDs(act) {
		card, ok := cardsByID[cardID]
		if !ok {
			results = append(results, itemResult{CardID: cardID, Source: "canvas", Status: ocr.StatusFailed, ErrorMessage: "canvas card not found"})
			continue
		}
		switch card.Kind {
		case "asset":
			if card.Asset == nil || card.Asset.ID == "" {
				results = append(results, itemResult{CardID: cardID, Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "canvas asset card has no asset id"})
				continue
			}
			addAssetID(card.Asset.ID, card.ID)
		case "upload":
			if seenUploadCards[card.ID] {
				continue
			}
			seenUploadCards[card.ID] = true
			if card.UploadToken == "" {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "upload token missing; re-upload this image to run OCR"})
				continue
			}
			download, ok := s.peekImageToolDownload(card.UploadToken)
			if !ok {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "uploaded image is no longer available; re-upload this image to run OCR"})
				continue
			}
			info, err := os.Stat(download.Path)
			if err != nil {
				results = append(results, itemResult{CardID: card.ID, FileName: card.UploadFileName, Source: "upload", Status: ocr.StatusFailed, ErrorMessage: "uploaded image file is missing; re-upload this image to run OCR"})
				continue
			}
			ext := strings.ToLower(filepath.Ext(card.UploadFileName))
			if ext == "" {
				ext = strings.ToLower(filepath.Ext(download.Path))
			}
			item := scanner.AssetItem{
				ID:          "upload:" + card.ID,
				ProjectID:   "canvas-upload",
				ProjectName: "Canvas Upload",
				RepoPath:    card.UploadFileName,
				LocalPath:   download.Path,
				Ext:         ext,
				Bytes:       info.Size(),
				Image: imageproc.Metadata{
					Format: strings.TrimPrefix(ext, "."),
					Width:  card.UploadWidth,
					Height: card.UploadHeight,
				},
			}
			targets = append(targets, ocrTarget{
				item:     item,
				cardID:   card.ID,
				repoPath: card.UploadFileName,
				fileName: card.UploadFileName,
				source:   "upload",
			})
		default:
			results = append(results, itemResult{CardID: card.ID, Source: card.Kind, Status: ocr.StatusSkipped, ErrorMessage: "card is not an OCR image target"})
		}
	}

	if len(assetIDs) > 0 {
		if len(assetIDs) > maxCanvasOCRAssets {
			assetIDs = assetIDs[:maxCanvasOCRAssets]
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			return map[string]any{"items": []any{}, "error": "no scan available for catalog OCR targets"}
		}
		items, err := s.store.CatalogItemsByIDs(scanID, assetIDs)
		if err != nil {
			return map[string]any{"items": []any{}, "error": err.Error()}
		}
		foundAssetIDs := make(map[string]bool, len(items))
		for _, item := range items {
			foundAssetIDs[item.ID] = true
			if item.LocalPath == "" {
				results = append(results, itemResult{AssetID: item.ID, RepoPath: item.RepoPath, CardID: assetCardIDs[item.ID], FileName: filepath.Base(item.RepoPath), Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "project asset has no local path; rescan the project"})
				continue
			}
			if _, err := os.Stat(item.LocalPath); err != nil {
				results = append(results, itemResult{AssetID: item.ID, RepoPath: item.RepoPath, CardID: assetCardIDs[item.ID], FileName: filepath.Base(item.RepoPath), Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "original project file is missing; rescan the project or remove this canvas card"})
				continue
			}
			targets = append(targets, ocrTarget{
				item:     item,
				assetID:  item.ID,
				cardID:   assetCardIDs[item.ID],
				repoPath: item.RepoPath,
				fileName: filepath.Base(item.RepoPath),
				source:   "catalog",
			})
		}
		for _, assetID := range assetIDs {
			if !foundAssetIDs[assetID] {
				results = append(results, itemResult{AssetID: assetID, CardID: assetCardIDs[assetID], Source: "catalog", Status: ocr.StatusFailed, ErrorMessage: "catalog asset is no longer available; rescan the project or remove this canvas card"})
			}
		}
	}

	if len(targets) == 0 && len(results) == 0 {
		return map[string]any{"items": []any{}, "error": "no assetIds or upload cardIds provided"}
	}
	if len(targets) > maxCanvasOCRAssets {
		targets = targets[:maxCanvasOCRAssets]
	}

	counts := vlmOcrCounts{Queued: len(targets) + len(results)}
	for _, result := range results {
		switch result.Status {
		case ocr.StatusSkipped:
			counts.Skipped++
		default:
			counts.Failed++
		}
	}
	for _, target := range targets {
		item := target.item
		entry := itemResult{AssetID: target.assetID, RepoPath: target.repoPath, CardID: target.cardID, FileName: target.fileName, Source: target.source}
		if !eligibleForVLMOCR(item) {
			entry.Status = ocr.StatusSkipped
			entry.ErrorMessage = "asset is not eligible for VLM OCR"
			counts.Skipped++
			results = append(results, entry)
			continue
		}
		if item.ContentHash == "" || item.HashAlgorithm == "" {
			sum, algorithm, herr := scanner.ContentHash(r.Context(), item.LocalPath)
			if herr != nil {
				entry.Status = ocr.StatusFailed
				entry.ErrorMessage = herr.Error()
				counts.Failed++
				results = append(results, entry)
				continue
			}
			item.ContentHash = sum
			item.HashAlgorithm = algorithm
		}

		var result ocr.Result
		if cached, found, cerr := s.store.VLMOCRResultForContentHash(item.ContentHash, item.HashAlgorithm, engineVersion, settingsHash); cerr != nil {
			entry.Status = ocr.StatusFailed
			entry.ErrorMessage = cerr.Error()
			counts.Failed++
			results = append(results, entry)
			continue
		} else if found && cached.Status == ocr.StatusReady {
			result = copyOCRResultForVLMItem(cached, item)
			entry.CacheHit = true
			counts.CacheHit++
		} else {
			processed, chatResp := s.processVLMOCR(r.Context(), item, backend, providerName, modelName, systemPrompt, prompt, timeoutSec)
			result = processed
			counts.InputTokens += chatResp.InputTokens
			counts.OutputTokens += chatResp.OutputTokens
		}

		entry.Status = result.Status
		entry.Text = result.Text
		entry.Languages = result.Languages
		entry.ErrorMessage = canvasOCRDisplayError(result.ErrorMessage)
		counts.Processed++
		if result.Status == ocr.StatusReady {
			counts.Ready++
		} else {
			counts.Failed++
		}
		results = append(results, entry)
	}

	return map[string]any{
		"items":                   results,
		"counts":                  counts,
		"providerName":            providerName,
		"modelName":               modelName,
		"mode":                    vlmOCRMode,
		"saveToMetadataRequested": saveRequested,
		"saveToMetadata":          false,
		"saveInstruction":         "Use update_ocr_text proposal to save OCR text into metadata.",
	}
}

func canvasOCRDisplayError(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}
	if idx := strings.Index(message, "{"); idx >= 0 {
		var payload struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(message[idx:]), &payload); err == nil {
			if text := strings.TrimSpace(payload.Error.Message); text != "" {
				return text
			}
		}
	}
	return message
}

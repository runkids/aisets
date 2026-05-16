package server

import (
	"aisets/internal/agent"
	"aisets/internal/config"
	"aisets/internal/imageproc"
	"aisets/internal/llm"
	"aisets/internal/ocr"
	"aisets/internal/scanner"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

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

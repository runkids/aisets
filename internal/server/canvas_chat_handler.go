package server

import (
	"net/http"
	"path/filepath"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
)

func (s *Server) handleCanvasChat(w http.ResponseWriter, r *http.Request) {
	var req canvasChatRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_request"))
		return
	}
	if len(req.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, apierr.New("canvas_chat_no_messages", "at least one message is required"))
		return
	}

	settings, err := s.store.Settings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apierr.From(err, "canvas_chat_settings_failed"))
		return
	}
	if !s.hasVLMBackend(settings) {
		writeJSON(w, http.StatusServiceUnavailable, apierr.New("canvas_chat_no_backend", "no AI backend configured"))
		return
	}

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureCanvas)

	locale := req.Locale
	if locale == "" {
		locale = "en"
	}
	req.Options.CanvasImageAttached = req.CanvasImage != ""
	req.Options.AutoLocale = settings.LLMAutoLocale
	req.Options.CanvasStrategy = s.canvasStrategyPrompt()
	latestUserMessage := latestCanvasUserMessage(req.Messages)
	explicitSelectedSkillIDs := normalizeCanvasSelectedSkillIDs(req.SelectedSkillIDs)
	selectedSkillIDs := explicitSelectedSkillIDs
	if len(selectedSkillIDs) == 0 {
		selectedSkillIDs = classifyCanvasSkillFamilies(canvasSkillClassifyInput{
			Message: latestUserMessage,
			Canvas:  req.Canvas,
			Options: req.Options,
		})
		if canvasLatestUserLanguage(latestUserMessage, locale) != "" {
			selectedSkillIDs = canvasAllSkillIDs()
		}
	}
	photoStagingWorkflow := canvasPhotoStagingWorkflowRequested(latestUserMessage, explicitSelectedSkillIDs, selectedSkillIDs)
	req.Options.PhotoStagingWorkflow = photoStagingWorkflow
	canvasTools := canvasLLMToolsForSkills(selectedSkillIDs)
	usingNativeTools := canvasNativeToolsEnabled(backend, canvasTools)
	if photoStagingWorkflow && backend == agent.BackendLocalLLM {
		usingNativeTools = false
	}
	systemPrompt := canvasSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	if usingNativeTools {
		canvasTools = canvasNativeLLMToolsForSkills(selectedSkillIDs)
		systemPrompt = canvasNativeSystemPromptForSkills(locale, req.Options, selectedSkillIDs)
	} else {
		canvasTools = nil
	}
	userPrompt := buildCanvasUserPrompt(req.Messages, req.Canvas, req.Options, locale)

	var images []vlmImage
	var canvasImage *vlmImage
	if req.CanvasImage != "" {
		path, cleanup, err := canvasImageTempFile(req.CanvasImage)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apierr.From(err, "canvas_chat_bad_canvas_image"))
			return
		}
		defer cleanup()
		canvasImage = &vlmImage{Path: path, Ext: ".png"}
	}
	imageLimit := 4
	useSelectedCoordinateGrid := len(selectedCanvasImageCardIDs(req.Canvas)) == 1
	selectedImageLimit := imageLimit
	if canvasImage != nil {
		selectedImageLimit--
	}
	for _, card := range req.Canvas.Cards {
		if card.Asset == nil {
			continue
		}
		selected := false
		for _, sid := range req.Canvas.SelectedCardIDs {
			if sid == card.ID {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		scanID := s.latestScanID()
		if scanID == 0 {
			continue
		}
		item, err := s.store.CatalogItem(scanID, card.Asset.ID)
		if err != nil || item.LocalPath == "" {
			continue
		}
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(item.LocalPath); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: item.LocalPath, Ext: item.Ext})
		if len(images) >= selectedImageLimit {
			break
		}
	}
	for _, card := range req.Canvas.Cards {
		if len(images) >= selectedImageLimit {
			break
		}
		if card.Kind != "upload" || card.UploadToken == "" {
			continue
		}
		selected := false
		for _, sid := range req.Canvas.SelectedCardIDs {
			if sid == card.ID {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		download, ok := s.peekImageToolDownload(card.UploadToken)
		if !ok {
			continue
		}
		if useSelectedCoordinateGrid && len(images) == 0 && len(images) < selectedImageLimit {
			if path, cleanup, err := canvasCoordinateGridImage(download.Path); err == nil {
				defer cleanup()
				images = append(images, vlmImage{Path: path, Ext: ".png"})
			}
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
	}
	if canvasImage != nil && len(images) < imageLimit {
		images = append(images, *canvasImage)
	}
	for _, token := range req.AttachmentTokens {
		if len(images) >= imageLimit {
			break
		}
		if token == "" {
			continue
		}
		download, ok := s.peekImageToolDownload(token)
		if !ok {
			continue
		}
		images = append(images, vlmImage{Path: download.Path, Ext: filepath.Ext(download.Path)})
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")

	if len(req.Canvas.SelectedCardIDs) > 0 {
		sendNDJSON(w, map[string]any{
			"type":   "focus",
			"cardId": req.Canvas.SelectedCardIDs[0],
		})
		time.Sleep(800 * time.Millisecond)
	}
	sendNDJSON(w, map[string]any{"type": "thinking"})

	cs := &canvasChatSession{
		s:                    s,
		w:                    w,
		r:                    r,
		settings:             settings,
		req:                  req,
		locale:               locale,
		latestUserMessage:    latestUserMessage,
		backend:              backend,
		providerName:         providerName,
		modelName:            modelName,
		selectedSkillIDs:     selectedSkillIDs,
		photoStagingWorkflow: photoStagingWorkflow,
		usingNativeTools:     usingNativeTools,
		systemPrompt:         systemPrompt,
		canvasTools:          canvasTools,
		currentPrompt:        userPrompt,
		userPrompt:           userPrompt,
		images:               images,
		promptKind:           vlmPromptKindFull,
		loopReason:           "initial",
		captureRequested:     canvasCaptureRequested(latestUserMessage) || photoStagingWorkflow,
		start:                time.Now(),
		executedCaptureTools:             map[string]bool{},
		photoStagingCoveredCardIDs:       map[string]bool{},
		generatedImagePaths:              map[string]bool{},
		executedCanvasTools:              map[string]bool{},
		executedCanvasActionKeys:         map[string]bool{},
		executedCanvasTextRegionKeys:     map[string]bool{},
		cleanupProtectedCardIDs:          map[string]bool{},
		projectedCanvas:                  req.Canvas,
	}
	cs.runToolLoop()
	cs.finalize()
}

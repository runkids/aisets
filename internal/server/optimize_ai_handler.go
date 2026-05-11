package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/llm"
)

const optimizeAIPrompt = `Analyze this image and provide compression advice.

{{fileMetadata}}

{{lintFindings}}

{{optimizationFindings}}

Based on the image content AND the analysis above, respond as JSON:
{
  "contentType": "photo|icon|screenshot|diagram|illustration|gradient|pattern|text-heavy",
  "recommendedFormat": "avif|webp|png|svg|jpeg",
  "recommendedQuality": <number 1-100 or null for lossless>,
  "lossless": <true|false>,
  "rationale": "<2-3 sentences: explain your recommendation considering the lint findings and file characteristics>"
}

Rules:
- Icons with transparency → lossless WebP or AVIF, preserve alpha
- Photos/banners → lossy WebP/AVIF, quality 70-85
- Screenshots with text → lossless or quality 95+ to preserve sharpness
- Diagrams with text → lossless compression, consider SVG if simple shapes
- Decorative gradients → aggressive lossy, quality 60-70
- Patterns → lossless PNG or WebP for tile accuracy

Important:
- If lint findings identify structural issues (embedded bitmaps, oversized raster), address them in your rationale
- Your recommendation should complement, not contradict, the lint findings
- Be specific about expected savings when possible
- Always name the concrete target format in the rationale (e.g. "extract the embedded bitmap and convert to WebP at quality 80")
- For files with mixed content (e.g. SVG containing embedded raster), recommend a specific format for the extracted raster portion, not just the container format

Respond ONLY with the JSON object, no other text.`

type OptimizeAIAdviceResponse struct {
	ContentType        string `json:"contentType"`
	RecommendedFormat  string `json:"recommendedFormat"`
	RecommendedQuality *int   `json:"recommendedQuality"`
	Lossless           bool   `json:"lossless"`
	Rationale          string `json:"rationale"`
	DurationMs         int64  `json:"durationMs"`
	InputTokens        int64  `json:"inputTokens"`
	OutputTokens       int64  `json:"outputTokens"`
}

func (s *Server) handleOptimizeAIAdvice(w http.ResponseWriter, r *http.Request) {
	assetID := r.URL.Query().Get("assetId")
	if assetID == "" {
		writeError(w, http.StatusBadRequest, apierr.New("missing_asset_id", "assetId query param required"))
		return
	}

	settings, err := s.store.Settings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "settings_failed"))
		return
	}
	if !s.hasVLMBackend(settings) {
		writeError(w, http.StatusBadRequest, apierr.New("ai_not_configured", "AI provider or agent adapter not configured"))
		return
	}

	prompt := optimizeAIPrompt
	if presetID := r.URL.Query().Get("presetId"); presetID != "" {
		if preset, err := s.store.GetPromptPreset(presetID); err == nil {
			prompt = config.FormatPrompt(preset.Content)
		}
	} else {
		presets, _ := s.store.ListPromptPresets("optimize")
		for _, p := range presets {
			if p.IsDefault {
				prompt = config.FormatPrompt(p.Content)
				break
			}
		}
	}

	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)

	items, err := s.store.CatalogItemsWithOptimizationByIDs(0, []string{assetID})
	if err != nil || len(items) == 0 {
		writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "Asset not found in catalog"))
		return
	}
	item := items[0]

	findings, _ := s.store.LintFindingsByAssetID(assetID)
	prompt = replaceDynamicVars(prompt, map[string]string{
		"fileMetadata":         formatFileMetadata(item),
		"lintFindings":         formatLintFindings(findings),
		"optimizationFindings": formatOptimizationFindings(item.Optimization),
	})

	timeoutSec := settings.LLMTimeout
	if timeoutSec == 0 {
		timeoutSec = llm.DefaultChatTimeout
	}

	_, modelName := s.resolveVLMProvider(settings)

	start := time.Now()
	rawContent, resp, err := s.chatVLM(r.Context(), []vlmImage{{Path: item.LocalPath, Ext: item.Ext}}, modelName, systemPrompt, prompt, timeoutSec)
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "llm_request_failed"))
		return
	}

	content := llm.CleanJSON(rawContent)

	var parsed struct {
		ContentType        string `json:"contentType"`
		RecommendedFormat  string `json:"recommendedFormat"`
		RecommendedQuality *int   `json:"recommendedQuality"`
		Lossless           bool   `json:"lossless"`
		Rationale          string `json:"rationale"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		writeError(w, http.StatusInternalServerError, apierr.New("parse_failed", fmt.Sprintf("Failed to parse AI response: %v", err)))
		return
	}

	writeJSON(w, http.StatusOK, OptimizeAIAdviceResponse{
		ContentType:        parsed.ContentType,
		RecommendedFormat:  parsed.RecommendedFormat,
		RecommendedQuality: parsed.RecommendedQuality,
		Lossless:           parsed.Lossless,
		Rationale:          parsed.Rationale,
		DurationMs:         durationMs,
		InputTokens:        resp.InputTokens,
		OutputTokens:       resp.OutputTokens,
	})
}

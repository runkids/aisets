package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"aisets/internal/agent"
	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/llm"
)

type DuplicateExplanationResponse struct {
	Summary        string `json:"summary"`
	Differences    string `json:"differences"`
	KeepFilename   string `json:"keepFilename,omitempty"`
	Recommendation string `json:"recommendation"`
	Rationale      string `json:"rationale"`
	ProviderName   string `json:"providerName"`
	ModelName      string `json:"modelName"`
	DurationMs     int64  `json:"durationMs"`
	InputTokens    int64  `json:"inputTokens"`
	OutputTokens   int64  `json:"outputTokens"`
}

func (s *Server) handleDuplicateExplain(w http.ResponseWriter, r *http.Request) {
	leftID := r.URL.Query().Get("leftId")
	rightID := r.URL.Query().Get("rightId")
	if leftID == "" || rightID == "" {
		writeError(w, http.StatusBadRequest, apierr.New("missing_params", "leftId and rightId query params required"))
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

	prompt := defaultDuplicateExplainPrompt
	if presetID := r.URL.Query().Get("presetId"); presetID != "" {
		if preset, err := s.store.GetPromptPreset(presetID); err == nil {
			prompt = config.FormatPrompt(preset.Content)
		}
	} else {
		presets, _ := s.store.ListPromptPresets("duplicate")
		for _, p := range presets {
			if p.IsDefault {
				prompt = config.FormatPrompt(p.Content)
				break
			}
		}
	}

	systemPrompt := llm.SystemPrompt(settings.LLMSystemPromptEnabled, settings.LLMSystemPrompt)

	items, err := s.store.CatalogItemsWithOptimizationByIDs(0, []string{leftID, rightID})
	if err != nil || len(items) < 2 {
		writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "One or both assets not found in catalog"))
		return
	}
	// Ensure left/right order matches the requested IDs.
	var left, right = items[0], items[1]
	if left.ID != leftID {
		left, right = right, left
	}
	if left.ID != leftID || right.ID != rightID {
		writeError(w, http.StatusNotFound, apierr.New("asset_not_found", "One or both assets not found in catalog"))
		return
	}

	distance := r.URL.Query().Get("distance")
	if distance == "" {
		distance = "?"
	}
	leftName := filepath.Base(left.RepoPath)
	rightName := filepath.Base(right.RepoPath)
	prompt = replaceDynamicVars(prompt, map[string]string{
		"leftMetadata":  formatFileMetadata(left),
		"rightMetadata": formatFileMetadata(right),
		"leftFilename":  leftName,
		"rightFilename": rightName,
		"distance":      distance,
	})

	prompt = llm.AppendLocaleInstruction(prompt, settings.LLMAutoLocale,
		r.URL.Query().Get("lang"), "Write the summary, differences, recommendation, and rationale in")

	timeoutSec := settings.LLMTimeout
	if timeoutSec == 0 {
		timeoutSec = llm.DefaultChatTimeout
	}

	backend, providerName, modelName := s.resolveVLMProviderForFeature(settings, agent.FeatureDuplicate)

	start := time.Now()
	rawContent, resp, err := s.chatVLM(r.Context(), []vlmImage{
		{Path: left.LocalPath, Ext: left.Ext},
		{Path: right.LocalPath, Ext: right.Ext},
	}, backend, modelName, systemPrompt, prompt, "tag", timeoutSec)
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "llm_request_failed"))
		return
	}

	content := llm.CleanJSON(rawContent)

	var parsed struct {
		Summary        string `json:"summary"`
		Differences    string `json:"differences"`
		KeepFilename   string `json:"keepFilename"`
		Recommendation string `json:"recommendation"`
		Rationale      string `json:"rationale"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		writeError(w, http.StatusInternalServerError, apierr.New("parse_failed", fmt.Sprintf("Failed to parse AI response: %v", err)))
		return
	}

	writeJSON(w, http.StatusOK, DuplicateExplanationResponse{
		Summary:        parsed.Summary,
		Differences:    parsed.Differences,
		KeepFilename:   parsed.KeepFilename,
		Recommendation: parsed.Recommendation,
		Rationale:      parsed.Rationale,
		ProviderName:   providerName,
		ModelName:      modelName,
		DurationMs:     durationMs,
		InputTokens:    resp.InputTokens,
		OutputTokens:   resp.OutputTokens,
	})
}

const defaultDuplicateExplainPrompt = `Compare these two images flagged as near-duplicates (dHash distance: {{distance}}/64).

"{{leftFilename}}": {{leftMetadata}}
"{{rightFilename}}": {{rightMetadata}}

Explain:
1. What the images show
2. The specific visual differences between them
3. Which one to keep and why (consider: resolution, quality, file size)

IMPORTANT: Always refer to each image by its filename ("{{leftFilename}}" or "{{rightFilename}}"). Never use generic labels like "image 1", "image 2", "left image", or localized variants of those labels.

Respond ONLY with a JSON object:
{
  "summary": "one-sentence description of what these images are",
  "differences": "specific visual differences — reference each file by name",
  "keepFilename": "{{leftFilename}}" or "{{rightFilename}}",
  "recommendation": "one sentence: why keep that file over the other",
  "rationale": "detailed reasoning — use filenames, not generic labels"
}`

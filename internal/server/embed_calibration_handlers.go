package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"aisets/internal/apierr"
	"aisets/internal/config"
	"aisets/internal/semantic"
)

type calibrationScore struct {
	AssetID   string
	Label     string
	Score     float32
	MatchType string
	TopImage  float32
}

type calibrationMetric struct {
	Threshold float32 `json:"threshold"`
	Margin    float32 `json:"margin,omitempty"`
	Precision float64 `json:"precision"`
	Recall    float64 `json:"recall"`
	F1        float64 `json:"f1"`
	TP        int     `json:"tp"`
	FP        int     `json:"fp"`
	FN        int     `json:"fn"`
	TN        int     `json:"tn"`
}

func (s *Server) handleEmbedCalibrationLabels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleEmbedCalibrationLabelsList(w, r)
	case http.MethodPost:
		s.handleEmbedCalibrationLabelsUpsert(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleEmbedCalibrationLabelsList(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	searchType := r.URL.Query().Get("type")
	var (
		labels []config.EmbeddingCalibrationLabel
		err    error
	)
	if query != "" {
		labels, err = s.store.EmbeddingCalibrationLabelsFor(query, searchType)
	} else {
		labels, err = s.store.EmbeddingCalibrationLabels()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "embed_calibration_labels_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": labels})
}

func (s *Server) handleEmbedCalibrationLabelsUpsert(w http.ResponseWriter, r *http.Request) {
	var body config.EmbeddingCalibrationLabel
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, apierr.New("embed_calibration_decode_failed", "invalid calibration label payload"))
		return
	}
	if body.Query == "" || body.AssetID == "" {
		writeError(w, http.StatusBadRequest, apierr.New("embed_calibration_label_invalid", "query and asset id are required"))
		return
	}
	label, err := s.store.UpsertEmbeddingCalibrationLabel(body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "embed_calibration_label_save_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"label": label})
}

func (s *Server) handleEmbedCalibrationLabelDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, apierr.New("embed_calibration_label_id_invalid", "invalid calibration label id"))
		return
	}
	if err := s.store.DeleteEmbeddingCalibrationLabel(id); err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "embed_calibration_label_delete_failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleEmbedCalibrationAnalyze(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.Settings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "embed_settings_failed"))
		return
	}
	if !settings.LLMEnabled || s.llmProvider == nil || settings.LLMEmbedModel == "" {
		writeError(w, http.StatusBadRequest, apierr.New("embed_not_configured", "LLM provider or embed model not configured"))
		return
	}
	labels, err := s.store.EmbeddingCalibrationLabels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, apierr.From(err, "embed_calibration_labels_failed"))
		return
	}
	scores, skipped := s.calibrationScores(r, settings, labels)
	textScores := filterCalibrationScores(scores, "text")
	imageScores := filterCalibrationScores(scores, "image")
	text := bestCalibrationThreshold(textScores, 0.10, 0.80, 0.05, 0)
	image := bestCalibrationImageThreshold(imageScores)
	if len(textScores) == 0 {
		text = calibrationMetric{Threshold: float32(settings.EmbedSearchThreshold)}
	}
	if len(imageScores) == 0 {
		image = calibrationMetric{
			Threshold: float32(settings.EmbedImageSearchThreshold),
			Margin:    float32(settings.EmbedImageDynamicMargin),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"labels":              len(labels),
		"scored":              len(scores),
		"skipped":             skipped,
		"textRecommendation":  text,
		"imageRecommendation": image,
	})
}

func (s *Server) calibrationScores(r *http.Request, settings config.AppSettings, labels []config.EmbeddingCalibrationLabel) ([]calibrationScore, int) {
	type groupKey struct {
		query      string
		searchType string
	}
	groups := map[groupKey][]config.EmbeddingCalibrationLabel{}
	for _, label := range labels {
		key := groupKey{query: label.Query, searchType: label.SearchType}
		groups[key] = append(groups[key], label)
	}
	var out []calibrationScore
	skipped := 0
	disabled := false
	for key, group := range groups {
		response, err := semantic.Search(r.Context(), s.store, s.llmProvider, settings, semantic.Query{
			Text:                   key.query,
			Type:                   key.searchType,
			Limit:                  100,
			Threshold:              -1,
			ImageDynamicEnabled:    &disabled,
			DisableDynamicImageCut: true,
			ProjectIDs:             s.store.ActiveProjectIDs(),
		})
		if err != nil {
			skipped += len(group)
			continue
		}
		byAsset := map[string]semantic.Result{}
		var topImage float32
		for _, result := range response.Results {
			byAsset[result.AssetID] = result
			if result.MatchType == "image" && result.Similarity > topImage {
				topImage = result.Similarity
			}
		}
		for _, label := range group {
			result, ok := byAsset[label.AssetID]
			if !ok {
				skipped++
				continue
			}
			out = append(out, calibrationScore{
				AssetID:   label.AssetID,
				Label:     label.Label,
				Score:     result.Similarity,
				MatchType: result.MatchType,
				TopImage:  topImage,
			})
		}
	}
	return out, skipped
}

func filterCalibrationScores(scores []calibrationScore, matchType string) []calibrationScore {
	out := make([]calibrationScore, 0, len(scores))
	for _, score := range scores {
		if score.MatchType == matchType {
			out = append(out, score)
		}
	}
	return out
}

func bestCalibrationImageThreshold(scores []calibrationScore) calibrationMetric {
	best := calibrationMetric{Threshold: config.DefaultEmbedImageSearchThreshold, Margin: config.DefaultEmbedImageDynamicMargin}
	for ti := 15; ti <= 50; ti++ {
		threshold := float32(ti) / 100
		for mi := 3; mi <= 15; mi++ {
			margin := float32(mi) / 100
			metric := scoreCalibrationCandidate(scores, threshold, margin)
			if betterCalibrationMetric(metric, best) {
				best = metric
			}
		}
	}
	return best
}

func bestCalibrationThreshold(scores []calibrationScore, start, end, step, margin float32) calibrationMetric {
	best := calibrationMetric{Threshold: start, Margin: margin}
	for threshold := start; threshold <= end+0.0001; threshold += step {
		metric := scoreCalibrationCandidate(scores, threshold, margin)
		if betterCalibrationMetric(metric, best) {
			best = metric
		}
	}
	return best
}

func scoreCalibrationCandidate(scores []calibrationScore, threshold, margin float32) calibrationMetric {
	metric := calibrationMetric{Threshold: threshold, Margin: margin}
	for _, score := range scores {
		predicted := score.Score >= threshold
		if margin > 0 && score.MatchType == "image" && score.TopImage > 0 {
			predicted = predicted && score.Score >= score.TopImage-margin
		}
		actual := score.Label == "match"
		switch {
		case predicted && actual:
			metric.TP++
		case predicted && !actual:
			metric.FP++
		case !predicted && actual:
			metric.FN++
		default:
			metric.TN++
		}
	}
	if metric.TP+metric.FP > 0 {
		metric.Precision = float64(metric.TP) / float64(metric.TP+metric.FP)
	}
	if metric.TP+metric.FN > 0 {
		metric.Recall = float64(metric.TP) / float64(metric.TP+metric.FN)
	}
	if metric.Precision+metric.Recall > 0 {
		metric.F1 = 2 * metric.Precision * metric.Recall / (metric.Precision + metric.Recall)
	}
	return metric
}

func betterCalibrationMetric(next, current calibrationMetric) bool {
	if next.F1 != current.F1 {
		return next.F1 > current.F1
	}
	if next.Precision != current.Precision {
		return next.Precision > current.Precision
	}
	if next.Recall != current.Recall {
		return next.Recall > current.Recall
	}
	return next.Threshold < current.Threshold
}

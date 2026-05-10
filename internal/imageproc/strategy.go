package imageproc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
)

type OptimizationExternalTool struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

type OptimizationStrategy struct {
	ID       string                     `json:"id"`
	Name     string                     `json:"name"`
	Enabled  bool                       `json:"enabled"`
	Priority int                        `json:"priority"`
	Match    OptimizationStrategyMatch  `json:"match"`
	Action   OptimizationStrategyAction `json:"action"`
}

type OptimizationStrategyMatch struct {
	Formats      []string `json:"formats"`
	Alpha        string   `json:"alpha"`
	Animated     string   `json:"animated"`
	AICategories []string `json:"aiCategories,omitempty"`
	MinBytesKB   *int     `json:"minBytesKB,omitempty"`
	MinWidthPx   *int     `json:"minWidthPx,omitempty"`
	MinHeightPx  *int     `json:"minHeightPx,omitempty"`
}

type OptimizationStrategyAction struct {
	Operation            string `json:"operation"`
	OutputFormat         string `json:"outputFormat,omitempty"`
	Quality              *int   `json:"quality,omitempty"`
	AvifSpeed            *int   `json:"avifSpeed,omitempty"`
	ResizeMaxDimensionPx *int   `json:"resizeMaxDimensionPx,omitempty"`
	PreserveAnimation    *bool  `json:"preserveAnimation,omitempty"`
}

func DefaultOptimizationExternalTools() []OptimizationExternalTool {
	return []OptimizationExternalTool{
		{ID: "ffmpeg", Enabled: false},
		{ID: "cwebp", Enabled: false},
		{ID: "avifenc", Enabled: false},
		{ID: "gifsicle", Enabled: false},
		{ID: "svgo", Enabled: false},
		{ID: "magick", Enabled: false},
		{ID: "oxipng", Enabled: false},
	}
}

func KnownOptimizationExternalToolIDs() map[string]bool {
	out := map[string]bool{}
	for _, tool := range DefaultOptimizationExternalTools() {
		out[tool.ID] = true
	}
	return out
}

func DefaultOptimizationStrategies() []OptimizationStrategy {
	return []OptimizationStrategy{
		{
			ID: "svg-minify", Name: "SVG minify", Enabled: true, Priority: 10,
			Match:  OptimizationStrategyMatch{Formats: []string{"svg"}, Alpha: "any", Animated: "any"},
			Action: OptimizationStrategyAction{Operation: "svg-minify", OutputFormat: "svg"},
		},
		{
			ID: "oversized-raster-resize", Name: "Oversized raster resize", Enabled: true, Priority: 20,
			Match:  OptimizationStrategyMatch{Formats: []string{"png", "jpg", "jpeg", "webp", "gif"}, Alpha: "any", Animated: "any"},
			Action: OptimizationStrategyAction{Operation: "resize"},
		},
		{
			ID: "png-opaque-avif", Name: "PNG opaque to AVIF", Enabled: true, Priority: 30,
			Match:  OptimizationStrategyMatch{Formats: []string{"png"}, Alpha: "opaque", Animated: "false"},
			Action: OptimizationStrategyAction{Operation: "convert", OutputFormat: "avif", Quality: intPtr(50), AvifSpeed: intPtr(6)},
		},
		{
			ID: "png-alpha-webp", Name: "PNG transparent to WebP", Enabled: true, Priority: 40,
			Match:  OptimizationStrategyMatch{Formats: []string{"png"}, Alpha: "transparent", Animated: "false"},
			Action: OptimizationStrategyAction{Operation: "convert", OutputFormat: "webp", Quality: intPtr(80)},
		},
		{
			ID: "jpeg-large-avif", Name: "JPEG large to AVIF", Enabled: true, Priority: 50,
			Match:  OptimizationStrategyMatch{Formats: []string{"jpg", "jpeg"}, Alpha: "opaque", Animated: "false", MinBytesKB: intPtr(200)},
			Action: OptimizationStrategyAction{Operation: "convert", OutputFormat: "avif", Quality: intPtr(50), AvifSpeed: intPtr(6)},
		},
		{
			ID: "gif-animated-keep-gif", Name: "GIF animated recompress", Enabled: true, Priority: 60,
			Match:  OptimizationStrategyMatch{Formats: []string{"gif"}, Alpha: "any", Animated: "true"},
			Action: OptimizationStrategyAction{Operation: "recompress", OutputFormat: "gif", Quality: intPtr(75), PreserveAnimation: boolPtr(true)},
		},
		{
			ID: "webp-large-recompress", Name: "WebP large recompress", Enabled: true, Priority: 70,
			Match:  OptimizationStrategyMatch{Formats: []string{"webp"}, Alpha: "any", Animated: "any", MinBytesKB: intPtr(800)},
			Action: OptimizationStrategyAction{Operation: "recompress", OutputFormat: "webp", Quality: intPtr(60)},
		},
	}
}

func NormalizeOptimizationStrategies(strategies []OptimizationStrategy) []OptimizationStrategy {
	if len(strategies) == 0 {
		strategies = DefaultOptimizationStrategies()
	}
	out := make([]OptimizationStrategy, 0, len(strategies))
	for index, strategy := range strategies {
		if strategy.ID == "" {
			strategy.ID = "strategy-" + string(rune('a'+index))
		}
		if strategy.Name == "" {
			strategy.Name = strategy.ID
		}
		if strategy.Priority == 0 {
			strategy.Priority = (index + 1) * 10
		}
		strategy.Match.Formats = NormalizeOptimizationFormats(strategy.Match.Formats)
		if strategy.Match.Alpha == "" {
			strategy.Match.Alpha = "any"
		}
		if strategy.Match.Animated == "" {
			strategy.Match.Animated = "any"
		}
		strategy.Match.AICategories = normalizeAICategories(strategy.Match.AICategories)
		strategy.Action.OutputFormat = NormalizeOptimizationFormat(strategy.Action.OutputFormat)
		out = append(out, strategy)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Priority < out[j].Priority
	})
	return out
}

func NormalizeOptimizationFormats(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = NormalizeOptimizationFormat(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func NormalizeOptimizationFormat(value string) string {
	value = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "."))
	if value == "jpeg" {
		return "jpg"
	}
	return value
}

func OptimizationStrategyHash(strategies []OptimizationStrategy, thresholds OptimizationThresholds) string {
	payload := struct {
		Strategies  []OptimizationStrategy `json:"strategies"`
		Thresholds  OptimizationThresholds `json:"thresholds"`
		DefaultHash string                 `json:"defaultHash"`
	}{
		Strategies: NormalizeOptimizationStrategies(strategies),
		Thresholds: thresholds,
	}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8])
}

func normalizeAICategories(categories []string) []string {
	if len(categories) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := []string{}
	for _, c := range categories {
		c = strings.ToLower(strings.TrimSpace(c))
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func intPtr(value int) *int {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

package precheck

import (
	"encoding/json"
	"regexp"
	"strings"
)

var localeNames = map[string]string{
	"en":    "English",
	"zh-TW": "Traditional Chinese (繁體中文)",
	"zh-CN": "Simplified Chinese (简体中文)",
	"ja":    "Japanese (日本語)",
	"ko":    "Korean (한국어)",
}

func LocaleDisplayName(lang string) string {
	if name, ok := localeNames[lang]; ok {
		return name
	}
	return ""
}

const PrecheckAIPrompt = `Analyze this image for an asset library pre-import check. Respond with a JSON object containing:
- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork", "other"
- "tags": array of 3-5 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "hero-section")
- "description": one sentence describing the image content
- "quality": object with:
  - "score": integer 1-5 (1=unusable, 2=poor, 3=acceptable, 4=good, 5=excellent)
  - "issues": array of applicable issue codes from ["blurry", "low_resolution", "noisy", "truncated", "watermarked"] (empty array if none)
  - "assessment": one sentence quality summary
- "suggestion": object with:
  - "recommendedFilename": suggested kebab-case filename without extension
  - "formatRecommendation": format conversion advice, or empty string if current format is fine
  - "suitability": one of "good", "acceptable", "poor"
  - "suitabilityReason": one sentence explaining the suitability rating

Respond ONLY with valid JSON, no markdown or explanation.`

type AIQuality struct {
	Score      int      `json:"score"`
	Issues     []string `json:"issues"`
	Assessment string   `json:"assessment"`
}

type AISuggestion struct {
	RecommendedFilename  string `json:"recommendedFilename"`
	FormatRecommendation string `json:"formatRecommendation"`
	Suitability          string `json:"suitability"`
	SuitabilityReason    string `json:"suitabilityReason"`
}

type AIResult struct {
	Name        string       `json:"name"`
	Status      string       `json:"status"`
	Category    string       `json:"category"`
	Tags        []string     `json:"tags"`
	Description string       `json:"description"`
	Quality     AIQuality    `json:"quality"`
	Suggestion  AISuggestion `json:"suggestion"`
	ErrorCode   string       `json:"errorCode,omitempty"`
	ErrorMsg    string       `json:"errorMessage,omitempty"`
	DurationMs  int64        `json:"durationMs"`
}

func ParseAIResponse(name, raw string) AIResult {
	content := strings.TrimSpace(raw)
	content = stripFences(content)
	content = fixJSON(content)

	var parsed struct {
		Category    string       `json:"category"`
		Tags        []string     `json:"tags"`
		Description string       `json:"description"`
		Quality     AIQuality    `json:"quality"`
		Suggestion  AISuggestion `json:"suggestion"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return AIResult{
			Name:      name,
			Status:    "failed",
			ErrorCode: "precheck_ai_parse_failed",
			ErrorMsg:  "failed to parse VLM JSON: " + err.Error(),
		}
	}

	result := AIResult{
		Name:        name,
		Status:      "ready",
		Category:    strings.ToLower(strings.TrimSpace(parsed.Category)),
		Description: strings.TrimSpace(parsed.Description),
		Quality:     parsed.Quality,
		Suggestion:  parsed.Suggestion,
	}
	if parsed.Tags != nil {
		result.Tags = parsed.Tags
	} else {
		result.Tags = []string{}
	}
	if result.Quality.Issues == nil {
		result.Quality.Issues = []string{}
	}
	result.Suggestion.Suitability = strings.ToLower(strings.TrimSpace(result.Suggestion.Suitability))
	return result
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
	}
	return strings.TrimSpace(s)
}

var (
	trailingCommaRe = regexp.MustCompile(`,\s*([}\]])`)
	missingCommaRe  = regexp.MustCompile(`(["\d\]}\w])\s*\n\s*"`)
)

func fixJSON(s string) string {
	start := strings.Index(s, "{")
	if start < 0 {
		return s
	}
	s = s[start:]
	depth := 0
	inStr := false
	esc := false
	end := len(s)
	for i, c := range s {
		if esc {
			esc = false
			continue
		}
		if c == '\\' && inStr {
			esc = true
			continue
		}
		if c == '"' {
			inStr = !inStr
			continue
		}
		if inStr {
			continue
		}
		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	s = s[:end]
	s = trailingCommaRe.ReplaceAllString(s, "$1")
	s = missingCommaRe.ReplaceAllString(s, `$1,"`)
	return s
}

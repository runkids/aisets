package precheck

import (
	"encoding/json"
	"fmt"
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

const PrecheckAIPrompt = `You are reviewing an image file for an asset library pre-import check.

{{precheckFindings}}

Based on the image content AND the analysis above, respond as JSON:
{
  "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork", "other",
  "tags": array of 3-5 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "hero-section"),
  "description": one sentence describing the image content,
  "quality": {
    "score": integer 1-5 (1=unusable, 2=poor, 3=acceptable, 4=good, 5=excellent),
    "issues": array of applicable codes from ["blurry", "low_resolution", "noisy", "truncated", "watermarked"] (empty if none),
    "assessment": one sentence quality summary
  },
  "suggestion": {
    "recommendedFilename": suggested kebab-case filename without extension,
    "formatRecommendation": format conversion advice considering the analysis above, or empty string if current format is fine,
    "suitability": one of "good", "acceptable", "poor",
    "suitabilityReason": one sentence explaining the rating, referencing duplicate/naming/optimization findings if relevant
  }
}

Important:
- If duplicate or near-duplicate matches exist, factor them into suitability (duplicates → "poor")
- If naming issues exist, suggest a clean filename that fixes them
- If optimization issues exist, include format/compression advice in formatRecommendation
- Your recommendation should complement, not contradict, the analysis findings

Respond ONLY with valid JSON, no markdown or explanation.`

func FormatPrecheckFindings(r Result) string {
	var b strings.Builder
	b.WriteString("File: " + r.Name + " (" + r.Ext + ", " + formatSize(r.Size) + ")")
	if r.Image.Width > 0 {
		b.WriteString(" " + strings.TrimSpace(strings.Join([]string{
			r.Image.Format,
			fmt.Sprintf("%dx%d", r.Image.Width, r.Image.Height),
		}, " ")))
	}
	b.WriteString("\n")

	if len(r.ExactMatches) > 0 {
		b.WriteString(fmt.Sprintf("\nExact duplicates found: %d match(es) already in catalog.\n", len(r.ExactMatches)))
	}
	if len(r.NearMatches) > 0 {
		b.WriteString(fmt.Sprintf("\nNear-duplicate matches: %d visually similar asset(s) found.\n", len(r.NearMatches)))
	}
	if len(r.NamingIssues) > 0 {
		b.WriteString("\nNaming issues:\n")
		for _, n := range r.NamingIssues {
			b.WriteString("- " + n.Message + "\n")
		}
	}
	if len(r.Optimization) > 0 {
		b.WriteString("\nOptimization findings:\n")
		for _, o := range r.Optimization {
			b.WriteString("- [" + o.Severity + "] " + o.Reason + " → " + o.Suggestion + "\n")
		}
	}
	if len(r.ExactMatches) == 0 && len(r.NearMatches) == 0 && len(r.NamingIssues) == 0 && len(r.Optimization) == 0 {
		b.WriteString("\nNo issues detected by static analysis.\n")
	}
	return b.String()
}

func formatSize(bytes int64) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
	case bytes >= 1024:
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

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

package precheck

import (
	"encoding/json"
	"fmt"
	"strings"

	"aisets/internal/llm"
)

const PrecheckAIPrompt = `You are reviewing an image file for an asset library pre-import check.

{{precheckFindings}}

Based on the image content AND the analysis above, respond as JSON:
{
  "category": one of {{categories}},
  "tags": array of 3-5 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "hero-section"),
  "description": one sentence describing the image content,
  "quality": {
    "score": integer 1-5 (1=unusable, 2=poor, 3=acceptable, 4=good, 5=excellent),
    "issues": array of applicable codes from {{qualityIssues}} (empty if none),
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
		b.WriteString(fmt.Sprintf("\nExact duplicates: %d identical file(s) already in catalog:\n", len(r.ExactMatches)))
		for _, m := range r.ExactMatches {
			b.WriteString(fmt.Sprintf("  - %s (project: %s)\n", m.RepoPath, m.ProjectName))
		}
	}
	if len(r.NearMatches) > 0 {
		b.WriteString(fmt.Sprintf("\nNear-duplicate matches: %d visually similar asset(s):\n", len(r.NearMatches)))
		limit := len(r.NearMatches)
		if limit > 10 {
			limit = 10
		}
		for _, m := range r.NearMatches[:limit] {
			pct := 100 * (64 - m.Distance) / 64
			label := fmt.Sprintf("%d%% similar", pct)
			if m.Flipped {
				label += " (flipped)"
			}
			b.WriteString(fmt.Sprintf("  - %s — %s (project: %s)\n", m.RepoPath, label, m.ProjectName))
		}
		if len(r.NearMatches) > 10 {
			b.WriteString(fmt.Sprintf("  ... and %d more\n", len(r.NearMatches)-10))
		}
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
	content := llm.CleanJSON(raw)

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

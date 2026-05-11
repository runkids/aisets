package precheck

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

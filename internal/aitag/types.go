package aitag

const (
	StatusPending = "pending"
	StatusReady   = "ready"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"
)

const TagPrompt = `Analyze this image and respond with a JSON object containing:
- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork"
- "tags": array of 3-8 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "mobile", "login-form", "hero-section")
- "tagsI18n": object mapping locale codes to translated tag arrays: {"zh-TW": [...], "zh-CN": [...], "ja": [...], "ko": [...]}. Each array must have the same length and order as "tags", translated naturally into that locale.
- "description": one sentence describing the image content
- "descriptionI18n": object mapping locale codes to translated descriptions: {"zh-TW": "...", "zh-CN": "...", "ja": "...", "ko": "..."}. Translate the description naturally into each locale.
- "languages": array of ISO 639-3 language codes for any visible text (e.g. ["eng"]). Empty array if no text.
- "containsFace": true if a human face is clearly visible, false otherwise
- "sceneType": one of "indoor", "outdoor", "studio", "digital", "abstract", "unknown"
- "estimatedLocation": a short place description if identifiable from visual cues (landmarks, signage, architecture), or null if not determinable
- "locationConfidence": one of "high", "medium", "low", "none"

Respond ONLY with valid JSON, no markdown or explanation.`

type Result struct {
	ProjectID          string              `json:"projectId"`
	RepoPath           string              `json:"repoPath"`
	ContentHash        string              `json:"contentHash"`
	HashAlgorithm      string              `json:"hashAlgorithm"`
	ProviderName       string              `json:"providerName"`
	ModelName          string              `json:"modelName"`
	Status             string              `json:"status"`
	Category           string              `json:"category"`
	Tags               []string            `json:"tags"`
	TagsI18n           map[string][]string `json:"tagsI18n,omitempty"`
	Description        string              `json:"description"`
	DescriptionI18n    map[string]string   `json:"descriptionI18n,omitempty"`
	Languages          []string            `json:"languages,omitempty"`
	ContainsFace       bool                `json:"containsFace"`
	SceneType          string              `json:"sceneType,omitempty"`
	EstimatedLocation  string              `json:"estimatedLocation,omitempty"`
	LocationConfidence string              `json:"locationConfidence,omitempty"`
	ErrorCode          string              `json:"errorCode,omitempty"`
	ErrorMessage       string              `json:"errorMessage,omitempty"`
	DurationMs         int64               `json:"durationMs"`
	UpdatedAt          string              `json:"updatedAt"`
}

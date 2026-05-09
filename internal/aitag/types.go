package aitag

const PromptVersion = "aisets-tag-v1"

const (
	StatusPending = "pending"
	StatusReady   = "ready"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"
)

var ValidCategories = map[string]bool{
	"icon":         true,
	"photo":        true,
	"screenshot":   true,
	"diagram":      true,
	"illustration": true,
	"pattern":      true,
	"logo":         true,
	"banner":       true,
}

const TagPrompt = `Analyze this image and respond with a JSON object containing:
- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner"
- "tags": array of 3-8 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "mobile", "login-form", "hero-section")
- "description": one sentence describing the image content

Respond ONLY with valid JSON, no markdown or explanation.`

type Result struct {
	ProjectID     string   `json:"projectId"`
	RepoPath      string   `json:"repoPath"`
	ContentHash   string   `json:"contentHash"`
	HashAlgorithm string   `json:"hashAlgorithm"`
	ProviderName  string   `json:"providerName"`
	ModelName     string   `json:"modelName"`
	Status        string   `json:"status"`
	Category      string   `json:"category"`
	Tags          []string `json:"tags"`
	Description   string   `json:"description"`
	ErrorCode     string   `json:"errorCode,omitempty"`
	ErrorMessage  string   `json:"errorMessage,omitempty"`
	DurationMs    int64    `json:"durationMs"`
	UpdatedAt     string   `json:"updatedAt"`
}

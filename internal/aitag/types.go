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
- "description": one sentence describing the image content
- "languages": array of ISO 639-3 language codes for any visible text (e.g. ["eng"]). Empty array if no text.
- "containsFace": true if a human face is clearly visible, false otherwise
- "sceneType": one of "indoor", "outdoor", "studio", "digital", "abstract", "unknown"
- "estimatedLocation": a short place description if identifiable from visual cues (landmarks, signage, architecture), or null if not determinable
- "locationConfidence": one of "high", "medium", "low", "none"

{{translations}}

Respond ONLY with valid JSON, no markdown or explanation.`

var AllI18nLocales = []string{"en", "zh-TW", "zh-CN", "ja", "ko"}

const TagTranslationsBlock = `- "categoryI18n": object mapping locale codes to translated category name: {"zh-TW": "...", "zh-CN": "...", "ja": "...", "ko": "..."}. Translate the category value naturally into each locale.
- "tagsI18n": object mapping locale codes to translated tag arrays: {"zh-TW": [...], "zh-CN": [...], "ja": [...], "ko": [...]}. Each array must have the same length and order as "tags", translated naturally into that locale.
- "descriptionI18n": object mapping locale codes to translated descriptions: {"zh-TW": "...", "zh-CN": "...", "ja": "...", "ko": "..."}. Translate the description naturally into each locale.`

func TagTranslationsBlockForLocale(primaryLocale string) string {
	return TagTranslationsBlockForLocales(primaryLocale, AllI18nLocales)
}

func TagTranslationsBlockForLocales(primaryLocale string, targetLocales []string) string {
	name := localeDisplayNames[primaryLocale]
	if name == "" {
		name = primaryLocale
	}
	locales := excludeLocale(targetLocales, primaryLocale)
	if len(locales) == 0 {
		return ""
	}
	example := buildLocaleExample(locales)
	arrayExample := buildLocaleArrayExample(locales)
	return `NOTE: Write tags as natural-language words in ` + name + `, NOT English kebab-case.

- "categoryI18n": ` + example + ` — translate the category into each locale
- "tagsI18n": ` + arrayExample + ` — same count and order as "tags", translated into each locale
- "descriptionI18n": ` + example + ` — translate the description into each locale

categoryI18n, tagsI18n, and descriptionI18n are REQUIRED fields — do not omit them.`
}

func TagTranslationsBlockDefault(targetLocales []string) string {
	locales := excludeLocale(targetLocales, "en")
	if len(locales) == 0 {
		return ""
	}
	example := buildLocaleExample(locales)
	arrayExample := buildLocaleArrayExample(locales)
	return `- "categoryI18n": ` + example + `. Translate the category value naturally into each locale.
- "tagsI18n": ` + arrayExample + `. Each array must have the same length and order as "tags", translated naturally into that locale.
- "descriptionI18n": ` + example + `. Translate the description naturally into each locale.`
}

var localeDisplayNames = map[string]string{
	"en":    "English",
	"zh-TW": "Traditional Chinese (繁體中文)",
	"zh-CN": "Simplified Chinese (简体中文)",
	"ja":    "Japanese (日本語)",
	"ko":    "Korean (한국어)",
}

func TagPromptLocalized(primaryLocale string) string {
	return TagPromptLocalizedForLocales(primaryLocale, AllI18nLocales)
}

func TagPromptLocalizedForLocales(primaryLocale string, targetLocales []string) string {
	name := localeDisplayNames[primaryLocale]
	if name == "" {
		name = primaryLocale
	}

	locales := excludeLocale(targetLocales, primaryLocale)
	example := buildLocaleExample(locales)
	arrayExample := buildLocaleArrayExample(locales)

	return `Analyze this image and respond with a JSON object. Write ALL human-readable values in ` + name + `.

- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork"
- "categoryI18n": ` + example + ` — translate the category into each locale
- "tags": array of 3-8 descriptive tags in ` + name + `
- "tagsI18n": ` + arrayExample + ` — same count and order as "tags", translated into each locale
- "description": one sentence describing the image in ` + name + `
- "descriptionI18n": ` + example + ` — translate the description into each locale
- "languages": ISO 639-3 codes for any visible text (e.g. ["eng"]), or [] if none
- "containsFace": true if a human face is visible, false otherwise
- "sceneType": one of "indoor", "outdoor", "studio", "digital", "abstract", "unknown"
- "estimatedLocation": short place description if identifiable, or null
- "locationConfidence": one of "high", "medium", "low", "none"

Every field above is REQUIRED. Respond ONLY with valid JSON, no markdown.`
}

func excludeLocale(all []string, exclude string) []string {
	var out []string
	for _, l := range all {
		if l != exclude {
			out = append(out, l)
		}
	}
	if len(out) == 0 {
		return all[1:]
	}
	return out
}

func buildLocaleExample(locales []string) string {
	s := "{"
	for i, l := range locales {
		if i > 0 {
			s += ", "
		}
		s += `"` + l + `": "..."`
	}
	return s + "}"
}

func buildLocaleArrayExample(locales []string) string {
	s := "{"
	for i, l := range locales {
		if i > 0 {
			s += ", "
		}
		s += `"` + l + `": [...]`
	}
	return s + "}"
}

type Result struct {
	ProjectID          string              `json:"projectId"`
	RepoPath           string              `json:"repoPath"`
	ContentHash        string              `json:"contentHash"`
	HashAlgorithm      string              `json:"hashAlgorithm"`
	ProviderName       string              `json:"providerName"`
	ModelName          string              `json:"modelName"`
	Status             string              `json:"status"`
	Category           string              `json:"category"`
	CategoryI18n       map[string]string   `json:"categoryI18n,omitempty"`
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

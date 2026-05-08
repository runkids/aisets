package ocr

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

const (
	StatusPending = "pending"
	StatusReady   = "ready"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"

	TextStatusAvailable = "available"
	TextStatusEmpty     = "empty"

	DefaultMaxPixels   = 2_000_000
	DefaultBatchSize   = 25
	DefaultConcurrency = 1
	MaxConcurrency     = 2

	MaxExtractionAttempts = 4
)

var supportedLanguages = map[string]struct{}{
	"eng":     {},
	"chi_tra": {},
	"chi_sim": {},
	"jpn":     {},
	"kor":     {},
	"fra":     {},
	"deu":     {},
	"spa":     {},
	"por":     {},
	"ita":     {},
	"nld":     {},
	"rus":     {},
	"ukr":     {},
	"ara":     {},
	"hin":     {},
	"tha":     {},
	"vie":     {},
	"ind":     {},
	"msa":     {},
}

type Settings struct {
	Enabled     bool     `json:"ocrEnabled"`
	Languages   []string `json:"ocrLanguages"`
	MaxPixels   int      `json:"ocrMaxPixels"`
	BatchSize   int      `json:"ocrBatchSize"`
	Concurrency int      `json:"ocrConcurrency"`
}

type Result struct {
	ProjectID      string   `json:"projectId,omitempty"`
	RepoPath       string   `json:"repoPath,omitempty"`
	ContentHash    string   `json:"contentHash,omitempty"`
	HashAlgorithm  string   `json:"hashAlgorithm,omitempty"`
	EngineName     string   `json:"engineName,omitempty"`
	EngineVersion  string   `json:"engineVersion,omitempty"`
	SettingsHash   string   `json:"settingsHash,omitempty"`
	Status         string   `json:"status"`
	Text           string   `json:"text,omitempty"`
	NormalizedText string   `json:"normalizedText,omitempty"`
	TextStatus     string   `json:"textStatus,omitempty"`
	EmptyText      bool     `json:"emptyText,omitempty"`
	Languages      []string `json:"languages,omitempty"`
	Scripts        []string `json:"scripts,omitempty"`
	Confidence     *float64 `json:"confidence,omitempty"`
	ErrorCode      string   `json:"errorCode,omitempty"`
	ErrorMessage   string   `json:"errorMessage,omitempty"`
	DurationMs     int64    `json:"durationMs,omitempty"`
	Mode           string   `json:"mode,omitempty"`
	Attempts       int      `json:"attempts,omitempty"`
	UpdatedAt      string   `json:"updatedAt,omitempty"`
}

type LanguagePack struct {
	Language  string `json:"language"`
	Installed bool   `json:"installed"`
	SizeBytes int64  `json:"sizeBytes"`
	Path      string `json:"path,omitempty"`
}

type RuntimeStatus struct {
	AvailableLanguages []LanguagePack `json:"availableLanguages"`
	Installed          bool           `json:"installed"`
	DataDir            string         `json:"dataDir"`
	Platform           string         `json:"platform"`
	EngineName         string         `json:"engineName"`
	EngineVersion      string         `json:"engineVersion"`
	EngineAvailable    bool           `json:"engineAvailable"`
	EngineError        string         `json:"engineError,omitempty"`
}

type Extraction struct {
	Text       string
	Languages  []string
	Scripts    []string
	DurationMs int64
	Mode       string
	Attempts   int
}

type Engine interface {
	Name() string
	Version() string
	Extract(ctx context.Context, path string, languages []string) (Extraction, error)
}

func DefaultSettings() Settings {
	return Settings{
		Enabled:     false,
		Languages:   []string{"eng"},
		MaxPixels:   DefaultMaxPixels,
		BatchSize:   DefaultBatchSize,
		Concurrency: DefaultConcurrency,
	}
}

func NormalizeSettings(settings Settings) Settings {
	defaults := DefaultSettings()
	if len(settings.Languages) == 0 {
		settings.Languages = defaults.Languages
	}
	settings.Languages = NormalizeLanguages(settings.Languages)
	if settings.MaxPixels <= 0 {
		settings.MaxPixels = defaults.MaxPixels
	}
	if settings.BatchSize <= 0 {
		settings.BatchSize = defaults.BatchSize
	}
	if settings.Concurrency <= 0 {
		settings.Concurrency = defaults.Concurrency
	}
	return settings
}

func NormalizeLanguages(languages []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, language := range languages {
		language = strings.TrimSpace(language)
		if language == "" {
			continue
		}
		if _, ok := supportedLanguages[language]; !ok {
			continue
		}
		if _, ok := seen[language]; ok {
			continue
		}
		seen[language] = struct{}{}
		out = append(out, language)
	}
	return out
}

func SupportedLanguage(language string) bool {
	_, ok := supportedLanguages[language]
	return ok
}

func SettingsHash(settings Settings) string {
	settings = NormalizeSettings(settings)
	payload := struct {
		Languages []string `json:"languages"`
		MaxPixels int      `json:"maxPixels"`
	}{
		Languages: append([]string{}, settings.Languages...),
		MaxPixels: settings.MaxPixels,
	}
	sort.Strings(payload.Languages)
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

var whitespacePattern = regexp.MustCompile(`\s+`)

func NormalizeText(text string) string {
	text = strings.TrimSpace(text)
	text = whitespacePattern.ReplaceAllString(text, " ")
	return strings.ToLower(text)
}

func FinalizeResult(result *Result) {
	result.NormalizedText = NormalizeText(result.Text)
	result.EmptyText = result.Status == StatusReady && result.NormalizedText == ""
	if result.Status == StatusReady {
		if result.EmptyText {
			result.TextStatus = TextStatusEmpty
		} else {
			result.TextStatus = TextStatusAvailable
		}
	}
}

func DetectScripts(text string) []string {
	scripts := map[string]struct{}{}
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Han):
			scripts["han"] = struct{}{}
		case unicode.In(r, unicode.Latin):
			scripts["latin"] = struct{}{}
		case unicode.IsNumber(r):
			scripts["number"] = struct{}{}
		}
	}
	out := make([]string, 0, len(scripts))
	for script := range scripts {
		out = append(out, script)
	}
	sort.Strings(out)
	return out
}

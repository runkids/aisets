package server

import "regexp"

type canvasChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type canvasRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type canvasAssetSnapshot struct {
	ID                    string              `json:"id"`
	FileName              string              `json:"fileName,omitempty"`
	ProjectName           string              `json:"projectName,omitempty"`
	RepoPath              string              `json:"repoPath"`
	Ext                   string              `json:"ext"`
	Width                 int                 `json:"width"`
	Height                int                 `json:"height"`
	ImageFormat           string              `json:"imageFormat,omitempty"`
	Animated              bool                `json:"animated,omitempty"`
	Alpha                 bool                `json:"alpha,omitempty"`
	Pages                 int                 `json:"pages,omitempty"`
	Bytes                 int64               `json:"bytes"`
	URL                   string              `json:"url,omitempty"`
	ThumbnailURL          string              `json:"thumbnailUrl,omitempty"`
	Tags                  []string            `json:"tags,omitempty"`
	Description           string              `json:"description,omitempty"`
	OcrText               string              `json:"ocrText,omitempty"`
	UsedByCount           int                 `json:"usedByCount"`
	SearchCategory        string              `json:"searchCategory,omitempty"`
	SearchTags            []string            `json:"searchTags,omitempty"`
	SearchDescription     string              `json:"searchDescription,omitempty"`
	SearchLanguages       []string            `json:"searchLanguages,omitempty"`
	SearchCategoryI18n    map[string]string   `json:"searchCategoryI18n,omitempty"`
	SearchTagsI18n        map[string][]string `json:"searchTagsI18n,omitempty"`
	SearchDescriptionI18n map[string]string   `json:"searchDescriptionI18n,omitempty"`
}

type canvasCardSnapshot struct {
	ID             string               `json:"id"`
	Kind           string               `json:"kind"`
	X              float64              `json:"x"`
	Y              float64              `json:"y"`
	Width          float64              `json:"width,omitempty"`
	Height         float64              `json:"height,omitempty"`
	LayerIndex     int                  `json:"layerIndex,omitempty"`
	Asset          *canvasAssetSnapshot `json:"asset,omitempty"`
	AnchorID       string               `json:"anchorId,omitempty"`
	Text           string               `json:"text,omitempty"`
	Region         *canvasRegion        `json:"region,omitempty"`
	Tool           string               `json:"tool,omitempty"`
	ProposalStatus string               `json:"status,omitempty"`
	Description    string               `json:"description,omitempty"`
	SourceAssetID  string               `json:"sourceAssetId,omitempty"`
	SourceAssetIDs []string             `json:"sourceAssetIds,omitempty"`
	SourceName     string               `json:"sourceName,omitempty"`
	InputBytes     int64                `json:"inputBytes,omitempty"`
	OutputBytes    int64                `json:"outputBytes,omitempty"`
	InputFormat    string               `json:"inputFormat,omitempty"`
	OutputFormat   string               `json:"outputFormat,omitempty"`
	UploadToken    string               `json:"uploadToken,omitempty"`
	UploadFileName string               `json:"uploadFileName,omitempty"`
	UploadWidth    int                  `json:"uploadWidth,omitempty"`
	UploadHeight   int                  `json:"uploadHeight,omitempty"`
	Name           string               `json:"name,omitempty"`
	CardIDs        []string             `json:"cardIds,omitempty"`
}

type canvasViewport struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Scale float64 `json:"scale"`
}

type canvasSnapshot struct {
	Viewport        canvasViewport       `json:"viewport"`
	SelectedCardIDs []string             `json:"selectedCardIds"`
	Cards           []canvasCardSnapshot `json:"cards"`
}

type canvasChatOptions struct {
	ImageOptimizationAdvice bool   `json:"imageOptimizationAdvice"`
	CanvasImageAttached     bool   `json:"-"`
	AutoLocale              bool   `json:"-"`
	CanvasStrategy          string `json:"-"`
	PhotoStagingWorkflow    bool   `json:"-"`
}

type canvasChatRequest struct {
	Messages         []canvasChatMessage `json:"messages"`
	Canvas           canvasSnapshot      `json:"canvas"`
	Locale           string              `json:"locale"`
	Options          canvasChatOptions   `json:"options"`
	SelectedSkillIDs []string            `json:"selectedSkillIds,omitempty"`
	CanvasImage      string              `json:"canvasImage,omitempty"`
	AttachmentTokens []string            `json:"attachmentTokens,omitempty"`
}

type canvasAction struct {
	Tool        string         `json:"tool"`
	Params      map[string]any `json:"params"`
	Description string         `json:"description"`
	Impact      string         `json:"impact"`
}

var actionBlockRe = regexp.MustCompile("(?s)```action\\s*\\n(.*?)\\n```")
var jsonActionBlockRe = regexp.MustCompile("(?s)```json\\s*\\n(.*?)\\n```")
var toolCallRe = regexp.MustCompile(`(?s)<\|?tool_call\|?>\s*(?:call\s*\(?\s*)?(\{.+\})\s*\)?\s*<\|?/?tool_call\|?>`)
var fallbackActionHeaderRe = regexp.MustCompile(`(?mi)^\s*(?:\[action:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]|action:\s*([A-Za-z_][A-Za-z0-9_]*)\s*)$`)
var fallbackActionCoordinateRe = regexp.MustCompile(`(?i)\bx\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*y\s*=\s*(-?\d+(?:\.\d+)?)`)

var toolCallCleanRe = regexp.MustCompile(`(?s)<\|?/?tool_call\|?>`)
var unquotedJSONKeyRe = regexp.MustCompile(`([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:`)
var hanTextRe = regexp.MustCompile(`\p{Han}`)
var kanaTextRe = regexp.MustCompile(`[ぁ-ゟ゠-ヿ]`)
var hangulTextRe = regexp.MustCompile(`[가-힣]`)
var filenameTokenRe = regexp.MustCompile(`(?i)([A-Za-z0-9][A-Za-z0-9_-]*)\.(png|jpe?g|webp|gif|svg|avif|heic)`)
var assetStemTokenRe = regexp.MustCompile(`[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+`)
var markdownImagePathRe = regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)
var absoluteImagePathRe = regexp.MustCompile("(?i)(^|[\\s('\"`<])((?:file://)?/[^\\s'\"<>)]*\\.(?:png|jpe?g|webp|gif|svg|avif|heic|heif))")

type canvasActionSpan struct {
	start, end int
	json       string
	actions    []canvasAction
}

const (
	canvasLoopReasonToolResults              = "tool_results"
	canvasLoopReasonTruncatedAction          = "truncated_action"
	canvasLoopReasonMissingCapture           = "missing_capture"
	canvasLoopReasonTextOnlyDeferredWork     = "text_only_deferred_work"
	canvasLoopReasonFocusOnlyNeedsAnswer     = "focus_only_needs_answer"
	canvasLoopReasonBlockedComment           = "blocked_comment"
	canvasLoopReasonCaptureOnlyWork          = "capture_only_deferred_work"
	canvasLoopReasonInvalidAction            = "invalid_action"
	canvasLoopReasonNativeEmptyFallback      = "native_empty_fallback"
	canvasLoopReasonIncompleteTextAnnotation = "incomplete_text_annotation"
	canvasLoopReasonOCRTextExtraction        = "ocr_text_extraction"
	canvasLoopReasonOCRTextAnnotation        = "ocr_text_annotation"
)

type canvasNextLoopInput struct {
	Loop                      int
	MaxLoops                  int
	ToolResultCount           int
	TruncatedAction           bool
	MissingCapture            bool
	TextOnlyDeferredWork      bool
	FocusOnlyNeedsAnswer      bool
	BlockedCommentNeedsAnswer bool
	CaptureOnlyDeferredWork   bool
	InvalidAction             bool
	IncompleteTextAnnotation  bool
	OCRTextExtraction         bool
	OCRTextAnnotation         bool
}

type canvasCompactToolResult struct {
	Tool    string         `json:"tool"`
	Summary map[string]any `json:"summary,omitempty"`
}

type canvasOCRAnnotationItem struct {
	AssetID      string `json:"assetId"`
	RepoPath     string `json:"repoPath"`
	CardID       string `json:"cardId"`
	FileName     string `json:"fileName"`
	Status       string `json:"status"`
	Text         string `json:"text"`
	ErrorMessage string `json:"errorMessage"`
}

package scanner

import (
	"aisets/internal/aitag"
	"aisets/internal/imageproc"
	"aisets/internal/lint"
	"aisets/internal/ocr"
)

type ScanPhase string

const (
	ScanPhaseCollecting     ScanPhase = "collecting"
	ScanPhaseMetadata       ScanPhase = "metadata"
	ScanPhaseReferences     ScanPhase = "references"
	ScanPhaseDuplicates     ScanPhase = "duplicates"
	ScanPhaseNearDuplicates ScanPhase = "nearDuplicates"
	ScanPhaseLint           ScanPhase = "lint"
	ScanPhasePersisting     ScanPhase = "persisting"
)

type ScanProfile string

const (
	ScanProfileFast   ScanProfile = "fast"
	ScanProfileFull   ScanProfile = "full"
	ScanProfileCustom ScanProfile = "custom"
)

type ProjectScanIntent string

const (
	ProjectScanIntentCode      ProjectScanIntent = "code"
	ProjectScanIntentAssetPack ProjectScanIntent = "assetPack"
	ProjectScanIntentLibrary   ProjectScanIntent = "library"
	ProjectScanIntentMixed     ProjectScanIntent = "mixed"
)

type ExcludePatternsByIntent map[ProjectScanIntent][]string

type ReferenceCoverage string

const (
	ReferenceCoverageSupported     ReferenceCoverage = "supported"
	ReferenceCoveragePartial       ReferenceCoverage = "partial"
	ReferenceCoverageNotApplicable ReferenceCoverage = "notApplicable"
)

type AnalysisState string

const (
	AnalysisComputed    AnalysisState = "computed"
	AnalysisNotComputed AnalysisState = "notComputed"
)

type AnalysisSkipReason string

const (
	AnalysisSkipNone          AnalysisSkipReason = ""
	AnalysisSkipByUser        AnalysisSkipReason = "skippedByUser"
	AnalysisSkipByThreshold   AnalysisSkipReason = "skippedByThreshold"
	AnalysisSkipNotApplicable AnalysisSkipReason = "notApplicable"
)

type UsageClassification string

const (
	UsageReferenced     UsageClassification = "referenced"
	UsageUnused         UsageClassification = "unused"
	UsagePossiblyUnused UsageClassification = "possiblyUnused"
	UsageNotApplicable  UsageClassification = "notApplicable"
)

type LintApplicability string

const (
	LintApplicable    LintApplicability = "applicable"
	LintAdvisory      LintApplicability = "advisory"
	LintNotApplicable LintApplicability = "notApplicable"
)

type AnalysisOptions struct {
	References     bool `json:"references"`
	NearDuplicates bool `json:"nearDuplicates"`
	Optimization   bool `json:"optimization"`
}

type ScanOptions struct {
	Profile                 ScanProfile                      `json:"profile"`
	ExcludePatterns         []string                         `json:"excludePatterns,omitempty"`
	ExcludePatternsByIntent ExcludePatternsByIntent          `json:"excludePatternsByIntent,omitempty"`
	Analyses                AnalysisOptions                  `json:"analyses"`
	OptimizationThresholds  imageproc.OptimizationThresholds `json:"optimizationThresholds,omitempty"`
}

type CatalogAnalysis struct {
	References     AnalysisState `json:"references"`
	NearDuplicates AnalysisState `json:"nearDuplicates"`
	Optimization   AnalysisState `json:"optimization"`
}

type ScanProgress struct {
	Phase   ScanPhase          `json:"phase"`
	Current int                `json:"current,omitempty"`
	Total   int                `json:"total,omitempty"`
	Message string             `json:"message,omitempty"`
	State   AnalysisState      `json:"state,omitempty"`
	Reason  AnalysisSkipReason `json:"reason,omitempty"`
}

type ProgressFunc func(ScanProgress)

type Project struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspaceId,omitempty"`
	Name        string            `json:"name"`
	Path        string            `json:"path"`
	ScanIntent  ProjectScanIntent `json:"scanIntent"`
	CreatedAt   string            `json:"createdAt,omitempty"`
}

type Catalog struct {
	StartedAt       string           `json:"startedAt,omitempty"`
	GeneratedAt     string           `json:"generatedAt"`
	ScanID          int64            `json:"scanId,omitempty"`
	Projects        []Project        `json:"projects"`
	Items           []AssetItem      `json:"items"`
	DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
	NearDuplicates  []NearDuplicate  `json:"nearDuplicates"`
	LintFindings    []lint.Finding   `json:"lintFindings"`
	Stats           CatalogStats     `json:"stats"`
	Analysis        CatalogAnalysis  `json:"analysis"`
}

type CatalogStats struct {
	TotalFiles              int `json:"totalFiles"`
	DuplicateGroups         int `json:"duplicateGroups"`
	DuplicateFiles          int `json:"duplicateFiles"`
	UnusedFiles             int `json:"unusedFiles"`
	PossiblyUnusedFiles     int `json:"possiblyUnusedFiles"`
	UsageNotApplicableFiles int `json:"usageNotApplicableFiles"`
	ReferencedFiles         int `json:"referencedFiles"`
	NearDuplicates          int `json:"nearDuplicates"`
	LintFindings            int `json:"lintFindings"`
	CacheHits               int `json:"cacheHits"`
}

type AssetItem struct {
	ID                     string                   `json:"id"`
	ProjectID              string                   `json:"projectId"`
	ProjectName            string                   `json:"projectName"`
	RepoPath               string                   `json:"repoPath"`
	LocalPath              string                   `json:"localPath"`
	Ext                    string                   `json:"ext"`
	Bytes                  int64                    `json:"bytes"`
	ModifiedUnix           int64                    `json:"modifiedUnix"`
	ContentHash            string                   `json:"contentHash"`
	HashAlgorithm          string                   `json:"hashAlgorithm"`
	Image                  imageproc.Metadata       `json:"image"`
	DHash                  string                   `json:"dHash,omitempty"`
	DHashFlipped           string                   `json:"dHashFlipped,omitempty"`
	URL                    string                   `json:"url"`
	ThumbnailURL           string                   `json:"thumbnailUrl"`
	UsedBy                 []string                 `json:"usedBy"`
	References             []AssetReference         `json:"references"`
	DuplicateGroupID       *string                  `json:"duplicateGroupId"`
	Duplicates             []string                 `json:"duplicates"`
	Similar                []string                 `json:"similar"`
	PreferredDuplicatePath *string                  `json:"preferredDuplicatePath"`
	Optimization           []OptimizationSuggestion `json:"optimizationRecommendations"`
	OCR                    *ocr.Result              `json:"ocr,omitempty"`
	AITag                  *aitag.Result            `json:"aiTag,omitempty"`
	EXIF                   *imageproc.EXIFData      `json:"exif,omitempty"`
	ScanIntent             ProjectScanIntent        `json:"scanIntent"`
	UsageClassification    UsageClassification      `json:"usageClassification"`
	DeleteUnusedAllowed    bool                     `json:"deleteUnusedAllowed"`
	LintApplicability      LintApplicability        `json:"lintApplicability"`
}

type AssetReference struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Specifier string `json:"specifier"`
	Kind      string `json:"kind"`
	Snippet   string `json:"snippet,omitempty"`
}

type DuplicateGroup struct {
	ID            string   `json:"id"`
	ContentHash   string   `json:"contentHash"`
	HashAlgorithm string   `json:"hashAlgorithm"`
	Paths         []string `json:"paths"`
	PreferredPath string   `json:"preferredPath"`
}

type NearDuplicate struct {
	ID        string `json:"id"`
	LeftID    string `json:"leftId"`
	RightID   string `json:"rightId"`
	LeftPath  string `json:"leftPath"`
	RightPath string `json:"rightPath"`
	Distance  int    `json:"distance"`
	Flipped   bool   `json:"flipped"`
}

type OptimizationSuggestion struct {
	Category           string `json:"category"`
	ReasonCode         string `json:"reasonCode"`
	Reason             string `json:"reason"`
	Severity           string `json:"severity"`
	SuggestionCode     string `json:"suggestionCode"`
	Suggestion         string `json:"suggestion"`
	Operation          string `json:"operation,omitempty"`
	EstimatedBytes     int64  `json:"estimatedBytes,omitempty"`
	SavingsBytes       int64  `json:"savingsBytes,omitempty"`
	HasExistingVariant bool   `json:"hasExistingVariant,omitempty"`
	VariantBytes       int64  `json:"variantBytes,omitempty"`
}

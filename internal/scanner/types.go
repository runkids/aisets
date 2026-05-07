package scanner

import (
	"asset-studio/internal/imageproc"
	"asset-studio/internal/lint"
	"asset-studio/internal/ocr"
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

type ScanProgress struct {
	Phase   ScanPhase `json:"phase"`
	Current int       `json:"current,omitempty"`
	Total   int       `json:"total,omitempty"`
	Message string    `json:"message,omitempty"`
}

type ProgressFunc func(ScanProgress)

type Project struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	CreatedAt   string `json:"createdAt,omitempty"`
}

type Catalog struct {
	GeneratedAt     string           `json:"generatedAt"`
	Projects        []Project        `json:"projects"`
	Items           []AssetItem      `json:"items"`
	DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
	NearDuplicates  []NearDuplicate  `json:"nearDuplicates"`
	LintFindings    []lint.Finding   `json:"lintFindings"`
	Stats           CatalogStats     `json:"stats"`
}

type CatalogStats struct {
	TotalFiles      int `json:"totalFiles"`
	DuplicateGroups int `json:"duplicateGroups"`
	DuplicateFiles  int `json:"duplicateFiles"`
	UnusedFiles     int `json:"unusedFiles"`
	NearDuplicates  int `json:"nearDuplicates"`
	LintFindings    int `json:"lintFindings"`
	CacheHits       int `json:"cacheHits"`
}

type AssetItem struct {
	ID                     string                   `json:"id"`
	ProjectID              string                   `json:"projectId"`
	ProjectName            string                   `json:"projectName"`
	RepoPath               string                   `json:"repoPath"`
	LocalPath              string                   `json:"localPath"`
	Ext                    string                   `json:"ext"`
	Bytes                  int64                    `json:"bytes"`
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
}

type AssetReference struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Specifier string `json:"specifier"`
	Kind      string `json:"kind"`
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
	Category       string `json:"category"`
	ReasonCode     string `json:"reasonCode"`
	Reason         string `json:"reason"`
	Severity       string `json:"severity"`
	SuggestionCode string `json:"suggestionCode"`
	Suggestion     string `json:"suggestion"`
	EstimatedBytes int64  `json:"estimatedBytes,omitempty"`
	SavingsBytes   int64  `json:"savingsBytes,omitempty"`
}

package config

import (
	"aisets/internal/imageproc"
	"aisets/internal/scanner"
)

type Workspace struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IconImage    string `json:"iconImage,omitempty"`
	ProjectCount int    `json:"projectCount"`
}

type Project struct {
	ID          string                    `json:"id"`
	WorkspaceID string                    `json:"workspaceId"`
	Name        string                    `json:"name"`
	Path        string                    `json:"path"`
	IconImage   string                    `json:"iconImage,omitempty"`
	ScanIntent  scanner.ProjectScanIntent `json:"scanIntent"`
	CreatedAt   string                    `json:"createdAt,omitempty"`
}

type AppSettings struct {
	WorkspaceName              string                               `json:"workspaceName"`
	ActiveWorkspaceID          string                               `json:"activeWorkspaceId"`
	DefaultProjectRoot         string                               `json:"defaultProjectRoot"`
	AutoScanOnOpen             bool                                 `json:"autoScanOnOpen"`
	ScanOnOpen                 bool                                 `json:"scanOnOpen"`
	ScanProfile                scanner.ScanProfile                  `json:"scanProfile"`
	ScanAnalyses               scanner.AnalysisOptions              `json:"scanAnalyses"`
	OCREnabled                 bool                                 `json:"ocrEnabled"`
	OCRLanguages               []string                             `json:"ocrLanguages"`
	OCRMaxPixels               int                                  `json:"ocrMaxPixels"`
	OCRBatchSize               int                                  `json:"ocrBatchSize"`
	OCRConcurrency             int                                  `json:"ocrConcurrency"`
	OCRFuzzySearch             bool                                 `json:"ocrFuzzySearch"`
	ExcludePatterns            []string                             `json:"excludePatterns"`
	ExcludePatternsByIntent    scanner.ExcludePatternsByIntent      `json:"excludePatternsByIntent"`
	OptimizationDefaultQuality int                                  `json:"optimizationDefaultQuality"`
	OptimizationWorkers        int                                  `json:"optimizationWorkers"`
	OptimizationAvifSpeed      int                                  `json:"optimizationAvifSpeed"`
	OptimizationAutoApply      bool                                 `json:"optimizationAutoApply"`
	OptimizationThresholds     imageproc.OptimizationThresholds     `json:"optimizationThresholds"`
	OptimizationExternalTools  []imageproc.OptimizationExternalTool `json:"optimizationExternalTools"`
	OptimizationStrategies     []imageproc.OptimizationStrategy     `json:"optimizationStrategies"`
	CustomAssetFilters         []CustomAssetFilter                  `json:"customAssetFilters"`
	PreferredEditor            string                               `json:"preferredEditor"`
}

type SettingsUpdate struct {
	WorkspaceName              *string                              `json:"workspaceName"`
	ActiveWorkspaceID          *string                              `json:"activeWorkspaceId"`
	DefaultProjectRoot         *string                              `json:"defaultProjectRoot"`
	AutoScanOnOpen             *bool                                `json:"autoScanOnOpen"`
	ScanOnOpen                 *bool                                `json:"scanOnOpen"`
	ScanProfile                *scanner.ScanProfile                 `json:"scanProfile"`
	ScanAnalyses               *scanner.AnalysisOptions             `json:"scanAnalyses"`
	OCREnabled                 *bool                                `json:"ocrEnabled"`
	OCRLanguages               []string                             `json:"ocrLanguages"`
	OCRMaxPixels               *int                                 `json:"ocrMaxPixels"`
	OCRBatchSize               *int                                 `json:"ocrBatchSize"`
	OCRConcurrency             *int                                 `json:"ocrConcurrency"`
	OCRFuzzySearch             *bool                                `json:"ocrFuzzySearch"`
	ExcludePatterns            []string                             `json:"excludePatterns"`
	ExcludePatternsByIntent    scanner.ExcludePatternsByIntent      `json:"excludePatternsByIntent"`
	OptimizationDefaultQuality *int                                 `json:"optimizationDefaultQuality"`
	OptimizationWorkers        *int                                 `json:"optimizationWorkers"`
	OptimizationAvifSpeed      *int                                 `json:"optimizationAvifSpeed"`
	OptimizationAutoApply      *bool                                `json:"optimizationAutoApply"`
	OptimizationThresholds     *imageproc.OptimizationThresholds    `json:"optimizationThresholds"`
	OptimizationExternalTools  []imageproc.OptimizationExternalTool `json:"optimizationExternalTools"`
	OptimizationStrategies     []imageproc.OptimizationStrategy     `json:"optimizationStrategies"`
	CustomAssetFilters         []CustomAssetFilter                  `json:"customAssetFilters"`
	PreferredEditor            *string                              `json:"preferredEditor"`
}

type CustomAssetFilter struct {
	ID      string                   `json:"id"`
	Name    string                   `json:"name"`
	Enabled bool                     `json:"enabled"`
	Groups  []CustomAssetFilterGroup `json:"groups"`
}

type CustomAssetFilterGroup struct {
	Clauses []CustomAssetFilterClause `json:"clauses"`
}

type CustomAssetFilterClause struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type ExportData struct {
	Version    int          `json:"version"`
	ExportedAt string       `json:"exportedAt"`
	Workspaces []Workspace  `json:"workspaces,omitempty"`
	Projects   []Project    `json:"projects"`
	Settings   *AppSettings `json:"settings,omitempty"`
}

type ScanSummary struct {
	ID              int64                   `json:"id"`
	StartedAt       string                  `json:"startedAt"`
	CompletedAt     string                  `json:"completedAt,omitempty"`
	Status          string                  `json:"status"`
	Profile         scanner.ScanProfile     `json:"profile"`
	ProjectCount    int                     `json:"projectCount"`
	TotalFiles      int                     `json:"totalFiles"`
	DuplicateGroups int                     `json:"duplicateGroups"`
	DuplicateFiles  int                     `json:"duplicateFiles"`
	UnusedFiles     int                     `json:"unusedFiles"`
	NearDuplicates  int                     `json:"nearDuplicates"`
	CacheHits       int                     `json:"cacheHits"`
	Analysis        scanner.CatalogAnalysis `json:"analysis"`
}

type ScanDiff struct {
	Base              ScanSummary        `json:"base"`
	Target            ScanSummary        `json:"target"`
	Summary           ScanDiffSummary    `json:"summary"`
	Added             []ScanAssetDiff    `json:"added"`
	Removed           []ScanAssetDiff    `json:"removed"`
	Modified          []ScanAssetDiff    `json:"modified"`
	ReferenceChanges  []ScanAssetDiff    `json:"referenceChanges"`
	UnusedTransitions []UnusedTransition `json:"unusedTransitions"`
}

type ScanDiffSummary struct {
	Added                    int   `json:"added"`
	Removed                  int   `json:"removed"`
	Modified                 int   `json:"modified"`
	ReferenceChanged         int   `json:"referenceChanged"`
	BecameUnused             int   `json:"becameUnused"`
	NoLongerUnused           int   `json:"noLongerUnused"`
	TotalByteDelta           int64 `json:"totalByteDelta"`
	OptimizationSavingsDelta int64 `json:"optimizationSavingsDelta"`
	DuplicateGroupsDelta     int   `json:"duplicateGroupsDelta"`
	NearDuplicatesDelta      int   `json:"nearDuplicatesDelta"`
}

type ScanAssetDiff struct {
	ProjectID       string  `json:"projectId"`
	ProjectName     string  `json:"projectName"`
	RepoPath        string  `json:"repoPath"`
	Ext             string  `json:"ext"`
	BeforeBytes     *int64  `json:"beforeBytes,omitempty"`
	AfterBytes      *int64  `json:"afterBytes,omitempty"`
	BeforeHash      *string `json:"beforeHash,omitempty"`
	AfterHash       *string `json:"afterHash,omitempty"`
	BeforeUsedCount *int    `json:"beforeUsedCount,omitempty"`
	AfterUsedCount  *int    `json:"afterUsedCount,omitempty"`
}

type UnusedTransition struct {
	ProjectID       string `json:"projectId"`
	ProjectName     string `json:"projectName"`
	RepoPath        string `json:"repoPath"`
	Ext             string `json:"ext"`
	Direction       string `json:"direction"`
	BeforeUsedCount int    `json:"beforeUsedCount"`
	AfterUsedCount  int    `json:"afterUsedCount"`
}

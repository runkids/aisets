package config

import (
	"aisets/internal/lint"
	"aisets/internal/scanner"
)

const catalogItemsLimitMax = 200

type CatalogSummary struct {
	ScanID       int64                   `json:"scanId"`
	StartedAt    string                  `json:"startedAt"`
	GeneratedAt  string                  `json:"generatedAt"`
	Projects     []Project               `json:"projects"`
	ProjectStats []CatalogProjectStats   `json:"projectStats"`
	Stats        scanner.CatalogStats    `json:"stats"`
	Analysis     scanner.CatalogAnalysis `json:"analysis"`
}

type CatalogProjectStats struct {
	ProjectID               string `json:"projectId"`
	TotalFiles              int    `json:"totalFiles"`
	TotalBytes              int64  `json:"totalBytes"`
	UnusedFiles             int    `json:"unusedFiles"`
	PossiblyUnusedFiles     int    `json:"possiblyUnusedFiles"`
	UsageNotApplicableFiles int    `json:"usageNotApplicableFiles"`
	ReferencedFiles         int    `json:"referencedFiles"`
	DuplicateFiles          int    `json:"duplicateFiles"`
	DuplicateGroups         int    `json:"duplicateGroups"`
	OptimizableFiles        int    `json:"optimizableFiles"`
	LintFindings            int    `json:"lintFindings"`
}

type CatalogItemQuery struct {
	ScanID               int64
	AssetID              string
	ProjectID            string
	ProjectName          string
	Ext                  string
	Folder               string
	Query                string
	Status               string
	Sort                 string
	CustomFilterID       string
	OptimizationCategory string
	OptimizationSeverity string
	Operation            string
	AICategory           string
	AIOcrStatus          string
	Limit                int
	Cursor               string
}

type CatalogItemsPage struct {
	Items      []scanner.AssetItem `json:"items"`
	Total      int                 `json:"total"`
	NextCursor string              `json:"nextCursor,omitempty"`
	Facets     CatalogItemFacets   `json:"facets"`
}

type CatalogFacetOption struct {
	ID    string `json:"id"`
	Count int    `json:"count"`
}

type CatalogCustomFilterFacet struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Count   int    `json:"count"`
	UsesOCR bool   `json:"usesOCR"`
}

type CatalogItemFacets struct {
	Projects                 []CatalogFacetOption       `json:"projects"`
	ProjectTotal             int                        `json:"projectTotal"`
	Extensions               []CatalogFacetOption       `json:"extensions"`
	ExtensionTotal           int                        `json:"extensionTotal"`
	OptimizationCategories   []CatalogFacetOption       `json:"optimizationCategories"`
	OptimizationSeverities   []CatalogFacetOption       `json:"optimizationSeverities"`
	Operations               []CatalogFacetOption       `json:"operations"`
	OptimizationTotal        int                        `json:"optimizationTotal"`
	OptimizationPendingTotal int                        `json:"optimizationPendingTotal"`
	OptimizationDoneTotal    int                        `json:"optimizationDoneTotal"`
	CustomFilters            []CatalogCustomFilterFacet `json:"customFilters"`
	CustomFilterTotal        int                        `json:"customFilterTotal"`
	AICategories             []CatalogFacetOption       `json:"aiCategories"`
	AICategoryTotal          int                        `json:"aiCategoryTotal"`
	OCRReadyCount            int                        `json:"ocrReadyCount"`
	VLMOcrReadyCount         int                        `json:"vlmOcrReadyCount"`
	AITagReadyCount          int                        `json:"aiTagReadyCount"`
}

type CatalogFolderQuery struct {
	ScanID         int64
	ProjectID      string
	ProjectName    string
	Ext            string
	Folder         string
	Query          string
	Status         string
	CustomFilterID string
}

type CatalogFolderNode struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Count       int    `json:"count"`
	HasChildren bool   `json:"hasChildren"`
}

type CatalogFoldersPage struct {
	Folders []CatalogFolderNode `json:"folders"`
	Total   int                 `json:"total"`
}

type CatalogItemDetail struct {
	Item         scanner.AssetItem                `json:"item"`
	References   []scanner.AssetReference         `json:"references"`
	Duplicates   []scanner.AssetItem              `json:"duplicates"`
	Similar      []scanner.NearDuplicate          `json:"similar"`
	SimilarItems []scanner.AssetItem              `json:"similarItems"`
	Optimization []scanner.OptimizationSuggestion `json:"optimization"`
	OCR          any                              `json:"ocr,omitempty"`
}

type CatalogDuplicatesQuery struct {
	ScanID      int64
	Kind        string
	ProjectName string
	Ext         string
	Cursor      string
	Limit       int
}

type CatalogDuplicateGroup struct {
	ID            string              `json:"id"`
	ContentHash   string              `json:"contentHash"`
	HashAlgorithm string              `json:"hashAlgorithm"`
	Paths         []string            `json:"paths"`
	PreferredPath string              `json:"preferredPath"`
	Members       []scanner.AssetItem `json:"members"`
}

type CatalogDuplicatesPage struct {
	Groups     []CatalogDuplicateGroup `json:"groups"`
	Pairs      []scanner.NearDuplicate `json:"pairs"`
	Total      int                     `json:"total"`
	TotalFiles int                     `json:"totalFiles"`
	NextCursor string                  `json:"nextCursor,omitempty"`
	Facets     CatalogDuplicatesFacets `json:"facets"`
}

type CatalogDuplicatesFacets struct {
	Projects       []CatalogFacetOption `json:"projects"`
	ProjectTotal   int                  `json:"projectTotal"`
	Extensions     []CatalogFacetOption `json:"extensions"`
	ExtensionTotal int                  `json:"extensionTotal"`
}

type CatalogLintQuery struct {
	ScanID      int64
	ProjectID   string
	ProjectName string
	Severity    string
	RuleID      string
	Query       string
	Limit       int
	Cursor      string
}

type CatalogLintFacets struct {
	Projects     []CatalogFacetOption `json:"projects"`
	ProjectTotal int                  `json:"projectTotal"`
	Severities   []CatalogFacetOption `json:"severities"`
	Rules        []CatalogFacetOption `json:"rules"`
}

type CatalogLintPage struct {
	Items      []lint.Finding    `json:"items"`
	Total      int               `json:"total"`
	NextCursor string            `json:"nextCursor,omitempty"`
	Facets     CatalogLintFacets `json:"facets"`
}

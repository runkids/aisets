package scanner

import (
	"aisets/internal/imageproc"
	"aisets/internal/lint"
)

func toScannerOptimization(in []imageproc.Optimization) []OptimizationSuggestion {
	if len(in) == 0 {
		return nil
	}
	out := make([]OptimizationSuggestion, 0, len(in))
	for _, opt := range in {
		out = append(out, OptimizationSuggestion{
			Category:       opt.Category,
			ReasonCode:     opt.ReasonCode,
			Reason:         opt.Reason,
			Severity:       opt.Severity,
			SuggestionCode: opt.SuggestionCode,
			Suggestion:     opt.Suggestion,
			EstimatedBytes: opt.EstimatedBytes,
			SavingsBytes:   opt.SavingsBytes,
		})
	}
	return out
}

func normalizeCatalogSlices(catalog Catalog) Catalog {
	if catalog.Projects == nil {
		catalog.Projects = []Project{}
	}
	if catalog.Items == nil {
		catalog.Items = []AssetItem{}
	}
	if catalog.DuplicateGroups == nil {
		catalog.DuplicateGroups = []DuplicateGroup{}
	}
	if catalog.NearDuplicates == nil {
		catalog.NearDuplicates = []NearDuplicate{}
	}
	if catalog.LintFindings == nil {
		catalog.LintFindings = []lint.Finding{}
	}
	for i := range catalog.Items {
		if catalog.Items[i].UsedBy == nil {
			catalog.Items[i].UsedBy = []string{}
		}
		if catalog.Items[i].References == nil {
			catalog.Items[i].References = []AssetReference{}
		}
		if catalog.Items[i].Duplicates == nil {
			catalog.Items[i].Duplicates = []string{}
		}
		if catalog.Items[i].Similar == nil {
			catalog.Items[i].Similar = []string{}
		}
		if catalog.Items[i].Optimization == nil {
			catalog.Items[i].Optimization = []OptimizationSuggestion{}
		}
	}
	return catalog
}

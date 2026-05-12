package scanner

import "aisets/internal/lint"

func DefaultScanOptions() ScanOptions {
	return ScanOptions{
		Profile: ScanProfileFast,
		Analyses: AnalysisOptions{
			References:     true,
			NearDuplicates: false,
			Optimization:   false,
		},
		LintSettings: lint.DefaultSettings(),
	}
}

func FullScanOptions() ScanOptions {
	return ScanOptions{
		Profile: ScanProfileFull,
		Analyses: AnalysisOptions{
			References:     true,
			NearDuplicates: true,
			Optimization:   true,
		},
		LintSettings: lint.DefaultSettings(),
	}
}

func NormalizeScanOptions(options ScanOptions) ScanOptions {
	switch options.Profile {
	case ScanProfileFull:
		options.Analyses = FullScanOptions().Analyses
	case ScanProfileCustom:
		// Keep explicit analysis switches.
	default:
		options.Profile = ScanProfileFast
		options.Analyses = DefaultScanOptions().Analyses
	}
	options.LintSettings = lint.NormalizeSettings(options.LintSettings)
	return options
}

func AnalysisFromOptions(options ScanOptions) CatalogAnalysis {
	options = NormalizeScanOptions(options)
	return CatalogAnalysis{
		References:     analysisState(options.Analyses.References),
		NearDuplicates: analysisState(options.Analyses.NearDuplicates),
		Optimization:   analysisState(options.Analyses.Optimization),
	}
}

func analysisState(computed bool) AnalysisState {
	if computed {
		return AnalysisComputed
	}
	return AnalysisNotComputed
}

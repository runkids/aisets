package scanner

import "context"

type catalogUsageStats struct {
	unused         int
	possiblyUnused int
	notApplicable  int
	referenced     int
}

func normalizeScanProjects(projects []Project) []Project {
	out := make([]Project, len(projects))
	for i, project := range projects {
		project.ScanIntent = NormalizeProjectScanIntent(project.ScanIntent)
		out[i] = project
	}
	return out
}

func referenceProjects(projects []Project) []Project {
	out := make([]Project, 0, len(projects))
	for _, project := range projects {
		if NormalizeProjectScanIntent(project.ScanIntent) == ProjectScanIntentAssetPack {
			continue
		}
		out = append(out, project)
	}
	return out
}

func referenceItems(items []AssetItem) []AssetItem {
	out := make([]AssetItem, 0, len(items))
	for _, item := range items {
		if NormalizeProjectScanIntent(item.ScanIntent) == ProjectScanIntentAssetPack {
			continue
		}
		out = append(out, item)
	}
	return out
}

func classifyUsage(ctx context.Context, projects []Project, items []AssetItem, options ScanOptions, referencesComputed bool) {
	type policy struct {
		intent   ProjectScanIntent
		coverage ReferenceCoverage
		lint     LintApplicability
	}
	policies := map[string]policy{}
	for _, project := range projects {
		intent := NormalizeProjectScanIntent(project.ScanIntent)
		coverage := ProjectReferenceCoverage(ctx, project, EffectiveExcludePatterns(project, options))
		policies[project.ID] = policy{
			intent:   intent,
			coverage: coverage,
			lint:     projectLintApplicability(coverage, intent),
		}
	}
	for i := range items {
		p := policies[items[i].ProjectID]
		items[i].ScanIntent = NormalizeProjectScanIntent(items[i].ScanIntent)
		items[i].LintApplicability = p.lint
		items[i].UsageClassification = classifyItemUsage(items[i], p.intent, p.coverage, referencesComputed)
		items[i].DeleteUnusedAllowed = items[i].UsageClassification == UsageUnused
	}
}

func classifyItemUsage(item AssetItem, intent ProjectScanIntent, coverage ReferenceCoverage, referencesComputed bool) UsageClassification {
	if NormalizeProjectScanIntent(intent) == ProjectScanIntentAssetPack || coverage == ReferenceCoverageNotApplicable {
		return UsageNotApplicable
	}
	if !referencesComputed {
		return UsageNotApplicable
	}
	if len(item.UsedBy) > 0 {
		return UsageReferenced
	}
	if NormalizeProjectScanIntent(intent) == ProjectScanIntentCode && coverage == ReferenceCoverageSupported {
		return UsageUnused
	}
	return UsagePossiblyUnused
}

func usageStats(items []AssetItem) catalogUsageStats {
	var stats catalogUsageStats
	for _, item := range items {
		switch item.UsageClassification {
		case UsageUnused:
			stats.unused++
		case UsagePossiblyUnused:
			stats.possiblyUnused++
		case UsageNotApplicable:
			stats.notApplicable++
		case UsageReferenced:
			stats.referenced++
		}
	}
	return stats
}

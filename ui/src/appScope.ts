import type { CatalogSummary } from "./types";
import type { Mode } from "./ui";

export type CatalogStats = CatalogSummary["stats"];
export type CatalogProjectStats = CatalogSummary["projectStats"][number];

export type NavigationBadges = {
  projects: number;
  total: number;
  duplicate: number;
  unused: number;
  optimize: number;
  lint: number;
};

export function scopedStatsForProject(
  summary: CatalogSummary | null,
  projectStats: CatalogProjectStats | null,
): CatalogStats {
  if (!summary) {
    return {
      totalFiles: 0,
      duplicateGroups: 0,
      duplicateFiles: 0,
      unusedFiles: 0,
      possiblyUnusedFiles: 0,
      usageNotApplicableFiles: 0,
      referencedFiles: 0,
      nearDuplicates: 0,
      lintFindings: 0,
      cacheHits: 0,
    };
  }
  if (!projectStats) return summary.stats;
  return {
    totalFiles: projectStats.totalFiles,
    duplicateGroups: projectStats.duplicateGroups,
    duplicateFiles: projectStats.duplicateFiles,
    unusedFiles: projectStats.unusedFiles,
    possiblyUnusedFiles: projectStats.possiblyUnusedFiles ?? 0,
    usageNotApplicableFiles: projectStats.usageNotApplicableFiles ?? 0,
    referencedFiles: projectStats.referencedFiles ?? 0,
    nearDuplicates: 0,
    lintFindings: projectStats.lintFindings,
    cacheHits: summary.stats.cacheHits,
  };
}

export function displayTotalsForMode(
  mode: Mode,
  summary: CatalogSummary | null,
  scopedStats: CatalogStats,
  selectedProjectId = "",
) {
  if (!summary) return null;
  return {
    projects:
      mode === "projects" || !selectedProjectId ? summary.projects.length : 1,
    assets:
      mode === "projects" ? summary.stats.totalFiles : scopedStats.totalFiles,
  };
}

export function optimizableBadgeCount(
  summary: CatalogSummary | null,
  selectedProjectStats: CatalogProjectStats | null,
  fallbackCount: number,
) {
  if (selectedProjectStats) return selectedProjectStats.optimizableFiles;
  if (summary) {
    return summary.projectStats.reduce(
      (total, stat) => total + stat.optimizableFiles,
      0,
    );
  }
  return fallbackCount;
}

export function catalogItemsTotalCount(
  firstPageTotal: number | undefined,
  fallbackCount: number,
) {
  return firstPageTotal ?? fallbackCount;
}

export function navigationBadges(
  summary: CatalogSummary | null,
  scopedStats: CatalogStats,
  optimizeCount: number,
): NavigationBadges {
  return {
    projects: summary?.projects.length ?? 0,
    total: scopedStats.totalFiles,
    duplicate:
      summary?.analysis.nearDuplicates === "computed"
        ? scopedStats.duplicateGroups
        : 0,
    unused: scopedStats.unusedFiles,
    optimize: optimizeCount,
    lint: scopedStats.lintFindings,
  };
}

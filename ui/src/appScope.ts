import type { Catalog } from "./types";
import type { Mode } from "./ui";

export type NavigationBadges = {
  projects: number;
  total: number;
  duplicate: number;
  unused: number;
  optimize: number;
  lint: number;
};

export function displayCatalogForMode(
  mode: Mode,
  catalog: Catalog | null,
  scopedCatalog: Catalog | null,
) {
  return mode === "projects" ? catalog : scopedCatalog;
}

export function displayTotalsForMode(
  mode: Mode,
  catalog: Catalog | null,
  scopedCatalog: Catalog | null,
) {
  const displayCatalog = displayCatalogForMode(mode, catalog, scopedCatalog);
  if (!displayCatalog) return null;
  return {
    projects: displayCatalog.projects.length,
    assets: displayCatalog.stats.totalFiles,
  };
}

export function optimizableBadgeCount(
  catalog: Catalog | null,
  selectedProjectStats: Catalog["projectStats"][number] | null,
  fallbackCount: number,
) {
  if (selectedProjectStats) return selectedProjectStats.optimizableFiles;
  if (catalog) {
    return catalog.projectStats.reduce(
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
  catalog: Catalog | null,
  scopedStats: Catalog["stats"],
  optimizeCount: number,
): NavigationBadges {
  return {
    projects: catalog?.projects.length ?? 0,
    total: scopedStats.totalFiles,
    duplicate: scopedStats.duplicateFiles,
    unused: scopedStats.unusedFiles,
    optimize: optimizeCount,
    lint: scopedStats.lintFindings,
  };
}

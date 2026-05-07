import { describe, expect, it } from "vitest";
import {
  catalogItemsTotalCount,
  displayCatalogForMode,
  displayTotalsForMode,
  navigationBadges,
  optimizableBadgeCount,
} from "./appScope";
import type { Catalog, Project } from "./types";

function makeProject(id: string): Project {
  return { id, workspaceId: "default", name: id, path: `/${id}` };
}

function makeCatalog(
  projectIds: string[],
  totalFiles: number,
  optimizableFilesByProject: number[] = [],
): Catalog {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    projects: projectIds.map(makeProject),
    projectStats: projectIds.map((projectId, index) => ({
      projectId,
      totalFiles: index === 0 ? totalFiles : 0,
      totalBytes: 0,
      unusedFiles: 0,
      duplicateFiles: 0,
      optimizableFiles: optimizableFilesByProject[index] ?? 0,
      lintFindings: 0,
    })),
    items: [],
    duplicateGroups: [],
    nearDuplicates: [],
    lintFindings: [],
    stats: {
      totalFiles,
      duplicateGroups: 0,
      duplicateFiles: 0,
      unusedFiles: 0,
      nearDuplicates: 0,
      lintFindings: 0,
      cacheHits: 0,
    },
    analysis: {
      references: "computed",
      nearDuplicates: "computed",
      optimization: "computed",
    },
  };
}

describe("displayCatalogForMode", () => {
  it("uses the full catalog for Projects regardless of the selected project scope", () => {
    const fullCatalog = makeCatalog(["001", "workspace"], 4);
    const scopedCatalog = makeCatalog(["workspace"], 3);

    expect(displayCatalogForMode("projects", fullCatalog, scopedCatalog)).toBe(
      fullCatalog,
    );
    expect(
      displayTotalsForMode("projects", fullCatalog, scopedCatalog),
    ).toEqual({ projects: 2, assets: 4 });
  });

  it("keeps asset workflow modes scoped to the selected project", () => {
    const fullCatalog = makeCatalog(["001", "workspace"], 4);
    const scopedCatalog = makeCatalog(["workspace"], 3);

    expect(displayCatalogForMode("browse", fullCatalog, scopedCatalog)).toBe(
      scopedCatalog,
    );
    expect(displayTotalsForMode("browse", fullCatalog, scopedCatalog)).toEqual({
      projects: 1,
      assets: 3,
    });
  });
});

describe("optimizableBadgeCount", () => {
  it("uses project stats before the Optimize list query has loaded", () => {
    const fullCatalog = makeCatalog(["001", "workspace"], 4, [2, 3]);

    expect(optimizableBadgeCount(fullCatalog, null, 0)).toBe(5);
    expect(
      optimizableBadgeCount(fullCatalog, fullCatalog.projectStats[1], 0),
    ).toBe(3);
    expect(optimizableBadgeCount(null, null, 7)).toBe(7);
  });
});

describe("catalogItemsTotalCount", () => {
  it("uses the server total instead of the loaded page length", () => {
    expect(catalogItemsTotalCount(219, 200)).toBe(219);
    expect(catalogItemsTotalCount(undefined, 200)).toBe(200);
  });
});

describe("navigationBadges", () => {
  it("always counts all Projects while keeping asset workflow counts scoped", () => {
    const fullCatalog = makeCatalog(["001", "workspace"], 4);
    const scopedCatalog = makeCatalog(["workspace"], 3);
    const scopedStats = {
      ...scopedCatalog.stats,
      duplicateFiles: 1,
      unusedFiles: 2,
      lintFindings: 3,
    };

    expect(navigationBadges(fullCatalog, scopedStats, 1)).toEqual({
      projects: 2,
      total: 3,
      duplicate: 1,
      unused: 2,
      optimize: 1,
      lint: 3,
    });
  });
});

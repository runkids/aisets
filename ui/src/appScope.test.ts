import { describe, expect, it } from "vitest";
import {
  catalogItemsTotalCount,
  displayTotalsForMode,
  navigationBadges,
  optimizableBadgeCount,
  scopedStatsForProject,
} from "./appScope";
import type { CatalogSummary, Project } from "./types";

function makeProject(id: string): Project {
  return { id, workspaceId: "default", name: id, path: `/${id}` };
}

function makeSummary(
  projectIds: string[],
  totalFiles: number,
  optimizableFilesByProject: number[] = [],
): CatalogSummary {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    projects: projectIds.map(makeProject),
    projectStats: projectIds.map((projectId, index) => ({
      projectId,
      totalFiles: index === 0 ? totalFiles : 0,
      totalBytes: 0,
      unusedFiles: 0,
      duplicateFiles: 0,
      duplicateGroups: 0,
      optimizableFiles: optimizableFilesByProject[index] ?? 0,
      lintFindings: 0,
    })),
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

describe("scopedStatsForProject", () => {
  it("uses the summary stats when no project is selected", () => {
    const summary = makeSummary(["001", "workspace"], 4);

    expect(scopedStatsForProject(summary, null)).toBe(summary.stats);
  });

  it("derives selected-project totals from projectStats without fake arrays", () => {
    const summary = makeSummary(["001", "workspace"], 4);
    const projectStats = {
      ...summary.projectStats[1],
      totalFiles: 3,
      duplicateFiles: 1,
      duplicateGroups: 1,
      unusedFiles: 2,
      lintFindings: 3,
    };

    expect(scopedStatsForProject(summary, projectStats)).toEqual({
      totalFiles: 3,
      duplicateGroups: 1,
      duplicateFiles: 1,
      unusedFiles: 2,
      possiblyUnusedFiles: 0,
      usageNotApplicableFiles: 0,
      referencedFiles: 0,
      nearDuplicates: 0,
      lintFindings: 3,
      cacheHits: 0,
    });
  });
});

describe("displayTotalsForMode", () => {
  it("uses global summary totals for Projects", () => {
    const summary = makeSummary(["001", "workspace"], 4);
    const scopedStats = { ...summary.stats, totalFiles: 3 };

    expect(displayTotalsForMode("projects", summary, scopedStats)).toEqual({
      projects: 2,
      assets: 4,
    });
  });

  it("uses scoped stats for asset workflow modes", () => {
    const summary = makeSummary(["001", "workspace"], 4);
    const scopedStats = { ...summary.stats, totalFiles: 3 };

    expect(
      displayTotalsForMode("browse", summary, scopedStats, "workspace"),
    ).toEqual({
      projects: 1,
      assets: 3,
    });
  });
});

describe("optimizableBadgeCount", () => {
  it("uses project stats before the Optimize list query has loaded", () => {
    const summary = makeSummary(["001", "workspace"], 4, [2, 3]);

    expect(optimizableBadgeCount(summary, null, 0)).toBe(5);
    expect(optimizableBadgeCount(summary, summary.projectStats[1], 0)).toBe(3);
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
  it("hides duplicate count while duplicate analysis is incomplete", () => {
    const summary = makeSummary(["001"], 4);
    summary.analysis.nearDuplicates = "notComputed";
    const scopedStats = {
      ...summary.stats,
      duplicateGroups: 84,
    };

    expect(navigationBadges(summary, scopedStats, 0).duplicate).toBe(0);
  });

  it("always counts all Projects while keeping asset workflow counts scoped", () => {
    const summary = makeSummary(["001", "workspace"], 4);
    const scopedStats = {
      ...summary.stats,
      totalFiles: 3,
      duplicateGroups: 1,
      duplicateFiles: 2,
      unusedFiles: 2,
      lintFindings: 3,
    };

    expect(navigationBadges(summary, scopedStats, 1)).toEqual({
      projects: 2,
      total: 3,
      duplicate: 1,
      unused: 2,
      optimize: 1,
      lint: 3,
    });
  });
});

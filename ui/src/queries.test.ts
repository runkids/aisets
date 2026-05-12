import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  addProject: vi.fn(),
  applyPreview: vi.fn(),
  clearScanHistory: vi.fn(),
  deleteUnusedPreview: vi.fn(),
  getCatalog: vi.fn(),
  getScanDiff: vi.fn(),
  getScans: vi.fn(),
  getSettings: vi.fn(),
  importSettings: vi.fn(),
  listDirectories: vi.fn(),
  renamePreview: vi.fn(),
  resetDatabase: vi.fn(),
  scanCatalog: vi.fn(),
  updateSettings: vi.fn(),
}));

import {
  applyFavoriteUpdateToCatalogItemsPage,
  catalogKeys,
  directoryListingQueryOptions,
  scanKeys,
} from "./queries";
import type { AssetItem, CatalogItemsPage } from "./types";

function makeItem(id: string, favorite: boolean): AssetItem {
  return {
    id,
    projectId: "project",
    projectName: "Project",
    repoPath: `src/${id}.png`,
    localPath: `/workspace/src/${id}.png`,
    ext: ".png",
    bytes: 1,
    modifiedUnix: 0,
    contentHash: id,
    hashAlgorithm: "sha1",
    image: {
      format: "png",
      width: 1,
      height: 1,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: `/assets/${id}.png`,
    thumbnailUrl: `/assets/${id}.png`,
    usedBy: [],
    references: [],
    duplicateGroupId: null,
    duplicates: [],
    similar: [],
    preferredDuplicatePath: null,
    optimizationRecommendations: [],
    favorite,
  };
}

function makePage(items: AssetItem[], favoriteCount: number): CatalogItemsPage {
  return {
    items,
    total: items.length,
    facets: {
      projects: [],
      projectTotal: items.length,
      extensions: [],
      extensionTotal: items.length,
      optimizationCategories: [],
      optimizationSeverities: [],
      operations: [],
      optimizationTotal: 0,
      optimizationPendingTotal: 0,
      optimizationDoneTotal: 0,
      customFilters: [],
      customFilterTotal: 0,
      aiCategories: [],
      aiCategoryTotal: 0,
      ocrReadyCount: 0,
      vlmOcrReadyCount: 0,
      aiTagReadyCount: 0,
      exifHasGps: 0,
      exifHasCamera: 0,
      favoriteCount,
    },
  };
}

describe("directoryListingQueryOptions", () => {
  it("does not retry missing or invalid directory requests", () => {
    const options = directoryListingQueryOptions("/missing-project", true);

    expect(options.queryKey).toEqual(["directories", "/missing-project"]);
    expect(options.enabled).toBe(true);
    expect(options.retry).toBe(false);
  });
});

describe("scanKeys", () => {
  it("keeps scan diff cache entries scoped to base and target ids", () => {
    expect(scanKeys.diff(1, 2)).toEqual(["scans", "diff", 1, 2]);
    expect(scanKeys.diff(2, 1)).toEqual(["scans", "diff", 2, 1]);
  });
});

describe("catalogKeys", () => {
  it("includes optimization filters in item cache keys", () => {
    const key = catalogKeys.items(1, {
      status: "optimizable",
      optimizationCategory: "format",
      optimizationSeverity: "warning",
      operation: "convert-avif",
    });

    expect(key[3]).toMatchObject({
      status: "optimizable",
      optimizationCategory: "format",
      optimizationSeverity: "warning",
      operation: "convert-avif",
    });
  });
});

describe("applyFavoriteUpdateToCatalogItemsPage", () => {
  it("updates loaded item favorite state and favorite facets immediately", () => {
    const page = makePage([makeItem("a", false), makeItem("b", true)], 1);

    const next = applyFavoriteUpdateToCatalogItemsPage(page, {
      ids: new Set(["a"]),
      favorite: true,
    });

    expect(next.items.map((item) => [item.id, item.favorite])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(next.facets.favoriteCount).toBe(2);
  });

  it("removes unfavorited items from favorite-filtered pages", () => {
    const page = makePage([makeItem("a", true), makeItem("b", true)], 2);

    const next = applyFavoriteUpdateToCatalogItemsPage(
      page,
      {
        ids: new Set(["a"]),
        favorite: false,
      },
      true,
    );

    expect(next.items.map((item) => item.id)).toEqual(["b"]);
    expect(next.total).toBe(1);
    expect(next.facets.favoriteCount).toBe(1);
  });
});

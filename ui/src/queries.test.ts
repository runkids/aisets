import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  addProject: vi.fn(),
  applyPreview: vi.fn(),
  batchApply: vi.fn(),
  batchCopy: vi.fn(),
  batchDelete: vi.fn(),
  batchMergePreview: vi.fn(),
  batchMovePreview: vi.fn(),
  batchRenamePreview: vi.fn(),
  checkLLMHealth: vi.fn(),
  clearAITagCache: vi.fn(),
  clearEmbeddings: vi.fn(),
  clearOCRCache: vi.fn(),
  clearScanHistory: vi.fn(),
  createPromptPreset: vi.fn(),
  deletePromptPreset: vi.fn(),
  deleteUnusedPreview: vi.fn(),
  detectAgentCLIs: vi.fn(),
  fetchLLMModels: vi.fn(),
  fetchScanStatus: vi.fn(),
  getCatalog: vi.fn(),
  getCatalogDuplicates: vi.fn(),
  getCatalogFolders: vi.fn(),
  getCatalogItemDetail: vi.fn(),
  getCatalogItems: vi.fn(),
  getCatalogLint: vi.fn(),
  getScanDiff: vi.fn(),
  getScans: vi.fn(),
  getSettings: vi.fn(),
  getVersionCheck: vi.fn(),
  importSettings: vi.fn(),
  installOCR: vi.fn(),
  listDirectories: vi.fn(),
  listPromptPresets: vi.fn(),
  removeOCR: vi.fn(),
  removeProject: vi.fn(),
  removeWorkspace: vi.fn(),
  renamePreview: vi.fn(),
  renameProject: vi.fn(),
  renameWorkspace: vi.fn(),
  resetDatabase: vi.fn(),
  runAITagging: vi.fn(),
  scanCatalog: vi.fn(),
  runOCR: vi.fn(),
  runVLMOcr: vi.fn(),
  setCatalogItemFavorite: vi.fn(),
  setCatalogItemsFavorite: vi.fn(),
  setPromptPresetDefault: vi.fn(),
  switchWorkspace: vi.fn(),
  updateSettings: vi.fn(),
  updateApp: vi.fn(),
  updatePromptPreset: vi.fn(),
  addWorkspace: vi.fn(),
}));

import type { AssetItem, CatalogItemsPage } from "./types";
import {
  applyFavoriteUpdateToCatalogItemsPage,
  catalogKeys,
  directoryListingQueryOptions,
  scanKeys,
} from "./queries";

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

function makeItem(input: Partial<AssetItem>): AssetItem {
  return {
    id: input.id ?? "asset-1",
    projectId: input.projectId ?? "project-1",
    projectName: input.projectName ?? "Project",
    repoPath: input.repoPath ?? "icons/example.png",
    localPath: input.localPath ?? "/repo/icons/example.png",
    ext: input.ext ?? ".png",
    bytes: input.bytes ?? 100,
    modifiedUnix: input.modifiedUnix ?? 0,
    contentHash: input.contentHash ?? "hash",
    hashAlgorithm: input.hashAlgorithm ?? "sha1",
    image: input.image ?? {
      format: "PNG",
      width: 10,
      height: 10,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: input.url ?? "/api/catalog/assets/asset-1",
    thumbnailUrl: input.thumbnailUrl ?? "/api/catalog/assets/asset-1/thumb",
    usedBy: input.usedBy ?? [],
    references: input.references ?? [],
    duplicateGroupId: input.duplicateGroupId ?? null,
    duplicates: input.duplicates ?? [],
    similar: input.similar ?? [],
    preferredDuplicatePath: input.preferredDuplicatePath ?? null,
    optimizationRecommendations: input.optimizationRecommendations ?? [],
    favorite: input.favorite,
  };
}

function makePage(items: AssetItem[]): CatalogItemsPage {
  return {
    items,
    total: items.length,
    facets: {
      projects: [],
      projectTotal: 0,
      extensions: [],
      extensionTotal: 0,
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
      favoriteCount: items.filter((item) => item.favorite).length,
    },
  };
}

describe("applyFavoriteUpdateToCatalogItemsPage", () => {
  it("updates loaded item favorite state and favorite facets immediately", () => {
    const page = makePage([
      makeItem({ id: "regular", favorite: false }),
      makeItem({ id: "saved", favorite: true }),
    ]);

    const next = applyFavoriteUpdateToCatalogItemsPage(page, {
      assetIds: new Set(["regular"]),
      favorite: true,
    });

    expect(next.items.find((item) => item.id === "regular")?.favorite).toBe(
      true,
    );
    expect(next.facets.favoriteCount).toBe(2);
    expect(next.total).toBe(2);
  });

  it("removes unfavorited items from favorite-filtered pages", () => {
    const page = makePage([
      makeItem({ id: "saved", favorite: true }),
      makeItem({ id: "also-saved", favorite: true }),
    ]);

    const next = applyFavoriteUpdateToCatalogItemsPage(
      page,
      {
        assetIds: new Set(["saved"]),
        favorite: false,
      },
      true,
    );

    expect(next.items.map((item) => item.id)).toEqual(["also-saved"]);
    expect(next.facets.favoriteCount).toBe(1);
    expect(next.total).toBe(1);
  });
});

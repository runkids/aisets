import { describe, expect, it } from "vitest";
import { customFilterOptions } from "../customAssetFilters";
import type { AssetItem, CustomAssetFilter } from "../types";
import {
  applyBrowseFilters,
  normalizeBrowseStoredState,
  resetBrowseFiltersForStatusChange,
} from "./BrowseView";

function makeItem(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "asset",
    projectId: "app",
    projectName: "App",
    repoPath: "src/assets/icon.png",
    localPath: "/workspace/src/assets/icon.png",
    ext: ".png",
    bytes: 100,
    modifiedUnix: 0,
    contentHash: "hash",
    hashAlgorithm: "sha1",
    image: {
      format: "png",
      width: 1,
      height: 1,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: "/assets/icon.png",
    thumbnailUrl: "/assets/icon.png",
    usedBy: [],
    references: [],
    duplicateGroupId: null,
    duplicates: [],
    similar: [],
    preferredDuplicatePath: null,
    optimizationRecommendations: [],
    ...overrides,
  };
}

function customFilter(id: string, value: string): CustomAssetFilter {
  return {
    id,
    name: id,
    enabled: true,
    groups: [
      {
        clauses: [{ field: "path", operator: "contains", value }],
      },
    ],
  };
}

const defaultBrowseState = {
  filters: { project: "", ext: "", customFilter: "" },
  view: "grid" as const,
  gridSize: "m" as const,
  searchQuery: "",
  statusFilter: "" as const,
  sortMode: "name" as const,
};

describe("normalizeBrowseStoredState", () => {
  it("restores valid stored Browse toolbar and filter values", () => {
    const result = normalizeBrowseStoredState(
      {
        filters: { project: "workspace", ext: ".png", customFilter: "icons" },
        view: "list",
        gridSize: "l",
        searchQuery: "logo",
        statusFilter: "duplicate",
        sortMode: "size",
      },
      defaultBrowseState,
    );

    expect(result).toEqual({
      filters: { project: "workspace", ext: ".png", customFilter: "icons" },
      view: "list",
      gridSize: "l",
      searchQuery: "logo",
      statusFilter: "duplicate",
      sortMode: "size",
    });
  });

  it("accepts not-applicable usage status from stored toolbar state", () => {
    const result = normalizeBrowseStoredState(
      {
        statusFilter: "notApplicable",
      },
      defaultBrowseState,
    );

    expect(result.statusFilter).toBe("notApplicable");
  });

  it("falls back for invalid values and keeps pinned route filters", () => {
    const result = normalizeBrowseStoredState(
      {
        filters: { project: "stored", ext: 10, customFilter: "stored-filter" },
        view: "table",
        gridSize: "xl",
        searchQuery: 20,
        statusFilter: "missing",
        sortMode: "random",
      },
      defaultBrowseState,
      { project: "Current project", customFilter: "palette-filter" },
    );

    expect(result).toEqual({
      ...defaultBrowseState,
      filters: {
        project: "Current project",
        ext: "",
        customFilter: "palette-filter",
      },
    });
  });
});

describe("resetBrowseFiltersForStatusChange", () => {
  it("resets left rail filters to all when the status filter changes", () => {
    expect(resetBrowseFiltersForStatusChange()).toEqual({
      project: "",
      ext: "",
      customFilter: "",
    });
  });

  it("keeps a locked project scope while clearing the other rail filters", () => {
    expect(resetBrowseFiltersForStatusChange("workspace")).toEqual({
      project: "workspace",
      ext: "",
      customFilter: "",
    });
  });
});

describe("applyBrowseFilters", () => {
  it("applies selected custom filters after project, extension, status, and search filters", () => {
    const items = [
      makeItem({
        id: "target",
        projectName: "App",
        repoPath: "src/assets/icons/home.png",
        ext: ".png",
        usedBy: ["src/App.tsx"],
      }),
      makeItem({
        id: "wrong-project",
        projectName: "Docs",
        repoPath: "src/assets/icons/home.png",
        ext: ".png",
        usedBy: ["src/App.tsx"],
      }),
      makeItem({
        id: "wrong-ext",
        projectName: "App",
        repoPath: "src/assets/icons/home.svg",
        ext: ".svg",
        usedBy: ["src/App.tsx"],
      }),
      makeItem({
        id: "unused",
        projectName: "App",
        repoPath: "src/assets/icons/home.png",
        ext: ".png",
      }),
      makeItem({
        id: "wrong-custom",
        projectName: "App",
        repoPath: "src/assets/photos/home.png",
        ext: ".png",
        usedBy: ["src/App.tsx"],
      }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "App", ext: ".png", customFilter: "icons" },
      searchQuery: "home",
      statusFilter: "referenced",
      customFilters: [customFilter("icons", "/icons/")],
    });

    expect(result.filtered.map((item) => item.id)).toEqual(["target"]);
  });

  it("keeps custom filter counts based on the composed Browse result before the active custom filter", () => {
    const items = [
      makeItem({ id: "icon", repoPath: "src/assets/icons/home.png" }),
      makeItem({ id: "photo", repoPath: "src/assets/photos/home.png" }),
      makeItem({
        id: "svg",
        repoPath: "src/assets/icons/home.svg",
        ext: ".svg",
      }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "App", ext: ".png", customFilter: "icons" },
      searchQuery: "",
      statusFilter: "",
      customFilters: [
        customFilter("icons", "/icons/"),
        customFilter("photos", "/photos/"),
      ],
    });

    expect(
      customFilterOptions(
        [customFilter("icons", "/icons/"), customFilter("photos", "/photos/")],
        result.filteredWithoutCustom,
      ),
    ).toEqual([
      { id: "icons", label: "icons", count: 1, usesOCR: false },
      { id: "photos", label: "photos", count: 1, usesOCR: false },
    ]);
    expect(result.filtered.map((item) => item.id)).toEqual(["icon"]);
  });

  it("matches ready OCR text in Browse search", () => {
    const items = [
      makeItem({
        id: "ocr-match",
        repoPath: "src/assets/banner.png",
        ocr: {
          status: "ready",
          text: "Summer SALE",
          normalizedText: "summer sale",
        },
      }),
      makeItem({ id: "path-only", repoPath: "src/assets/sale-icon.png" }),
      makeItem({
        id: "pending",
        repoPath: "src/assets/pending.png",
        ocr: {
          status: "pending",
          text: "sale",
        },
      }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "", ext: "", customFilter: "" },
      searchQuery: "sale",
      statusFilter: "",
      customFilters: [],
    });

    expect(result.filtered.map((item) => item.id)).toEqual([
      "ocr-match",
      "path-only",
    ]);
  });

  it("filters not-applicable usage with backend policy fields", () => {
    const items = [
      makeItem({ id: "asset-pack", usageClassification: "notApplicable" }),
      makeItem({ id: "safe-unused", usageClassification: "unused" }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "", ext: "", customFilter: "" },
      searchQuery: "",
      statusFilter: "notApplicable",
      customFilters: [],
    });

    expect(result.filtered.map((item) => item.id)).toEqual(["asset-pack"]);
  });

  it("keeps DB-backed duplicate rows when the list item only has a duplicate group id", () => {
    const items = [
      makeItem({ id: "duplicate", duplicateGroupId: "group-1" }),
      makeItem({ id: "regular" }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "", ext: "", customFilter: "" },
      searchQuery: "",
      statusFilter: "duplicate",
      customFilters: [],
    });

    expect(result.filtered.map((item) => item.id)).toEqual(["duplicate"]);
  });

  it("does not use cached OCR text when OCR is disabled", () => {
    const items = [
      makeItem({
        id: "ocr-match",
        repoPath: "src/assets/banner.png",
        ocr: {
          status: "ready",
          text: "Summer SALE",
          normalizedText: "summer sale",
        },
      }),
      makeItem({ id: "path-only", repoPath: "src/assets/sale-icon.png" }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "", ext: "", customFilter: "" },
      searchQuery: "sale",
      statusFilter: "",
      customFilters: [],
      ocrEnabled: false,
    });

    expect(result.filtered.map((item) => item.id)).toEqual(["path-only"]);
  });

  it("does not match empty OCR text but reports empty OCR text candidates", () => {
    const items = [
      makeItem({
        id: "empty-ocr",
        repoPath: "src/assets/banner.png",
        ocr: {
          status: "ready",
          textStatus: "empty",
          emptyText: true,
        },
      }),
      makeItem({
        id: "ocr-match",
        repoPath: "src/assets/card.png",
        ocr: {
          status: "ready",
          text: "FOREST PART",
          normalizedText: "forest part",
          textStatus: "available",
        },
      }),
    ];

    const result = applyBrowseFilters({
      items,
      filters: { project: "", ext: "", customFilter: "" },
      searchQuery: "party",
      statusFilter: "",
      customFilters: [],
    });

    expect(result.filtered.map((item) => item.id)).toEqual(["ocr-match"]);
    expect(result.emptyOCRTextCount).toBe(1);

    expect(
      applyBrowseFilters({
        items,
        filters: { project: "", ext: "", customFilter: "" },
        searchQuery: "party",
        statusFilter: "",
        customFilters: [],
        ocrEnabled: false,
      }).emptyOCRTextCount,
    ).toBe(0);
  });
});

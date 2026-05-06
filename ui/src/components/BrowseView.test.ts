import { describe, expect, it } from "vitest";
import { customFilterOptions } from "../customAssetFilters";
import type { AssetItem, CustomAssetFilter } from "../types";
import { applyBrowseFilters } from "./BrowseView";

function makeItem(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "asset",
    projectId: "app",
    projectName: "App",
    repoPath: "src/assets/icon.png",
    localPath: "/workspace/src/assets/icon.png",
    ext: ".png",
    bytes: 100,
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
      { id: "icons", label: "icons", count: 1 },
      { id: "photos", label: "photos", count: 1 },
    ]);
    expect(result.filtered.map((item) => item.id)).toEqual(["icon"]);
  });
});

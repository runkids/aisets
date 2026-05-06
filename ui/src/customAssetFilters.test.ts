import { describe, expect, it } from "vitest";
import {
  customFilterOptions,
  matchesCustomAssetFilter,
} from "./customAssetFilters";
import type { AssetItem, CustomAssetFilter } from "./types";

function makeItem(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "asset",
    projectId: "project",
    projectName: "Marketing",
    repoPath: "src/assets/hero-中文.png",
    localPath: "/repo/src/assets/hero-中文.png",
    ext: ".png",
    bytes: 2048,
    contentHash: "hash",
    hashAlgorithm: "blake3",
    image: {
      format: "png",
      width: 1,
      height: 1,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: "/api/assets/asset",
    thumbnailUrl: "/api/thumbs/asset",
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

function filter(groups: CustomAssetFilter["groups"]): CustomAssetFilter {
  return { id: "custom", name: "Custom", enabled: true, groups };
}

describe("matchesCustomAssetFilter", () => {
  it("supports AND clauses inside OR groups", () => {
    const item = makeItem();
    expect(
      matchesCustomAssetFilter(
        item,
        filter([
          {
            clauses: [
              { field: "path", operator: "regex", value: "\\p{Han}" },
              { field: "bytes", operator: "gte", value: "1024" },
            ],
          },
          {
            clauses: [
              { field: "extension", operator: "equals", value: ".svg" },
            ],
          },
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCustomAssetFilter(
        makeItem({ repoPath: "src/assets/hero.png", bytes: 512 }),
        filter([
          {
            clauses: [
              { field: "path", operator: "regex", value: "\\p{Han}" },
              { field: "bytes", operator: "gte", value: "1024" },
            ],
          },
          {
            clauses: [
              { field: "extension", operator: "equals", value: ".svg" },
            ],
          },
        ]),
      ),
    ).toBe(false);
  });

  it("matches deterministic metadata clauses", () => {
    const item = makeItem({
      projectName: "Icons",
      repoPath: "src/icons/legacy/home.svg",
      ext: ".svg",
      bytes: 512,
      usedBy: ["src/App.tsx"],
      duplicates: ["other"],
      similar: ["near"],
      optimizationRecommendations: [
        {
          category: "size",
          reasonCode: "large",
          reason: "Large",
          severity: "warning",
          suggestionCode: "compress",
          suggestion: "Compress",
        },
      ],
    });

    for (const clause of [
      { field: "path", operator: "contains", value: "legacy" },
      { field: "path", operator: "suffix", value: "home.svg" },
      { field: "folder", operator: "prefix", value: "src/icons" },
      { field: "folder", operator: "suffix", value: "legacy" },
      { field: "folder", operator: "regex", value: "icons/.+" },
      { field: "extension", operator: "equals", value: "svg" },
      { field: "extension", operator: "oneOf", value: ".png,svg,.webp" },
      { field: "project", operator: "contains", value: "con" },
      { field: "project", operator: "oneOf", value: "Marketing,Icons" },
      { field: "bytes", operator: "lte", value: "1024" },
      { field: "status", operator: "is", value: "referenced" },
      { field: "duplicate", operator: "is", value: "true" },
      { field: "nearDuplicate", operator: "is", value: "true" },
      { field: "optimizable", operator: "is", value: "true" },
    ] as const) {
      expect(
        matchesCustomAssetFilter(item, filter([{ clauses: [clause] }])),
      ).toBe(true);
    }
  });

  it("ignores disabled filters and returns zero-count options", () => {
    const filters: CustomAssetFilter[] = [
      {
        id: "disabled",
        name: "Disabled",
        enabled: false,
        groups: [
          {
            clauses: [{ field: "path", operator: "contains", value: "hero" }],
          },
        ],
      },
      {
        id: "missing",
        name: "Missing",
        enabled: true,
        groups: [
          {
            clauses: [
              { field: "path", operator: "contains", value: "missing" },
            ],
          },
        ],
      },
    ];

    expect(matchesCustomAssetFilter(makeItem(), filters[0])).toBe(false);
    expect(customFilterOptions(filters, [makeItem()])).toEqual([
      { id: "missing", label: "Missing", count: 0 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { applyDeleteUpdateToCatalogItemsPage } from "./actionQueries";
import type { CatalogItemsPage } from "@/types";

function makeItem(id: string) {
  return { id } as CatalogItemsPage["items"][number];
}

function makePage(ids: string[], total: number): CatalogItemsPage {
  return {
    items: ids.map(makeItem),
    total,
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
      favoriteCount: 0,
    },
  };
}

describe("applyDeleteUpdateToCatalogItemsPage", () => {
  it("removes matching items and decrements total", () => {
    const page = makePage(["a", "b", "c"], 10);
    const result = applyDeleteUpdateToCatalogItemsPage(page, new Set(["b"]));
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(result.total).toBe(9);
  });

  it("removes multiple items", () => {
    const page = makePage(["a", "b", "c", "d"], 20);
    const result = applyDeleteUpdateToCatalogItemsPage(
      page,
      new Set(["a", "c", "d"]),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("b");
    expect(result.total).toBe(17);
  });

  it("returns same reference when no items match", () => {
    const page = makePage(["a", "b"], 5);
    const result = applyDeleteUpdateToCatalogItemsPage(
      page,
      new Set(["x", "y"]),
    );
    expect(result).toBe(page);
  });

  it("returns same reference for empty deletedIds", () => {
    const page = makePage(["a", "b"], 5);
    const result = applyDeleteUpdateToCatalogItemsPage(page, new Set());
    expect(result).toBe(page);
  });

  it("clamps total to zero", () => {
    const page = makePage(["a"], 0);
    const result = applyDeleteUpdateToCatalogItemsPage(page, new Set(["a"]));
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("preserves facets unchanged", () => {
    const page = makePage(["a", "b"], 5);
    page.facets.favoriteCount = 3;
    const result = applyDeleteUpdateToCatalogItemsPage(page, new Set(["a"]));
    expect(result.facets.favoriteCount).toBe(3);
  });
});

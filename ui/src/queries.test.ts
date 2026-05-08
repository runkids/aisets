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

import { catalogKeys, directoryListingQueryOptions, scanKeys } from "./queries";

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

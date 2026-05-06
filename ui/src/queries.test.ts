import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  addProject: vi.fn(),
  applyPreview: vi.fn(),
  deleteUnusedPreview: vi.fn(),
  getCatalog: vi.fn(),
  getSettings: vi.fn(),
  importSettings: vi.fn(),
  listDirectories: vi.fn(),
  renamePreview: vi.fn(),
  resetDatabase: vi.fn(),
  scanCatalog: vi.fn(),
  updateSettings: vi.fn(),
}));

import { directoryListingQueryOptions } from "./queries";

describe("directoryListingQueryOptions", () => {
  it("does not retry missing or invalid directory requests", () => {
    const options = directoryListingQueryOptions("/workspace/missing", true);

    expect(options.queryKey).toEqual(["directories", "/workspace/missing"]);
    expect(options.enabled).toBe(true);
    expect(options.retry).toBe(false);
  });
});

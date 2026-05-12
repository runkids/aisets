import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDatabaseResetBrowserCache } from "./resetBrowserCache";

function storageMock(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
    clear: vi.fn(() => data.clear()),
    key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
    get length() {
      return data.size;
    },
  } as unknown as Storage;
}

describe("clearDatabaseResetBrowserCache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes DB-derived local, session, and CacheStorage entries", async () => {
    const localStorage = storageMock({
      "aisets-browse-state": "{}",
      "aisets-cmd-history": "[]",
      "aisets:ai-tag:last-run": "{}",
      "aisets:vlm-ocr:last-run": "{}",
      "aisets:embed:last-run": "{}",
      "aisets-theme": "dark",
    });
    const sessionStorage = storageMock({
      "aisets.optimize.estimates.v2": "[]",
      "aisets.imageTools.assetIds": "[]",
    });
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage,
      caches: {
        keys: vi.fn(async () => ["aisets-shell-v3", "other-app"]),
        delete: deleteCache,
      },
    });

    await clearDatabaseResetBrowserCache();

    expect(localStorage.removeItem).toHaveBeenCalledWith("aisets-browse-state");
    expect(localStorage.removeItem).toHaveBeenCalledWith("aisets-cmd-history");
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "aisets:ai-tag:last-run",
    );
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      "aisets.optimize.estimates.v2",
    );
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      "aisets.imageTools.assetIds",
    );
    expect(deleteCache).toHaveBeenCalledWith("aisets-shell-v3");
    expect(deleteCache).not.toHaveBeenCalledWith("other-app");
  });
});

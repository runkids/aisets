import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSettings } from "./api";

describe("updateSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a PATCH request with the backend settings shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: {
          workspaceName: "Team",
          defaultProjectRoot: "",
          autoScanOnOpen: false,
          scanOnOpen: true,
          excludePatterns: ["dist"],
          optimizationDefaultQuality: 72,
          optimizationAutoApply: false,
          databasePath: "/tmp/asset-studio.db",
          dataDir: "/tmp/data",
          cacheDir: "/tmp/cache",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({
      workspaceName: "Team",
      scanOnOpen: true,
      excludePatterns: ["dist"],
      optimizationDefaultQuality: 72,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        workspaceName: "Team",
        scanOnOpen: true,
        excludePatterns: ["dist"],
        optimizationDefaultQuality: 72,
      }),
      headers: {
        "content-type": "application/json",
      },
    });
  });
});

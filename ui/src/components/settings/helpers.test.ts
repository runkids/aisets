import { describe, expect, it } from "vitest";
import { draftFromSettings, updateFromDraft } from "./helpers";

describe("settings draft helpers", () => {
  it("round-trips global and project-type exclude patterns", () => {
    const draft = draftFromSettings({
      workspaceName: "Asset Studio",
      activeWorkspaceId: "default",
      defaultProjectRoot: "",
      autoScanOnOpen: false,
      scanOnOpen: false,
      scanProfile: "full",
      scanAnalyses: {
        references: true,
        nearDuplicates: true,
        optimization: true,
      },
      ocrEnabled: false,
      ocrLanguages: ["eng"],
      ocrMaxPixels: 2_000_000,
      ocrBatchSize: 25,
      ocrConcurrency: 1,
      ocrFuzzySearch: true,
      excludePatterns: ["dist/**"],
      excludePatternsByIntent: {
        code: ["**/*.test.*"],
        assetPack: [],
        library: ["fixtures/**"],
        mixed: ["tmp/**"],
      },
      optimizationDefaultQuality: 80,
      optimizationAutoApply: false,
      optimizationThresholds: {
        svgMinSavingsPercent: 10,
        maxDimensionPx: 2560,
        fileSizeWarningKB: 200,
        fileSizeCriticalKB: 500,
        pngAlphaCheckEnabled: true,
      },
      customAssetFilters: [],
      preferredEditor: "vscode",
      workspaces: [],
      projects: [],
      databasePath: "/tmp/asset-studio.db",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
      ocrRuntime: {
        availableLanguages: [],
        installed: false,
        dataDir: "/tmp/ocr",
        engineName: "",
        engineVersion: "",
        engineAvailable: false,
      },
    });

    draft.excludePatternsByIntentText.code = "**/*.test.*\n**/*.spec.*";
    const update = updateFromDraft(draft);

    expect(update.excludePatterns).toEqual(["dist/**"]);
    expect(update.excludePatternsByIntent).toEqual({
      code: ["**/*.test.*", "**/*.spec.*"],
      assetPack: [],
      library: ["fixtures/**"],
      mixed: ["tmp/**"],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  draftFromSettings,
  resetSectionDraft,
  updateFromDraft,
} from "./helpers";

describe("settings draft helpers", () => {
  it("round-trips global and project-type exclude patterns", () => {
    const draft = draftFromSettings({
      workspaceName: "Aisets",
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
      optimizationWorkers: 1,
      optimizationAvifSpeed: 6,
      optimizationAutoApply: false,
      optimizationThresholds: {
        svgMinSavingsPercent: 10,
        maxDimensionPx: 2560,
        fileSizeWarningKB: 200,
        fileSizeCriticalKB: 500,
        pngAlphaCheckEnabled: true,
      },
      optimizationExternalTools: [],
      optimizationStrategies: [],
      customAssetFilters: [],
      preferredEditor: "vscode",
      workspaces: [],
      projects: [],
      databasePath: "/tmp/aisets.db",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
      ocrRuntime: {
        availableLanguages: [],
        installed: false,
        dataDir: "/tmp/ocr",
        platform: "linux",
        engineName: "",
        engineVersion: "",
        engineAvailable: false,
      },
      optimizationToolRuntime: [],
      optimizationStrategyHash: "test",
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

  it("resets section drafts to product defaults instead of saved values", () => {
    const draft = draftFromSettings({
      workspaceName: "Custom Workspace",
      activeWorkspaceId: "default",
      defaultProjectRoot: "/tmp/assets",
      autoScanOnOpen: true,
      scanOnOpen: true,
      scanProfile: "fast",
      scanAnalyses: {
        references: false,
        nearDuplicates: false,
        optimization: false,
      },
      ocrEnabled: true,
      ocrLanguages: ["eng", "chi_tra"],
      ocrMaxPixels: 999,
      ocrBatchSize: 9,
      ocrConcurrency: 2,
      ocrFuzzySearch: false,
      excludePatterns: ["aisets-logo.png"],
      excludePatternsByIntent: {
        code: ["custom-code/**"],
        assetPack: ["custom-assets/**"],
        library: ["custom-library/**"],
        mixed: ["custom-mixed/**"],
      },
      optimizationDefaultQuality: 42,
      optimizationWorkers: 2,
      optimizationAvifSpeed: 8,
      optimizationAutoApply: true,
      optimizationThresholds: {
        svgMinSavingsPercent: 25,
        maxDimensionPx: 1024,
        fileSizeWarningKB: 10,
        fileSizeCriticalKB: 20,
        pngAlphaCheckEnabled: false,
      },
      optimizationExternalTools: [{ id: "svgo", enabled: true }],
      optimizationStrategies: [
        {
          id: "custom",
          name: "Custom",
          enabled: true,
          priority: 1,
          match: { formats: ["png"], alpha: "any", animated: "any" },
          action: { operation: "convert", outputFormat: "webp" },
        },
      ],
      customAssetFilters: [
        {
          id: "custom",
          name: "Custom",
          enabled: true,
          groups: [
            {
              clauses: [{ field: "path", operator: "contains", value: "logo" }],
            },
          ],
        },
      ],
      preferredEditor: "vscode",
      workspaces: [],
      projects: [],
      databasePath: "/tmp/aisets.db",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
      ocrRuntime: {
        availableLanguages: [],
        installed: false,
        dataDir: "/tmp/ocr",
        platform: "linux",
        engineName: "",
        engineVersion: "",
        engineAvailable: false,
      },
      optimizationToolRuntime: [],
      optimizationStrategyHash: "custom",
    });

    const workspace = resetSectionDraft(draft, "workspace");
    expect(workspace.workspaceName).toBe("Aisets");
    expect(workspace.defaultProjectRoot).toBe("");

    const scanning = resetSectionDraft(draft, "scanning");
    expect(scanning.scanProfile).toBe("full");
    expect(scanning.excludePatternsText).toBe("");
    expect(scanning.excludePatternsByIntentText.code).toContain("**/*.test.*");
    expect(scanning.excludePatternsByIntentText.assetPack).toBe("");
    expect(scanning.ocrEnabled).toBe(true);
    expect(scanning.ocrLanguages).toEqual(["eng", "chi_tra"]);

    const ocr = resetSectionDraft(draft, "ocr");
    expect(ocr.ocrEnabled).toBe(false);
    expect(ocr.ocrLanguages).toEqual(["eng"]);
    expect(ocr.ocrMaxPixels).toBe(2_000_000);
    expect(ocr.scanProfile).toBe("fast");
    expect(ocr.excludePatternsText).toBe("aisets-logo.png");

    const customFilters = resetSectionDraft(draft, "customFilters");
    expect(customFilters.customAssetFilters).toEqual([]);

    const optimization = resetSectionDraft(draft, "optimization");
    expect(optimization.optimizationDefaultQuality).toBe(80);
    expect(optimization.optimizationAutoApply).toBe(false);
    expect(optimization.optimizationThresholds.maxDimensionPx).toBe(2560);
    expect(
      optimization.optimizationExternalTools.every((tool) => !tool.enabled),
    ).toBe(true);
    expect(optimization.optimizationStrategies.length).toBeGreaterThan(0);
  });
});

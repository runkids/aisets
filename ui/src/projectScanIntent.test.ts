import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { AssetItem } from "./types";
import {
  canDeleteUnused,
  notApplicableUsageLabel,
  usageClassification,
} from "./projectScanIntent";

function makeItem(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "asset",
    projectId: "project",
    projectName: "Project",
    repoPath: "src/icon.png",
    localPath: "/workspace/src/icon.png",
    ext: ".png",
    bytes: 100,
    modifiedUnix: 0,
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

describe("usageClassification", () => {
  it("uses backend usage policy when present", () => {
    expect(
      usageClassification(
        makeItem({ usageClassification: "possiblyUnused", usedBy: [] }),
      ),
    ).toBe("possiblyUnused");
  });

  it("does not infer safe unused from legacy zero-reference items", () => {
    expect(usageClassification(makeItem({ usedBy: [] }))).toBe("notApplicable");
  });
});

describe("canDeleteUnused", () => {
  it("requires explicit backend delete-unused permission and unused classification", () => {
    expect(
      canDeleteUnused(
        makeItem({
          usageClassification: "unused",
          deleteUnusedAllowed: true,
        }),
      ),
    ).toBe(true);
    expect(
      canDeleteUnused(
        makeItem({
          usageClassification: "possiblyUnused",
          deleteUnusedAllowed: true,
        }),
      ),
    ).toBe(false);
    expect(canDeleteUnused(makeItem({ usageClassification: "unused" }))).toBe(
      false,
    );
  });
});

describe("notApplicableUsageLabel", () => {
  const t = ((key: string) =>
    ({
      "projectIntent.assetPack.label": "Asset Pack",
      "browse.flagUsageNotChecked": "Reference analysis not run",
      "browse.flagUsageNotCheckedShort": "Not checked",
    })[key] ?? key) as TFunction;

  it("shows asset-pack cause when policy came from the project intent", () => {
    expect(
      notApplicableUsageLabel(t, makeItem({ scanIntent: "assetPack" })),
    ).toBe("Asset Pack");
  });

  it("falls back to not-checked copy for other not-applicable causes", () => {
    expect(notApplicableUsageLabel(t, makeItem({ scanIntent: "code" }))).toBe(
      "Reference analysis not run",
    );
    expect(
      notApplicableUsageLabel(t, makeItem({ scanIntent: "code" }), {
        short: true,
      }),
    ).toBe("Not checked");
  });
});

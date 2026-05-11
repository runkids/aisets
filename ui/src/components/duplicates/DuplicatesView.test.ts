import { describe, expect, it } from "vitest";
import type { AssetItem, DuplicateGroup } from "../../types";
import { buildDuplicateGroupViews } from "./duplicateGroupViews";

function makeItem(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: "asset",
    projectId: "app",
    projectName: "App",
    repoPath: "src/assets/icon.png",
    localPath: "/workspace/src/assets/icon.png",
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

function makeGroup(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    id: "group-1",
    contentHash: "hash",
    hashAlgorithm: "blake3",
    paths: ["src/assets/icon.png", "src/assets/icon-copy.png"],
    preferredPath: "src/assets/icon.png",
    ...overrides,
  };
}

describe("buildDuplicateGroupViews", () => {
  it("uses members returned with duplicate groups before falling back to paged item results", () => {
    const members = [
      makeItem({
        id: "preferred",
        repoPath: "src/assets/icon.png",
        bytes: 100,
      }),
      makeItem({
        id: "copy",
        repoPath: "src/assets/icon-copy.png",
        bytes: 100,
      }),
    ];

    const views = buildDuplicateGroupViews(
      [makeGroup({ members })],
      [],
      "members",
    );

    expect(views).toHaveLength(1);
    expect(views[0].members.map((member) => member.id)).toEqual([
      "preferred",
      "copy",
    ]);
    expect(views[0].totalBytes).toBe(200);
    expect(views[0].savings).toBe(100);
  });

  it("keeps compatibility with older responses that do not include group members", () => {
    const fallback = makeItem({
      id: "copy",
      repoPath: "src/assets/icon-copy.png",
      duplicateGroupId: "group-1",
      bytes: 100,
    });

    const views = buildDuplicateGroupViews(
      [makeGroup()],
      [fallback],
      "members",
    );

    expect(views[0].members).toEqual([fallback]);
  });

  it("filters hydrated members by search text", () => {
    const views = buildDuplicateGroupViews(
      [
        makeGroup({
          members: [
            makeItem({ id: "icon", repoPath: "src/assets/icon.png" }),
            makeItem({ id: "photo", repoPath: "src/photos/hero.png" }),
          ],
        }),
      ],
      [],
      "members",
      "photos",
    );

    expect(views[0].members.map((member) => member.id)).toEqual(["photo"]);
  });
});

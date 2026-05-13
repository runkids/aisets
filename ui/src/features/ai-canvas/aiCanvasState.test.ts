import { describe, expect, it } from "vitest";
import type { AssetItem } from "@/types";
import {
  buildAssistantBullets,
  commentsForAssets,
  inferPromptIntent,
  normalizeAICanvasSession,
  selectedAssetCards,
  type AssetCanvasCard,
  type CommentCanvasCard,
} from "./aiCanvasState";

function makeAsset(id: string): AssetItem {
  return {
    id,
    projectId: "project",
    projectName: "Project",
    repoPath: `src/assets/${id}.png`,
    localPath: `/tmp/${id}.png`,
    ext: ".png",
    bytes: 2048,
    modifiedUnix: 0,
    contentHash: id,
    hashAlgorithm: "sha1",
    image: {
      format: "png",
      width: 640,
      height: 480,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: `/assets/${id}.png`,
    thumbnailUrl: `/assets/${id}.png`,
    usedBy: ["src/App.tsx"],
    references: [],
    duplicateGroupId: null,
    duplicates: [],
    similar: [],
    preferredDuplicatePath: null,
    optimizationRecommendations: [],
    ocr: {
      status: "ready",
      text: "Sale banner",
    },
    aiTag: {
      status: "ready",
      tags: ["banner", "marketing"],
      description: "A wide product banner",
    },
  };
}

function makeAssetCard(id: string): AssetCanvasCard {
  return {
    id: `card-${id}`,
    kind: "asset",
    x: 10,
    y: 20,
    createdAt: "2026-05-13T00:00:00.000Z",
    asset: makeAsset(id),
  };
}

describe("normalizeAICanvasSession", () => {
  it("keeps valid cards and drops stale selected ids", () => {
    const session = normalizeAICanvasSession({
      cards: [makeAssetCard("hero"), { kind: "asset", id: "" }],
      selectedCardId: "missing",
      viewport: { x: 5, y: 10, scale: 8 },
    });

    expect(session.cards).toHaveLength(1);
    expect(session.selectedCardId).toBeUndefined();
    expect(session.viewport.scale).toBe(1.8);
  });
});

describe("selectedAssetCards", () => {
  it("resolves comment selection back to the anchored asset", () => {
    const asset = makeAssetCard("hero");
    const comment: CommentCanvasCard = {
      id: "comment-1",
      kind: "comment",
      x: 40,
      y: 50,
      createdAt: "2026-05-13T00:00:00.000Z",
      anchorId: asset.id,
      text: "Make this area brighter",
      region: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
    };

    expect(selectedAssetCards([asset, comment], comment.id)).toEqual([asset]);
    expect(commentsForAssets([asset, comment], [asset.id])).toEqual([comment]);
  });
});

describe("inferPromptIntent", () => {
  it("routes common canvas prompts to preview actions", () => {
    expect(inferPromptIntent("標記這個角落太暗")).toBe("comment");
    expect(inferPromptIntent("compress as webp safe variant")).toBe(
      "operationPreview",
    );
    expect(inferPromptIntent("幫我預覽改圖")).toBe("imagePreview");
    expect(inferPromptIntent("describe context")).toBe("describe");
  });
});

describe("buildAssistantBullets", () => {
  it("packs selected asset metadata and comments into AI context", () => {
    const asset = makeAssetCard("hero");
    const comment: CommentCanvasCard = {
      id: "comment-1",
      kind: "comment",
      x: 40,
      y: 50,
      createdAt: "2026-05-13T00:00:00.000Z",
      anchorId: asset.id,
      text: "Make this area brighter",
      region: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
    };

    const bullets = buildAssistantBullets(
      "describe",
      [asset, comment],
      asset.id,
    );

    expect(bullets).toContain("hero.png · 640x480 · 2.0 KB");
    expect(bullets).toContain("AI tags: banner, marketing");
    expect(bullets).toContain("Canvas comments: Make this area brighter");
  });
});

import { describe, expect, it } from "vitest";
import type { AssetCanvasCard, UploadCanvasCard } from "./aiCanvasState";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  adjacentCardPosition,
  compactImageAspectRatio,
} from "./canvasUtils";

function makeUploadCard(width: number, height: number): UploadCanvasCard {
  return {
    id: "upload-1",
    kind: "upload",
    x: 0,
    y: 0,
    createdAt: new Date(0).toISOString(),
    token: "token",
    thumbnailDataUrl: "data:image/png;base64,",
    fileName: "upload.png",
    uploadWidth: width,
    uploadHeight: height,
  };
}

function makeAssetCard(): AssetCanvasCard {
  return {
    id: "asset-1",
    kind: "asset",
    x: 0,
    y: 0,
    createdAt: new Date(0).toISOString(),
    asset: {
      id: "asset-1",
      projectId: "project",
      projectName: "Project",
      repoPath: "src/image.png",
      localPath: "/repo/src/image.png",
      ext: ".png",
      bytes: 123,
      modifiedUnix: 0,
      contentHash: "hash",
      hashAlgorithm: "sha256",
      image: {
        format: "png",
        width: 320,
        height: 240,
        animated: false,
        alpha: true,
        pages: 1,
      },
      url: "/image.png",
      thumbnailUrl: "/thumb.png",
      usedBy: [],
      references: [],
      duplicateGroupId: null,
      duplicates: [],
      similar: [],
      preferredDuplicatePath: null,
      optimizationRecommendations: [],
    },
  };
}

describe("adjacentCardPosition", () => {
  it("places generated cards next to the anchor using measured width", () => {
    expect(
      adjacentCardPosition(
        { id: "asset-1", x: 120, y: 80 },
        { "asset-1": { width: 360 } },
      ),
    ).toEqual({ x: 504, y: 80 });
  });

  it("keeps stacked generated cards close to the anchor", () => {
    expect(
      adjacentCardPosition(
        { id: "asset-1", x: 120, y: 80 },
        { "asset-1": { width: 360 } },
        { index: 2, verticalStep: 88 },
      ),
    ).toEqual({ x: 504, y: 256 });
  });
});

describe("compactImageAspectRatio", () => {
  it("uses the uploaded image dimensions for compact upload cards", () => {
    expect(compactImageAspectRatio(makeUploadCard(1600, 900))).toBeCloseTo(
      16 / 9,
    );
  });

  it("falls back to the card aspect ratio when upload dimensions are missing", () => {
    expect(compactImageAspectRatio(makeUploadCard(0, 900))).toBe(
      DEFAULT_IMAGE_ASPECT_RATIO,
    );
  });

  it("keeps catalog asset cards on the existing card aspect ratio", () => {
    expect(compactImageAspectRatio(makeAssetCard())).toBe(
      DEFAULT_IMAGE_ASPECT_RATIO,
    );
  });
});

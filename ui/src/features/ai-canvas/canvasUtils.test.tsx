import { describe, expect, it } from "vitest";
import type { AssetCanvasCard, UploadCanvasCard } from "./aiCanvasState";
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
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

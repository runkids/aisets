import { describe, expect, it } from "vitest";
import type { CanvasCard } from "./aiCanvasState";
import {
  buildCaptureRequestFromFrames,
  captureImageCards,
  capturePreviewSignature,
  sessionThumbnailOutputScale,
  shouldSkipDuplicatePreview,
  type CaptureFrame,
} from "./useCanvasCapture";

function frame(
  assetId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): CaptureFrame {
  return {
    assetId,
    x,
    y,
    width,
    height,
    bounds: { x, y, width, height },
  };
}

describe("buildCaptureRequestFromFrames", () => {
  it("keeps viewport captures in screen-space positions", () => {
    const request = buildCaptureRequestFromFrames(
      7,
      [frame("a", 100, 50, 200, 150), frame("b", 800, 50, 100, 100)],
      { x: 50, y: 20, width: 500, height: 300 },
      2,
    );

    expect(request).toMatchObject({
      scanId: 7,
      outputWidth: 1000,
      outputHeight: 600,
      cards: [{ assetId: "a", x: 100, y: 60, width: 400, height: 300 }],
    });
  });

  it("crops canvas captures around the actual rendered image frames", () => {
    const request = buildCaptureRequestFromFrames(7, [
      frame("a", 10, 20, 200, 150),
      frame("b", 260, 80, 100, 90),
    ]);

    expect(request).toMatchObject({
      outputWidth: 398,
      outputHeight: 198,
      cards: [
        { assetId: "a", x: 24, y: 24, width: 200, height: 150 },
        { assetId: "b", x: 274, y: 84, width: 100, height: 90 },
      ],
    });
  });
});

describe("captureImageCards", () => {
  it("includes generated variant image cards in capture targets", () => {
    const cards: CanvasCard[] = [
      {
        id: "variant-1",
        kind: "variant",
        x: 0,
        y: 0,
        createdAt: new Date(0).toISOString(),
        sourceAssetId: "asset-1",
        sourceName: "rotated.png",
        previewUrl: "/variant.png",
        token: "variant-token",
        inputBytes: 100,
        outputBytes: 90,
        inputFormat: "png",
        outputFormat: "png",
        width: 240,
        height: 320,
        alpha: true,
      },
      {
        id: "comment-1",
        kind: "comment",
        x: 0,
        y: 0,
        createdAt: new Date(0).toISOString(),
        anchorId: "variant-1",
        text: "note",
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];

    expect(
      captureImageCards(cards, new Set(["variant-1", "comment-1"])),
    ).toEqual([cards[0]]);
  });
});

describe("sessionThumbnailOutputScale", () => {
  it("keeps session thumbnail encoding bounded for spread-out canvases", () => {
    const scale = sessionThumbnailOutputScale({
      x: 0,
      y: 0,
      width: 12000,
      height: 8000,
    });

    expect(Math.ceil(12000 * scale)).toBeLessThanOrEqual(640);
    expect(Math.ceil(8000 * scale)).toBeLessThanOrEqual(640);
  });

  it("does not upscale small session thumbnails beyond the default half scale", () => {
    expect(
      sessionThumbnailOutputScale({ x: 0, y: 0, width: 400, height: 320 }),
    ).toBe(0.5);
  });
});

describe("capturePreviewSignature", () => {
  it("matches identical blobs and separates different image bytes", async () => {
    const first = new Blob(["same-image"], { type: "image/png" });
    const duplicate = new Blob(["same-image"], { type: "image/png" });
    const different = new Blob(["other-image"], { type: "image/png" });

    await expect(capturePreviewSignature(duplicate)).resolves.toBe(
      await capturePreviewSignature(first),
    );
    await expect(capturePreviewSignature(different)).resolves.not.toBe(
      await capturePreviewSignature(first),
    );
  });

  it("only suppresses duplicate previews while a preview URL is active", () => {
    expect(
      shouldSkipDuplicatePreview(
        "image/png:10:abc",
        "blob:active",
        "image/png:10:abc",
      ),
    ).toBe(true);
    expect(
      shouldSkipDuplicatePreview("image/png:10:abc", null, "image/png:10:abc"),
    ).toBe(false);
  });
});

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
  bounds = { x, y, width, height },
): CaptureFrame {
  return {
    assetId,
    x,
    y,
    width,
    height,
    bounds,
  };
}

describe("buildCaptureRequestFromFrames", () => {
  it("keeps viewport captures in screen-space positions", () => {
    const request = buildCaptureRequestFromFrames(
      7,
      [frame("a", 100, 50, 200, 150), frame("b", 800, 50, 100, 100)],
      { x: 50, y: 20, width: 500, height: 300 },
      2,
      false,
      { x: 0, y: 0 },
    );

    expect(request).toMatchObject({
      scanId: 7,
      outputWidth: 1000,
      outputHeight: 600,
      cards: [{ assetId: "a", x: 100, y: 60, width: 400, height: 300 }],
    });
  });

  it("applies padding around viewport captures", () => {
    const request = buildCaptureRequestFromFrames(
      7,
      [frame("a", 100, 50, 200, 150)],
      { x: 50, y: 20, width: 500, height: 300 },
      2,
      false,
      { x: 10, y: 16 },
    );

    expect(request).toMatchObject({
      outputWidth: 1020,
      outputHeight: 632,
      cards: [{ assetId: "a", x: 110, y: 76, width: 400, height: 300 }],
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

  it("crops grouped image captures around the whole group bounds", () => {
    const groupBounds = { x: 100, y: 120, width: 500, height: 360 };
    const request = buildCaptureRequestFromFrames(7, [
      frame("child-a", 150, 170, 80, 60, groupBounds),
      frame("child-b", 420, 330, 90, 70, groupBounds),
    ]);

    expect(request).toMatchObject({
      outputWidth: 548,
      outputHeight: 408,
      cards: [
        { assetId: "child-a", x: 74, y: 74, width: 80, height: 60 },
        { assetId: "child-b", x: 344, y: 234, width: 90, height: 70 },
      ],
    });
  });

  it("supports separate x and y padding for cropped canvas captures", () => {
    const request = buildCaptureRequestFromFrames(
      7,
      [frame("a", 10, 20, 200, 150)],
      undefined,
      1,
      false,
      { x: 12, y: 32 },
    );

    expect(request).toMatchObject({
      outputWidth: 224,
      outputHeight: 214,
      cards: [{ assetId: "a", x: 12, y: 32, width: 200, height: 150 }],
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

import { describe, expect, it } from "vitest";
import type { UploadCanvasCard } from "./aiCanvasState";
import { focusCursorPosition } from "./useCanvasChat";

function makeUploadCard(): UploadCanvasCard {
  return {
    id: "upload-1",
    kind: "upload",
    x: 100,
    y: 200,
    createdAt: "2026-05-14T00:00:00.000Z",
    token: "token",
    thumbnailDataUrl: "data:image/png;base64,",
    fileName: "image.png",
    uploadWidth: 320,
    uploadHeight: 480,
  };
}

describe("focusCursorPosition", () => {
  it("targets the middle of the card instead of the header edge", () => {
    const card = makeUploadCard();

    expect(
      focusCursorPosition(card, { [card.id]: { width: 360, height: 420 } }, 1),
    ).toEqual({ x: 274, y: 402 });
  });
});

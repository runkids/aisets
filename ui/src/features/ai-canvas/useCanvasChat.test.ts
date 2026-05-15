import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { AssetCanvasCard, UploadCanvasCard } from "./aiCanvasState";
import {
  canvasActionResultCreatesAssetCards,
  canvasAnimationSettleDelay,
  canvasCaptureQueueDelay,
  canvasRunUsageFromDone,
  clearCanvasToolStatusCursor,
  duplicateCardPositionsFromActionResult,
  canvasStatusCursorLabel,
  canvasStatusCursorStatus,
  focusCursorPosition,
  formatOCRActionText,
  resolveCanvasActionCardId,
  searchResultCardPosition,
  uploadCardsFromAttachments,
} from "./useCanvasChat";

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

function makeAssetCard(id: string, x: number, y: number): AssetCanvasCard {
  return {
    id,
    kind: "asset",
    x,
    y,
    createdAt: "2026-05-14T00:00:00.000Z",
    asset: {
      id: `${id}-asset`,
      repoPath: `${id}.png`,
      projectId: "project",
      projectName: "Project",
      localPath: `/repo/${id}.png`,
      ext: ".png",
      bytes: 100,
      modifiedUnix: 1_768_176_000,
      contentHash: `${id}-hash`,
      hashAlgorithm: "sha256",
      image: {
        format: "png",
        width: 320,
        height: 240,
        animated: false,
        alpha: true,
        pages: 1,
      },
      url: `/api/assets/${id}`,
      thumbnailUrl: `/api/thumbs/${id}`,
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

describe("focusCursorPosition", () => {
  it("targets the middle of the card instead of the header edge", () => {
    const card = makeUploadCard();

    expect(
      focusCursorPosition(card, { [card.id]: { width: 360, height: 420 } }, 1),
    ).toEqual({ x: 274, y: 402 });
  });
});

describe("searchResultCardPosition", () => {
  it("places added catalog results beside the existing visual cluster", () => {
    const cards = [
      makeAssetCard("left", 100, 240),
      makeAssetCard("wide", 420, 120),
    ];
    const metrics = {
      left: { width: 320, height: 240 },
      wide: { width: 520, height: 260 },
    };

    expect(searchResultCardPosition({ cards, metrics, index: 0 })).toEqual({
      x: 1120,
      y: 120,
    });
    expect(searchResultCardPosition({ cards, metrics, index: 1 })).toEqual({
      x: 1496,
      y: 120,
    });
  });

  it("falls back to viewport-centered placement when the canvas is empty", () => {
    expect(
      searchResultCardPosition({
        cards: [],
        metrics: {},
        index: 0,
        viewport: { x: 0, y: 0, scale: 1 },
        containerSize: { width: 1000, height: 800 },
      }),
    ).toEqual({ x: 340, y: 280 });
  });

  it("ignores off-screen outliers when placing new images beside the visible cluster", () => {
    const cards = [
      makeAssetCard("left", 100, 240),
      makeAssetCard("wide", 420, 120),
      makeAssetCard("outlier", 3000, 120),
    ];

    expect(
      searchResultCardPosition({
        cards,
        metrics: {
          left: { width: 320, height: 240 },
          wide: { width: 520, height: 260 },
          outlier: { width: 320, height: 240 },
        },
        index: 0,
        viewport: { x: 0, y: 0, scale: 1 },
        containerSize: { width: 1200, height: 800 },
      }),
    ).toEqual({ x: 1120, y: 120 });
  });
});

describe("resolveCanvasActionCardId", () => {
  it("allows layout actions to target newly added asset cards by asset id", () => {
    const card = makeAssetCard("cat-card", 100, 120);

    expect(resolveCanvasActionCardId(card.asset.id, [card])).toBe(card.id);
    expect(resolveCanvasActionCardId(card.id, [card])).toBe(card.id);
    expect(resolveCanvasActionCardId("missing", [card])).toBe("missing");
  });
});

describe("uploadCardsFromAttachments", () => {
  it("turns pending image attachments into selected canvas image cards beside the cluster", () => {
    const cards = [makeAssetCard("existing", 120, 160)];

    const uploads = uploadCardsFromAttachments({
      attachments: [
        {
          id: "attach-1",
          token: "upload-token",
          thumbnailDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
          fileName: "upload-test.svg",
          width: 420,
          height: 280,
        },
      ],
      cards,
      metrics: { existing: { width: 320, height: 240 } },
      viewport: { x: 0, y: 0, scale: 1 },
      containerSize: { width: 1200, height: 800 },
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      kind: "upload",
      x: 620,
      y: 160,
      token: "upload-token",
      fileName: "upload-test.svg",
      uploadWidth: 420,
      uploadHeight: 280,
    });
  });
});

describe("duplicateCardPositionsFromActionResult", () => {
  it("reads explicit duplicate copy positions from action results", () => {
    const positions = duplicateCardPositionsFromActionResult({
      positions: [
        { cardId: "copy-a", x: 1800, y: 1200 },
        { cardId: "copy-b", x: 2160, y: 1200 },
        { cardId: "bad", x: "nope", y: 1200 },
      ],
    });

    expect(positions.get("copy-a")).toEqual({ x: 1800, y: 1200 });
    expect(positions.get("copy-b")).toEqual({ x: 2160, y: 1200 });
    expect(positions.has("bad")).toBe(false);
  });
});

describe("canvasStatusCursorStatus", () => {
  it("keeps phase status on the cursor surface", () => {
    expect(canvasStatusCursorStatus("confirming")).toBe("acting");
    expect(canvasStatusCursorStatus("operation")).toBe("acting");
    expect(canvasStatusCursorStatus("planning")).toBe("thinking");
    expect(canvasStatusCursorStatus("blocked")).toBe("idle");
  });
});

describe("canvasStatusCursorLabel", () => {
  const t = ((key: string) =>
    (
      ({
        "aiCanvas.statusProcessing": "Processing",
        "aiCanvas.statusApplying": "Applying canvas actions",
        "aiCanvas.blocked": "Blocked",
        "aiCanvas.currentTarget": "Target",
      }) as Record<string, string>
    )[key] ?? key) as TFunction;

  it("uses translated generic phase labels for the cursor bubble", () => {
    expect(canvasStatusCursorLabel("planning", t)).toBe("Processing");
    expect(canvasStatusCursorLabel("confirming", t)).toBe("Target");
    expect(canvasStatusCursorLabel("operation", t)).toBe(
      "Applying canvas actions",
    );
    expect(canvasStatusCursorLabel("blocked", t)).toBe("Blocked");
  });
});

describe("clearCanvasToolStatusCursor", () => {
  it("clears stale tool labels while preserving cursor position", () => {
    expect(
      clearCanvasToolStatusCursor({
        x: 12,
        y: 34,
        label: "Added comment",
        emoji: "comment",
        status: "acting",
      }),
    ).toEqual({ x: 12, y: 34, status: "idle" });
  });
});

describe("canvasRunUsageFromDone", () => {
  it("summarizes provider, tokens, rate, and tool loop stats", () => {
    expect(
      canvasRunUsageFromDone({
        type: "done",
        providerName: "openai-compatible",
        modelName: "qwen3-vl",
        durationMs: 10_000,
        inputTokens: 300,
        outputTokens: 120,
        loopStats: [
          {
            loop: 1,
            promptKind: "initial",
            toolCallCount: 2,
            fallbackActionCount: 1,
            invalidActionCount: 0,
          },
          {
            loop: 2,
            promptKind: "repair",
            toolCallCount: 1,
            fallbackActionCount: 0,
            invalidActionCount: 1,
          },
        ],
      }),
    ).toMatchObject({
      providerName: "openai-compatible",
      modelName: "qwen3-vl",
      durationMs: 10_000,
      inputTokens: 300,
      outputTokens: 120,
      totalTokens: 420,
      tokensPerSecond: 12,
      loopCount: 2,
      toolCallCount: 3,
      fallbackActionCount: 1,
      invalidActionCount: 1,
    });
  });
});

describe("canvasActionResultCreatesAssetCards", () => {
  it("keeps catalog search read-only and only materializes explicit add results", () => {
    expect(canvasActionResultCreatesAssetCards("search_assets")).toBe(false);
    expect(canvasActionResultCreatesAssetCards("add_assets_to_canvas")).toBe(
      true,
    );
  });
});

describe("formatOCRActionText", () => {
  const t = ((key: string, options?: Record<string, unknown>) => {
    if (key === "aiCanvas.ocrResultTitle") {
      return `OCR (${String(options?.count)})`;
    }
    if (key === "aiCanvas.ocrEmptyText") return "No visible text.";
    if (key === "aiCanvas.ocrFailed") {
      return `Failed: ${String(options?.error)}`;
    }
    return key;
  }) as TFunction;

  it("does not expose intermediate OCR tool results to chat", () => {
    expect(
      formatOCRActionText(
        {
          displayToUser: false,
          items: [{ fileName: "text.png", status: "ready", text: "HELLO" }],
        },
        t,
      ),
    ).toBe("");
  });
});

describe("canvasAnimationSettleDelay", () => {
  it("waits for nested drag timers that are projected but not queued yet", () => {
    expect(
      canvasAnimationSettleDelay({
        latestAnimationDueAt: 1_100,
        animationStartedAt: 1_000,
        animationEndMs: 1_054,
        now: 1_200,
      }),
    ).toBe(1_034);
  });

  it("uses the absolute projected due time for animations scheduled after a long chat", () => {
    expect(
      canvasAnimationSettleDelay({
        latestAnimationDueAt: 61_054,
        animationStartedAt: 1_000,
        animationEndMs: 1_054,
        now: 60_000,
      }),
    ).toBe(1_234);
  });

  it("clears immediately when no canvas animation was scheduled", () => {
    expect(
      canvasAnimationSettleDelay({
        latestAnimationDueAt: 0,
        animationStartedAt: 1_000,
        animationEndMs: 0,
        now: 1_200,
      }),
    ).toBe(0);
  });
});

describe("canvasCaptureQueueDelay", () => {
  it("staggers multiple capture previews within one AI response", () => {
    expect(canvasCaptureQueueDelay(120, 0)).toBe(120);
    expect(canvasCaptureQueueDelay(120, 1)).toBe(1320);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasChat,
  serializeCanvasSnapshot,
  type CanvasChatEvent,
} from "@/api/canvasChat";
import type { AssetItem } from "@/types";
import type { AssetCanvasCard } from "./aiCanvasState";
import {
  canvasActionResultCardIds,
  canvasFocusCardFromEvent,
  canvasProposalCardFromEvent,
} from "./canvasChatEventContract";
import { focusCursorPosition } from "./canvasChatHelpers";

function streamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function makeAsset(id: string, repoPath: string): AssetItem {
  return {
    id,
    projectId: "project-1",
    projectName: "Project",
    repoPath,
    localPath: `/tmp/${repoPath}`,
    ext: ".png",
    bytes: 1024,
    modifiedUnix: 0,
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
    thumbnailUrl: `/api/assets/${id}/thumb`,
    usedBy: [],
    references: [],
    duplicateGroupId: null,
    duplicates: [],
    similar: [],
    preferredDuplicatePath: null,
    optimizationRecommendations: [],
    ocr: {
      status: "ready",
      text: "BOOK",
      languages: ["eng"],
    },
    aiTag: {
      status: "ready",
      category: "illustration",
      tags: ["book-cover", "lion"],
      description: "Book cover with a lion illustration.",
      languages: ["eng"],
    },
  };
}

function makeAssetCard(
  id: string,
  assetId: string,
  x: number,
  y: number,
): AssetCanvasCard {
  return {
    id,
    kind: "asset",
    x,
    y,
    createdAt: "2026-05-14T00:00:00.000Z",
    asset: makeAsset(assetId, `${assetId}.png`),
  };
}

describe("canvas chat frontend event contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes asset image references and visual metadata for AI context", () => {
    const [card] = [makeAssetCard("card-a", "asset-a", 10, 20)];

    const snapshot = serializeCanvasSnapshot([card], ["card-a"], {
      x: 0,
      y: 0,
      scale: 1,
    });
    const payload = snapshot.cards[0].asset as Record<string, unknown>;

    expect(payload).toMatchObject({
      id: "asset-a",
      fileName: "asset-a.png",
      repoPath: "asset-a.png",
      projectName: "Project",
      imageFormat: "png",
      width: 320,
      height: 240,
      url: "/api/assets/asset-a",
      thumbnailUrl: "/api/assets/asset-a/thumb",
      searchDescription: "Book cover with a lion illustration.",
      searchLanguages: ["eng"],
      ocrText: "BOOK",
    });
  });

  it("resolves streamed asset ids to canvas card ids", () => {
    const cards = [makeAssetCard("card-a", "asset-a", 10, 20)];

    expect(
      canvasActionResultCardIds({ cardIds: ["asset-a", "missing"] }, cards),
    ).toEqual(["card-a"]);
    expect(
      canvasFocusCardFromEvent({ type: "focus", cardId: "asset-a" }, cards)?.id,
    ).toBe("card-a");
  });

  it("maps streamed focus, action_result, and proposal events to canvas state inputs", async () => {
    const cards = [
      makeAssetCard("card-a", "asset-a", 10, 20),
      makeAssetCard("card-b", "asset-b", 280, 20),
    ];
    const events: CanvasChatEvent[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks([
        '{"type":"focus","cardId":"card-a","label":"Inspect"}\n',
        '{"type":"status","phase":"confirming","content":"Confirming target: Inspect"}\n',
        '{"type":"action_result","tool":"select_cards","result":{"cardIds":["card-a","missing","card-b"],"label":"Selected"}}\n',
        '{"type":"proposal","id":"proposal-1","tool":"rotate_image","params":{"assetId":"asset-a","degrees":90},"description":"Rotate asset","impact":"Creates a rotated variant","targetAssetIds":["asset-a"]}\n',
        '{"type":"done","providerName":"fake","modelName":"fixture","durationMs":12}\n',
      ]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const done = await canvasChat({
      messages: [{ role: "user", content: "select and rotate" }],
      canvas: serializeCanvasSnapshot(cards, ["card-a"], {
        x: 0,
        y: 0,
        scale: 1,
      }),
      locale: "en",
      onEvent: (event) => events.push(event),
    });

    expect(done).toEqual({
      type: "done",
      providerName: "fake",
      modelName: "fixture",
      durationMs: 12,
    });
    expect(events.map((event) => event.type)).toEqual([
      "focus",
      "status",
      "action_result",
      "proposal",
      "done",
    ]);

    const focusEvent = events[0];
    if (focusEvent.type !== "focus") throw new Error("expected focus event");
    const focusedCard = canvasFocusCardFromEvent(focusEvent, cards);
    expect(focusedCard?.id).toBe("card-a");
    expect(
      focusedCard &&
        focusCursorPosition(
          focusedCard,
          { "card-a": { width: 220, height: 160 } },
          1,
        ),
    ).toEqual({ x: 114, y: 92 });

    const statusEvent = events[1];
    if (statusEvent.type !== "status") throw new Error("expected status event");
    expect(statusEvent.content).toBe("Confirming target: Inspect");

    const selectEvent = events[2];
    if (selectEvent.type !== "action_result") {
      throw new Error("expected action_result event");
    }
    expect(canvasActionResultCardIds(selectEvent.result, cards)).toEqual([
      "card-a",
      "card-b",
    ]);

    const proposalEvent = events[3];
    if (proposalEvent.type !== "proposal") {
      throw new Error("expected proposal event");
    }
    expect(
      canvasProposalCardFromEvent(proposalEvent, {
        cards,
        cardLayoutMetrics: { "card-a": { width: 220 } },
        createId: () => "proposal-card-1",
        now: () => "2026-05-14T00:00:01.000Z",
      }),
    ).toMatchObject({
      id: "proposal-card-1",
      kind: "proposal",
      x: 10,
      y: 284,
      createdAt: "2026-05-14T00:00:01.000Z",
      proposalId: "proposal-1",
      tool: "rotate_image",
      params: { assetId: "asset-a", degrees: 90 },
      description: "",
      impact: "",
      status: "pending",
      sourceAssetId: "asset-a",
      sourceAssetIds: ["asset-a"],
    });
  });
});

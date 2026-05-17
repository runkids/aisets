import { describe, expect, it } from "vitest";
import type { AssetItem } from "@/types";
import {
  buildAssistantBullets,
  cardDisplayName,
  cardIdsForBulkDeletion,
  compactAICanvasSessionForStorage,
  cardIdsForDeletion,
  commentsForAssets,
  inferPromptIntent,
  normalizeAICanvasSession,
  selectedAssetCards,
  shouldScheduleAICanvasAutoSave,
  writeAICanvasSession,
  type AssetCanvasCard,
  type CommentCanvasCard,
  type GroupCanvasCard,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import { canStartCanvasPlanTasks, normalizePlanTasks } from "./canvasPlanState";

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

describe("shouldScheduleAICanvasAutoSave", () => {
  it("does not schedule while a drag is active", () => {
    expect(
      shouldScheduleAICanvasAutoSave({
        isDirty: true,
        cardsLength: 1,
        isSaving: false,
        isDragging: true,
      }),
    ).toBe(false);
  });

  it("schedules only for dirty non-empty idle sessions", () => {
    expect(
      shouldScheduleAICanvasAutoSave({
        isDirty: true,
        cardsLength: 1,
        isSaving: false,
        isDragging: false,
      }),
    ).toBe(true);
    expect(
      shouldScheduleAICanvasAutoSave({
        isDirty: false,
        cardsLength: 1,
        isSaving: false,
        isDragging: false,
      }),
    ).toBe(false);
    expect(
      shouldScheduleAICanvasAutoSave({
        isDirty: true,
        cardsLength: 0,
        isSaving: false,
        isDragging: false,
      }),
    ).toBe(false);
    expect(
      shouldScheduleAICanvasAutoSave({
        isDirty: true,
        cardsLength: 1,
        isSaving: true,
        isDragging: false,
      }),
    ).toBe(false);
  });
});

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

function makeVariantCard(id: string): VariantCanvasCard {
  return {
    id: `variant-${id}`,
    kind: "variant",
    x: 10,
    y: 20,
    createdAt: "2026-05-13T00:00:00.000Z",
    sourceAssetId: `asset-${id}`,
    sourceName: `${id}.png`,
    previewUrl: `/assets/${id}-variant.png`,
    token: `token-${id}`,
    inputBytes: 1200,
    outputBytes: 1200,
    inputFormat: "png",
    outputFormat: "png",
    width: 100,
    height: 100,
  };
}

describe("normalizeAICanvasSession", () => {
  it("keeps valid cards and drops stale selected ids", () => {
    const session = normalizeAICanvasSession({
      cards: [makeAssetCard("hero"), { kind: "asset", id: "" }],
      selectedCardIds: ["missing"],
      viewport: { x: 5, y: 10, scale: 8 },
    });

    expect(session.cards).toHaveLength(1);
    expect(session.selectedCardIds).toBeUndefined();
    expect(session.viewport.scale).toBe(8);
  });

  it("migrates legacy selectedCardId to selectedCardIds", () => {
    const asset = makeAssetCard("hero");
    const session = normalizeAICanvasSession({
      cards: [asset],
      selectedCardId: asset.id,
      viewport: { x: 0, y: 0, scale: 1 },
    });

    expect(session.selectedCardIds).toEqual([asset.id]);
  });

  it("preserves canvas plan state in stored sessions", () => {
    const session = normalizeAICanvasSession({
      cards: [],
      viewport: { x: 0, y: 0, scale: 1 },
      plan: {
        id: "plan-1",
        status: "running",
        activeStepId: "step-1",
        createdAt: "2026-05-17T00:00:00.000Z",
        updatedAt: "2026-05-17T00:00:00.000Z",
        steps: [
          {
            id: "step-1",
            task: "Arrange cards",
            status: "running",
            evidence: ["executed actions: 1"],
          },
          {
            id: "step-2",
            task: "Capture canvas",
            status: "pending",
          },
        ],
      },
    });

    expect(session.plan).toMatchObject({
      id: "plan-1",
      status: "running",
      activeStepId: "step-1",
      steps: [
        {
          id: "step-1",
          task: "Arrange cards",
          status: "running",
          evidence: ["executed actions: 1"],
        },
        {
          id: "step-2",
          task: "Capture canvas",
          status: "pending",
        },
      ],
    });
  });

  it("keeps grouped image children when restoring a session", () => {
    const asset = makeAssetCard("hero");
    const variant = makeVariantCard("alt");
    const session = normalizeAICanvasSession({
      cards: [
        {
          id: "group-1",
          kind: "group",
          x: 10,
          y: 20,
          createdAt: "2026-05-13T00:00:00.000Z",
          cards: [
            { ...asset, x: 0, y: 0 },
            { ...variant, x: 120, y: 12 },
          ],
          name: "Hero set",
          cardWidths: { [asset.id]: 100, [variant.id]: 80 },
          width: 220,
          height: 140,
        },
      ],
      selectedCardIds: ["group-1"],
      viewport: { x: 0, y: 0, scale: 1 },
    });

    const group = session.cards[0] as GroupCanvasCard;
    expect(group.kind).toBe("group");
    expect(group.cards.map((card) => card.id)).toEqual([asset.id, variant.id]);
    expect(group.name).toBe("Hero set");
    expect(group.cardWidths?.[asset.id]).toBe(100);
    expect(session.selectedCardIds).toEqual(["group-1"]);
  });

  it("drops empty groups when restoring a session", () => {
    const session = normalizeAICanvasSession({
      cards: [
        {
          id: "group-1",
          kind: "group",
          x: 0,
          y: 0,
          createdAt: "2026-05-13T00:00:00.000Z",
          cards: [],
          width: 100,
          height: 100,
        },
      ],
      selectedCardIds: ["group-1"],
      viewport: { x: 0, y: 0, scale: 1 },
    });

    expect(session.cards).toEqual([]);
    expect(session.selectedCardIds).toBeUndefined();
  });

  it("preserves chat entries with only attachments", () => {
    const session = normalizeAICanvasSession({
      cards: [],
      viewport: { x: 0, y: 0, scale: 1 },
      chatHistory: [
        { role: "user", content: "hello" },
        {
          role: "user",
          content: "",
          attachments: [
            {
              token: "abc",
              thumbnailDataUrl: "data:image/png;base64,x",
              fileName: "test.png",
              width: 100,
              height: 100,
            },
          ],
        },
        { role: "user", content: "" },
      ],
    });

    expect(session.chatHistory).toHaveLength(2);
    expect(session.chatHistory![1].attachments).toHaveLength(1);
  });

  it("preserves assistant activity-only entries and usage summaries", () => {
    const session = normalizeAICanvasSession({
      cards: [],
      viewport: { x: 0, y: 0, scale: 1 },
      chatHistory: [
        {
          role: "assistant",
          content: "",
          activity: [
            {
              id: "step-1",
              kind: "tool",
              label: "Tool completed",
              detail: "create_comment",
              atMs: 1200,
              tone: "success",
            },
          ],
          usage: {
            providerName: "openai-compatible",
            modelName: "qwen3-vl",
            durationMs: 4321,
            totalTokens: 120,
            tokensPerSecond: 12.34,
            toolCallCount: 1,
            executedActionCount: 1,
          },
        },
      ],
    });

    expect(session.chatHistory).toHaveLength(1);
    expect(session.chatHistory![0].activity?.[0]).toMatchObject({
      kind: "tool",
      label: "Tool completed",
      detail: "create_comment",
      atMs: 1200,
    });
    expect(session.chatHistory![0].usage).toMatchObject({
      providerName: "openai-compatible",
      modelName: "qwen3-vl",
      durationMs: 4321,
      totalTokens: 120,
      tokensPerSecond: 12.34,
      toolCallCount: 1,
      executedActionCount: 1,
    });
  });
});

describe("canvas plan task validation", () => {
  it("requires at least two non-empty tasks before starting", () => {
    expect(canStartCanvasPlanTasks(["One task"])).toBe(false);
    expect(canStartCanvasPlanTasks(["One task", ""])).toBe(false);
    expect(canStartCanvasPlanTasks([" One task ", " Two task "])).toBe(true);
    expect(normalizePlanTasks([" One task ", "", " Two task "])).toEqual([
      "One task",
      "Two task",
    ]);
  });
});

describe("writeAICanvasSession", () => {
  const upload: UploadCanvasCard = {
    id: "upload-1",
    kind: "upload",
    x: 0,
    y: 0,
    createdAt: "2026-05-14T00:00:00.000Z",
    token: "tok-1",
    thumbnailDataUrl: "data:image/png;base64," + "x".repeat(100),
    fileName: "photo.png",
    uploadWidth: 100,
    uploadHeight: 100,
  };

  it("strips upload thumbnail data urls before persisting", () => {
    const compact = compactAICanvasSessionForStorage({
      version: 1,
      cards: [upload],
      viewport: { x: 0, y: 0, scale: 1 },
      chatHistory: [
        {
          role: "user",
          content: "",
          attachments: [
            {
              token: "att-1",
              thumbnailDataUrl: upload.thumbnailDataUrl,
              fileName: "photo.png",
              width: 100,
              height: 100,
            },
          ],
        },
      ],
    });

    expect((compact.cards[0] as UploadCanvasCard).thumbnailDataUrl).toBe("");
    expect(compact.chatHistory![0].attachments![0].thumbnailDataUrl).toBe("");
    expect(compact.chatHistory![0].attachments![0].token).toBe("att-1");
  });

  it("does not throw when sessionStorage quota is exceeded", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };

    expect(() =>
      writeAICanvasSession(storage, {
        version: 1,
        cards: [upload],
        viewport: { x: 0, y: 0, scale: 1 },
        chatHistory: [{ role: "user", content: "hello" }],
      }),
    ).not.toThrow();
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

    expect(selectedAssetCards([asset, comment], [comment.id])).toEqual([asset]);
    expect(commentsForAssets([asset, comment], [asset.id])).toEqual([comment]);
  });

  it("returns asset children from a selected group", () => {
    const asset = makeAssetCard("hero");
    const variant = makeVariantCard("alt");
    const group: GroupCanvasCard = {
      id: "group-1",
      kind: "group",
      x: 0,
      y: 0,
      createdAt: "2026-05-13T00:00:00.000Z",
      cards: [asset, variant],
      cardWidths: { [asset.id]: 120, [variant.id]: 90 },
      width: 240,
      height: 160,
    };

    expect(selectedAssetCards([group], [group.id])).toEqual([asset]);
    expect(cardDisplayName({ ...group, name: "Named group" })).toBe(
      "Named group",
    );
  });
});

describe("inferPromptIntent", () => {
  it("routes common canvas prompts to preview actions", () => {
    expect(inferPromptIntent("annotate this corner")).toBe("comment");
    expect(inferPromptIntent("compress as webp safe variant")).toBe(
      "operationPreview",
    );
    expect(inferPromptIntent("recolor this -> RED")).toBe("imageEdit");
    expect(inferPromptIntent("generate preview")).toBe("imagePreview");
    expect(inferPromptIntent("rendered preview")).toBe("imagePreview");
    expect(inferPromptIntent("describe background")).toBe("describe");
    expect(inferPromptIntent("describe context")).toBe("describe");
  });
});

describe("cardIdsForDeletion", () => {
  it("removes anchored comments only when deleting the asset card", () => {
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

    expect([...cardIdsForDeletion([asset, comment], asset.id)]).toEqual([
      asset.id,
      comment.id,
    ]);
    expect([...cardIdsForDeletion([asset, comment], comment.id)]).toEqual([
      comment.id,
    ]);
  });

  it("cascades comments when deleting an upload card", () => {
    const upload: UploadCanvasCard = {
      id: "upload-1",
      kind: "upload",
      x: 0,
      y: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      token: "tok-1",
      thumbnailDataUrl: "",
      fileName: "photo.png",
      uploadWidth: 100,
      uploadHeight: 100,
    };
    const comment: CommentCanvasCard = {
      id: "comment-u1",
      kind: "comment",
      x: 10,
      y: 10,
      createdAt: "2026-05-14T00:00:00.000Z",
      anchorId: upload.id,
      text: "Annotation",
      region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    };
    expect([...cardIdsForDeletion([upload, comment], upload.id)]).toEqual([
      upload.id,
      comment.id,
    ]);
  });

  it("cascades comments when deleting a variant card", () => {
    const variant = makeVariantCard("rotated");
    const comment: CommentCanvasCard = {
      id: "comment-v1",
      kind: "comment",
      x: 10,
      y: 10,
      createdAt: "2026-05-14T00:00:00.000Z",
      anchorId: variant.id,
      text: "Variant annotation",
      region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    };
    expect([...cardIdsForDeletion([variant, comment], variant.id)]).toEqual([
      variant.id,
      comment.id,
    ]);
  });
});

describe("cardIdsForBulkDeletion", () => {
  it("collects cascade targets across multiple selected cards", () => {
    const a1 = makeAssetCard("a1");
    const a2 = makeAssetCard("a2");
    const c1: CommentCanvasCard = {
      id: "c1",
      kind: "comment",
      x: 0,
      y: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      anchorId: a1.id,
      text: "Note",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    };
    const c2: CommentCanvasCard = {
      id: "c2",
      kind: "comment",
      x: 0,
      y: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      anchorId: a2.id,
      text: "Note 2",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    };
    const all = [a1, a2, c1, c2];
    const result = cardIdsForBulkDeletion(all, [a1.id, a2.id]);
    expect(result).toEqual(new Set([a1.id, a2.id, c1.id, c2.id]));
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
      [asset.id],
    );

    expect(bullets).toContain("hero.png · 640x480 · 2.0 KB");
    expect(bullets).toContain("AI tags: banner, marketing");
    expect(bullets).toContain("Canvas comments: Make this area brighter");
  });
});

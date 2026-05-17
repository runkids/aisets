import type { TFunction } from "i18next";
import type {
  CanvasCardLayoutMetrics,
  CanvasChatEvent,
} from "@/api/canvasChat";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  createCanvasCardId,
  type AssetCanvasCard,
  type CanvasCard,
  type CanvasRegion,
  type ChatMentionPreview,
  type ChatRunUsage,
  type PendingAttachment,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import { CARD_WIDTH, imageMeta, nextCardPosition, nowISO } from "./canvasUtils";

export type AICursorState = {
  x: number;
  y: number;
  label?: string;
  emoji?: string;
  status: "thinking" | "acting" | "idle";
};

export const CAPTURE_QUEUE_GAP_MS = 1200;
export const TOOL_STATUS_CLEAR_DELAY_MS = 250;
export const CHAT_ACTIVITY_LIMIT = 24;

export function isScreenStableCard(card: CanvasCard) {
  return (
    card.kind === "comment" ||
    card.kind === "assistant" ||
    card.kind === "proposal" ||
    card.kind === "operation"
  );
}

export function aiCardTransform(
  card: CanvasCard,
  x: number,
  y: number,
  scale: number,
) {
  const stableScale = isScreenStableCard(card) && scale > 0 ? 1 / scale : 1;
  return `translate3d(${x}px, ${y}px, 0) scale(${stableScale})`;
}

export function focusCursorPosition(
  card: CanvasCard,
  metrics: CanvasCardLayoutMetrics,
  viewportScale: number,
): Pick<AICursorState, "x" | "y"> {
  const stableScale =
    isScreenStableCard(card) && viewportScale > 0 ? 1 / viewportScale : 1;
  const width = metrics[card.id]?.width ?? CARD_WIDTH * stableScale;
  const height = metrics[card.id]?.height ?? 240 * stableScale;
  const pointerXOffset = viewportScale > 0 ? 6 / viewportScale : 6;
  const pointerYOffset = viewportScale > 0 ? 8 / viewportScale : 8;
  return {
    x: card.x + width / 2 - pointerXOffset,
    y: card.y + height / 2 - pointerYOffset,
  };
}

export function resizeCursorPosition(
  card: CanvasCard,
  metrics: CanvasCardLayoutMetrics,
  viewportScale: number,
  width?: number,
): Pick<AICursorState, "x" | "y"> {
  const stableScale =
    isScreenStableCard(card) && viewportScale > 0 ? 1 / viewportScale : 1;
  const baseWidth = metrics[card.id]?.width ?? CARD_WIDTH * stableScale;
  const baseHeight = metrics[card.id]?.height ?? 240 * stableScale;
  const nextWidth = width ?? baseWidth;
  const nextHeight =
    baseWidth > 0 ? nextWidth * (baseHeight / baseWidth) : baseHeight;
  const pointerXOffset = viewportScale > 0 ? 6 / viewportScale : 6;
  const pointerYOffset = viewportScale > 0 ? 8 / viewportScale : 8;
  return {
    x: card.x + nextWidth - pointerXOffset,
    y: card.y + nextHeight - pointerYOffset,
  };
}

export function isCaptureTool(tool: string) {
  return (
    tool === "capture_viewport" ||
    tool === "capture_canvas" ||
    tool === "capture_selected"
  );
}

type CanvasChatDone = Extract<CanvasChatEvent, { type: "done" }>;

export function canvasRunUsageFromDone(done: CanvasChatDone): ChatRunUsage {
  const inputTokens =
    typeof done.inputTokens === "number" && Number.isFinite(done.inputTokens)
      ? done.inputTokens
      : undefined;
  const outputTokens =
    typeof done.outputTokens === "number" && Number.isFinite(done.outputTokens)
      ? done.outputTokens
      : undefined;
  const totalTokens =
    inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) + (outputTokens ?? 0);
  const seconds = done.durationMs > 0 ? done.durationMs / 1000 : 0;
  const rateBase = outputTokens ?? totalTokens;
  const loopStats = done.loopStats ?? [];
  const sumLoopField = (
    field: keyof NonNullable<CanvasChatDone["loopStats"]>[number],
  ) =>
    loopStats.reduce((sum, stat) => {
      const value = stat[field];
      return typeof value === "number" && Number.isFinite(value)
        ? sum + value
        : sum;
    }, 0);

  return {
    providerName: done.providerName,
    modelName: done.modelName,
    durationMs: done.durationMs,
    inputTokens,
    outputTokens,
    totalTokens,
    tokensPerSecond:
      rateBase !== undefined && seconds > 0
        ? Math.round((rateBase / seconds) * 100) / 100
        : undefined,
    loopCount: loopStats.length || undefined,
    toolCallCount: sumLoopField("toolCallCount") || undefined,
    fallbackActionCount: sumLoopField("fallbackActionCount") || undefined,
    executedActionCount: sumLoopField("executedActionCount") || undefined,
    invalidActionCount: sumLoopField("invalidActionCount") || undefined,
  };
}

export function isCanvasRegion(value: unknown): value is CanvasRegion {
  if (!value || typeof value !== "object") {
    return false;
  }
  const region = value as Partial<CanvasRegion>;
  return (
    typeof region.x === "number" &&
    typeof region.y === "number" &&
    typeof region.width === "number" &&
    typeof region.height === "number"
  );
}

export function isAssetItem(value: unknown): value is AssetItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AssetItem>;
  return (
    typeof item.id === "string" &&
    typeof item.repoPath === "string" &&
    typeof item.projectId === "string" &&
    Boolean(item.image) &&
    typeof item.url === "string" &&
    typeof item.thumbnailUrl === "string"
  );
}

export function assetsFromActionResult(result: unknown): AssetItem[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(isAssetItem);
}

export function searchResultNeedsUserConfirmation(result: unknown) {
  return (
    Boolean(result) &&
    typeof result === "object" &&
    (result as { needsUserConfirmation?: unknown }).needsUserConfirmation ===
      true
  );
}

export function candidatePreviewMentionsFromSearchResult(
  result: unknown,
): ChatMentionPreview[] {
  if (!searchResultNeedsUserConfirmation(result)) return [];
  const candidates = (result as { candidatePreviews?: unknown })
    .candidatePreviews;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(isAssetItem).map((asset) => ({
    id: asset.id,
    name: fileName(asset.repoPath),
    meta: imageMeta(asset),
    src: asset.thumbnailUrl || asset.url,
    kind: "searchCandidate",
    asset,
  }));
}

export type OCRTextActionItem = {
  assetId?: string;
  cardId?: string;
  repoPath?: string;
  fileName?: string;
  source?: string;
  status?: string;
  text?: string;
  languages?: string[];
  errorMessage?: string;
};

export function ocrItemsFromActionResult(result: unknown): OCRTextActionItem[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is OCRTextActionItem =>
      Boolean(item) && typeof item === "object",
  );
}

export type DuplicateCardCopy = {
  sourceCardId?: string;
  cardId?: string;
};

export function duplicateCardCopiesFromActionResult(result: unknown) {
  if (!result || typeof result !== "object") return [];
  const copies = (result as { copies?: unknown }).copies;
  if (!Array.isArray(copies)) return [];
  return copies.filter(
    (copy): copy is DuplicateCardCopy =>
      Boolean(copy) && typeof copy === "object",
  );
}

export function isImageVariantTool(tool: string) {
  return (
    tool === "compress_image" ||
    tool === "resize_image" ||
    tool === "convert_image" ||
    tool === "mirror_image" ||
    tool === "rotate_image"
  );
}

export function actionResultAssetIds(result: unknown) {
  if (!result || typeof result !== "object") return [];
  const r = result as { assetId?: unknown; assetIds?: unknown };
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim() && !ids.includes(value)) {
      ids.push(value);
    }
  };
  add(r.assetId);
  if (Array.isArray(r.assetIds)) {
    for (const id of r.assetIds) add(id);
  }
  return ids;
}

export function stringParam(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function numberParam(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function duplicateCardPositionsFromActionResult(result: unknown) {
  const positions = new Map<string, { x: number; y: number }>();
  if (!result || typeof result !== "object") return positions;
  const rawPositions = (result as { positions?: unknown }).positions;
  if (!Array.isArray(rawPositions)) return positions;
  for (const raw of rawPositions) {
    if (!raw || typeof raw !== "object") continue;
    const position = raw as { cardId?: unknown; x?: unknown; y?: unknown };
    if (
      typeof position.cardId !== "string" ||
      typeof position.x !== "number" ||
      typeof position.y !== "number" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      continue;
    }
    positions.set(position.cardId, { x: position.x, y: position.y });
  }
  return positions;
}

export type DuplicatableCanvasCard =
  | AssetCanvasCard
  | UploadCanvasCard
  | VariantCanvasCard;

function isDuplicatableCanvasCard(
  card: CanvasCard,
): card is DuplicatableCanvasCard {
  return (
    card.kind === "asset" || card.kind === "upload" || card.kind === "variant"
  );
}

export function duplicateCanvasCardsFromActionResult({
  result,
  canvasCards,
  cardLayoutMetrics,
}: {
  result: unknown;
  canvasCards: CanvasCard[];
  cardLayoutMetrics: CanvasCardLayoutMetrics;
}) {
  const copies = duplicateCardCopiesFromActionResult(result);
  const positions = duplicateCardPositionsFromActionResult(result);
  const layout = (result as { layout?: unknown })?.layout;
  const walking = typeof layout === "string" && /walk|walking/i.test(layout);
  const perSourceIndex = new Map<string, number>();
  const cards: DuplicatableCanvasCard[] = [];
  const widths: Record<string, number> = {};

  for (const copy of copies) {
    if (!copy.sourceCardId || !copy.cardId) continue;
    const source = canvasCards.find(
      (card): card is DuplicatableCanvasCard =>
        card.id === copy.sourceCardId && isDuplicatableCanvasCard(card),
    );
    if (!source) continue;

    const index = perSourceIndex.get(source.id) ?? 0;
    perSourceIndex.set(source.id, index + 1);
    const sourceWidth = cardLayoutMetrics[source.id]?.width ?? CARD_WIDTH;
    const stepX = walking ? Math.max(108, sourceWidth * 0.46) : 36;
    const stepY = walking ? (index % 2 === 0 ? 18 : -12) : 36;
    const position = positions.get(copy.cardId);
    const card = {
      ...source,
      id: copy.cardId,
      x: position?.x ?? source.x + (index + 1) * stepX,
      y: position?.y ?? source.y + (index + 1) * stepY,
      createdAt: nowISO(),
    };

    cards.push(card);
    if (sourceWidth) {
      widths[copy.cardId] = sourceWidth;
    }
  }

  return { cards, widths };
}

export function formatOCRActionText(result: unknown, t: TFunction) {
  if (
    result &&
    typeof result === "object" &&
    (result as { displayToUser?: unknown }).displayToUser === false
  ) {
    return "";
  }
  const items = ocrItemsFromActionResult(result);
  if (items.length === 0) return "";
  const lines = [
    `**${t("aiCanvas.ocrResultTitle", { count: items.length })}**`,
  ];
  for (const item of items) {
    const name = item.fileName
      ? item.fileName
      : item.repoPath
        ? fileName(item.repoPath)
        : item.assetId || item.cardId || "";
    lines.push("", `**${name}**`);
    if (item.status === "ready") {
      lines.push(item.text?.trim() || t("aiCanvas.ocrEmptyText"));
    } else {
      lines.push(
        t("aiCanvas.ocrFailed", {
          error: item.errorMessage || item.status || "unknown",
        }),
      );
    }
  }
  return lines.join("\n");
}

export function imageCards(cards: CanvasCard[]) {
  return cards.filter(
    (card) =>
      card.kind === "asset" ||
      card.kind === "upload" ||
      card.kind === "variant" ||
      card.kind === "group",
  );
}

export function visibleImageCards(
  cards: CanvasCard[],
  metrics: CanvasCardLayoutMetrics,
  viewport?: { x: number; y: number; scale: number },
  containerSize?: { width: number; height: number },
) {
  const candidates = imageCards(cards);
  if (!viewport || !containerSize || viewport.scale <= 0) return candidates;
  const viewLeft = -viewport.x / viewport.scale;
  const viewTop = -viewport.y / viewport.scale;
  const viewRight = viewLeft + containerSize.width / viewport.scale;
  const viewBottom = viewTop + containerSize.height / viewport.scale;
  const visible = candidates.filter((card) => {
    const width = metrics[card.id]?.width ?? CARD_WIDTH;
    const height = metrics[card.id]?.height ?? 240;
    return (
      card.x < viewRight &&
      card.x + width > viewLeft &&
      card.y < viewBottom &&
      card.y + height > viewTop
    );
  });
  return visible.length > 0 ? visible : candidates;
}

export function searchResultCardPosition(opts: {
  cards: CanvasCard[];
  metrics: CanvasCardLayoutMetrics;
  index: number;
  viewport?: { x: number; y: number; scale: number };
  containerSize?: { width: number; height: number };
}) {
  const visible = visibleImageCards(
    opts.cards,
    opts.metrics,
    opts.viewport,
    opts.containerSize,
  );
  if (visible.length === 0) {
    return nextCardPosition(opts.index, opts.viewport, opts.containerSize);
  }
  const maxRight = Math.max(
    ...visible.map(
      (card) => card.x + (opts.metrics[card.id]?.width ?? CARD_WIDTH),
    ),
  );
  const minTop = Math.min(...visible.map((card) => card.y));
  return {
    x: Math.round(maxRight + 180 + opts.index * (CARD_WIDTH + 56)),
    y: Math.round(minTop),
  };
}

export function resolveCanvasActionCardId(rawId: string, cards: CanvasCard[]) {
  if (cards.some((card) => card.id === rawId)) return rawId;
  const assetCard = cards.find(
    (card): card is AssetCanvasCard =>
      card.kind === "asset" && card.asset.id === rawId,
  );
  return assetCard?.id ?? rawId;
}

export function uploadCardsFromAttachments(opts: {
  attachments: PendingAttachment[];
  cards: CanvasCard[];
  metrics: CanvasCardLayoutMetrics;
  viewport?: { x: number; y: number; scale: number };
  containerSize?: { width: number; height: number };
}) {
  const visible = visibleImageCards(
    opts.cards,
    opts.metrics,
    opts.viewport,
    opts.containerSize,
  );
  return opts.attachments.map((att, index): UploadCanvasCard => {
    const position =
      visible.length > 0
        ? searchResultCardPosition({
            cards: visible,
            metrics: opts.metrics,
            index,
            viewport: opts.viewport,
            containerSize: opts.containerSize,
          })
        : nextCardPosition(index, opts.viewport, opts.containerSize);
    return {
      id: createCanvasCardId("upload"),
      kind: "upload",
      x: position.x,
      y: position.y,
      createdAt: nowISO(),
      token: att.token,
      thumbnailDataUrl: att.thumbnailDataUrl,
      fileName: att.fileName,
      uploadWidth: att.width,
      uploadHeight: att.height,
    };
  });
}

export function canvasStatusCursorStatus(
  phase?: string,
): AICursorState["status"] {
  if (phase === "confirming" || phase === "operation") return "acting";
  if (phase === "blocked") return "idle";
  return "thinking";
}

export function canvasStatusCursorLabel(
  phase: string | undefined,
  t: TFunction,
) {
  if (phase === "operation") return t("aiCanvas.statusApplying");
  if (phase === "blocked") return t("aiCanvas.blocked");
  if (phase === "confirming") return t("aiCanvas.currentTarget");
  return t("aiCanvas.statusProcessing");
}

export function clearCanvasToolStatusCursor(
  prev: AICursorState,
): AICursorState {
  return { ...prev, label: undefined, emoji: undefined, status: "idle" };
}

export function canvasActionResultCreatesAssetCards(tool: string) {
  return tool === "add_assets_to_canvas";
}

export function canvasAnimationSettleDelay(opts: {
  latestAnimationDueAt: number;
  animationStartedAt: number;
  animationEndMs: number;
  now: number;
}) {
  if (opts.latestAnimationDueAt <= 0 && opts.animationEndMs <= 0) return 0;
  const projectedDueAt = opts.animationStartedAt + opts.animationEndMs;
  const dueAt = Math.max(opts.latestAnimationDueAt, projectedDueAt);
  return Math.max(900, dueAt - opts.now + 180);
}

export function canvasCaptureQueueDelay(baseDelay: number, index: number) {
  return baseDelay + Math.max(0, index) * CAPTURE_QUEUE_GAP_MS;
}

export function mentionPreviewForCard(
  card: CanvasCard,
): ChatMentionPreview | undefined {
  if (card.kind === "asset") {
    return {
      id: card.id,
      name: fileName(card.asset.repoPath),
      meta: imageMeta(card.asset),
      src: card.asset.thumbnailUrl || card.asset.url,
    };
  }
  if (card.kind === "variant") {
    return {
      id: card.id,
      name: card.sourceName,
      meta: `${card.inputFormat.toUpperCase()} → ${card.outputFormat.toUpperCase()}`,
      src: card.previewUrl,
    };
  }
  return undefined;
}

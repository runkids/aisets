import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { useRef } from "react";
import type { TFunction } from "i18next";
import {
  canvasChat,
  serializeCanvasSnapshot,
  type CanvasCardLayoutMetrics,
  type CanvasChatEvent,
} from "@/api/canvasChat";
import { previewImageUrl, renderImageToolPreview } from "@/api/imageTools";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  createCanvasCardId,
  sanitizeCanvasChatContent,
  type AssetCanvasCard,
  type CanvasCard,
  type ChatHistoryEntry,
  type ChatMentionPreview,
  type CommentCanvasCard,
  type CanvasRegion,
  type PendingAttachment,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import {
  CARD_WIDTH,
  adjacentCardPosition,
  imageMeta,
  nextCardPosition,
  nowISO,
} from "./canvasUtils";
import {
  canvasActionResultCardIds,
  canvasFocusCardFromEvent,
  canvasProposalCardFromEvent,
} from "./canvasChatEventContract";
import type { WorkingState } from "./aiCanvasTypes";

type AICursorState = {
  x: number;
  y: number;
  label?: string;
  emoji?: string;
  status: "thinking" | "acting" | "idle";
};

const CAPTURE_QUEUE_GAP_MS = 1200;
const TOOL_STATUS_CLEAR_DELAY_MS = 250;

function isScreenStableCard(card: CanvasCard) {
  return (
    card.kind === "comment" ||
    card.kind === "assistant" ||
    card.kind === "proposal" ||
    card.kind === "operation"
  );
}

function aiCardTransform(
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

function isCaptureTool(tool: string) {
  return (
    tool === "capture_viewport" ||
    tool === "capture_canvas" ||
    tool === "capture_selected"
  );
}

function isCanvasRegion(value: unknown): value is CanvasRegion {
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

function isAssetItem(value: unknown): value is AssetItem {
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

function assetsFromActionResult(result: unknown): AssetItem[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(isAssetItem);
}

type OCRTextActionItem = {
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

function ocrItemsFromActionResult(result: unknown): OCRTextActionItem[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is OCRTextActionItem =>
      Boolean(item) && typeof item === "object",
  );
}

type DuplicateCardCopy = {
  sourceCardId?: string;
  cardId?: string;
};

function duplicateCardCopiesFromActionResult(result: unknown) {
  if (!result || typeof result !== "object") return [];
  const copies = (result as { copies?: unknown }).copies;
  if (!Array.isArray(copies)) return [];
  return copies.filter(
    (copy): copy is DuplicateCardCopy =>
      Boolean(copy) && typeof copy === "object",
  );
}

function isImageVariantTool(tool: string) {
  return (
    tool === "compress_image" ||
    tool === "resize_image" ||
    tool === "convert_image" ||
    tool === "mirror_image" ||
    tool === "rotate_image"
  );
}

function actionResultAssetIds(result: unknown) {
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

function stringParam(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberParam(value: unknown, fallback: number) {
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

function imageCards(cards: CanvasCard[]) {
  return cards.filter(
    (card) =>
      card.kind === "asset" ||
      card.kind === "upload" ||
      card.kind === "variant",
  );
}

function visibleImageCards(
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

function mentionPreviewForCard(
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

export function useCanvasChat(opts: {
  scanId: number | undefined;
  cards: CanvasCard[];
  selectedCardIds: string[];
  viewport: { x: number; y: number; scale: number };
  cardLayoutMetrics: CanvasCardLayoutMetrics;
  captureCanvasForAI?: () => Promise<string | undefined>;
  captureViewport: (transparent: boolean) => void | Promise<void>;
  captureCanvas: (transparent: boolean) => void | Promise<void>;
  captureSelected: (transparent: boolean) => void | Promise<void>;
  locale: string;
  chatHistory: ChatHistoryEntry[];
  prompt: string;
  mentionedCardIds: string[];
  imageOptimizationAdvice: boolean;
  t: TFunction;
  rootRef: RefObject<HTMLDivElement | null>;
  cardElementsRef: MutableRefObject<Map<string, HTMLElement>>;
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  setChatHistory: Dispatch<SetStateAction<ChatHistoryEntry[]>>;
  setAiCursor: Dispatch<SetStateAction<AICursorState>>;
  setDragPreview: Dispatch<
    SetStateAction<{ cardId: string; x: number; y: number } | null>
  >;
  setCardWidths: Dispatch<SetStateAction<Record<string, number>>>;
  setError: Dispatch<SetStateAction<string>>;
  setWorking: Dispatch<SetStateAction<WorkingState>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setMentionedCardIds: Dispatch<SetStateAction<string[]>>;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
}) {
  const {
    cards,
    selectedCardIds,
    viewport,
    cardLayoutMetrics,
    captureCanvasForAI,
    captureViewport,
    captureCanvas,
    captureSelected,
    locale,
    chatHistory,
    prompt,
    mentionedCardIds,
    imageOptimizationAdvice,
    t,
    rootRef,
    cardElementsRef,
    setCards,
    setSelectedCardIds,
    setChatHistory,
    setAiCursor,
    setDragPreview,
    setCardWidths,
    setError,
    setWorking,
    setPrompt,
    setMentionedCardIds,
    pendingAttachments,
    setPendingAttachments,
  } = opts;

  const abortRef = useRef<AbortController | null>(null);
  const toolStatusClearTimerRef = useRef<number | undefined>(undefined);

  function cancelToolStatusClear() {
    if (toolStatusClearTimerRef.current === undefined) return;
    window.clearTimeout(toolStatusClearTimerRef.current);
    toolStatusClearTimerRef.current = undefined;
  }

  function scheduleToolStatusClear() {
    cancelToolStatusClear();
    toolStatusClearTimerRef.current = window.setTimeout(() => {
      toolStatusClearTimerRef.current = undefined;
      setAiCursor(clearCanvasToolStatusCursor);
    }, TOOL_STATUS_CLEAR_DELAY_MS);
  }

  function shouldAttachCanvasImage(cardCount: number) {
    return cardCount > 0;
  }

  async function handleAsk(overrides?: {
    prompt?: string;
    selectedCardId?: string;
    cards?: CanvasCard[];
  }) {
    if (abortRef.current) return;
    const promptText = (overrides?.prompt ?? prompt).trim();
    const sentAttachments = pendingAttachments;
    if (!promptText && sentAttachments.length === 0) return;
    let canvasCards = overrides?.cards ?? cards;
    let canvasSelectedCardIds = (
      overrides?.selectedCardId ? [overrides.selectedCardId] : selectedCardIds
    ).filter((id) => canvasCards.some((card) => card.id === id));
    let canvasMentionedCardIds = mentionedCardIds.filter((id) =>
      canvasCards.some((card) => card.id === id),
    );
    cancelToolStatusClear();
    setPrompt("");
    setMentionedCardIds([]);
    setPendingAttachments([]);
    setError("");
    setWorking("ai");

    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const uploadCards =
      sentAttachments.length > 0
        ? uploadCardsFromAttachments({
            attachments: sentAttachments,
            cards: canvasCards,
            metrics: cardLayoutMetrics,
            viewport,
            containerSize,
          })
        : [];
    if (uploadCards.length > 0) {
      canvasCards = [...canvasCards, ...uploadCards];
      canvasSelectedCardIds = uploadCards.map((card) => card.id);
      canvasMentionedCardIds = [
        ...new Set([...canvasMentionedCardIds, ...canvasSelectedCardIds]),
      ];
      setCards((current) => [...current, ...uploadCards]);
      setSelectedCardIds(canvasSelectedCardIds);
      setAiCursor({
        ...focusCursorPosition(
          uploadCards[0],
          cardLayoutMetrics,
          viewport.scale,
        ),
        label: uploadCards[0].fileName,
        emoji: "image",
        status: "acting",
      });
    }
    const canvasPrimarySelectedId = canvasSelectedCardIds[0];

    const mentionPreviews = canvasMentionedCardIds
      .map((id) => canvasCards.find((card) => card.id === id))
      .map((card) => (card ? mentionPreviewForCard(card) : undefined))
      .filter((mention): mention is ChatMentionPreview => Boolean(mention));

    const abort = new AbortController();
    abortRef.current = abort;

    const messages: ChatHistoryEntry[] = [
      ...chatHistory.slice(-6),
      { role: "user", content: promptText },
    ];
    const snapshot = serializeCanvasSnapshot(
      canvasCards,
      canvasSelectedCardIds,
      viewport,
      canvasMentionedCardIds,
      cardLayoutMetrics,
    );
    let canvasImage: string | undefined;
    if (captureCanvasForAI && shouldAttachCanvasImage(canvasCards.length)) {
      try {
        canvasImage = await captureCanvasForAI();
      } catch {
        // Hidden AI-only capture failed; continue with structured canvas state.
      }
    }

    const chatMentions: ChatMentionPreview[] = [...mentionPreviews];
    if (canvasImage) {
      chatMentions.push({
        id: "canvas-snapshot",
        name: t("aiCanvas.canvasSnapshot"),
        meta: t("aiCanvas.canvasSnapshotMeta"),
        src: canvasImage,
      });
    }

    setChatHistory((prev) => [
      ...prev.slice(-9),
      {
        role: "user",
        content: promptText,
        mentions: chatMentions.length > 0 ? chatMentions : undefined,
        attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
      },
    ]);

    if (uploadCards.length > 0 && promptText === "") {
      setChatHistory((prev) => [
        ...prev.slice(-10),
        {
          role: "assistant",
          content: t("aiCanvas.addedUploadImages", {
            count: uploadCards.length,
          }),
        },
      ]);
      abortRef.current = null;
      setWorking("idle");
      return;
    }

    let assistantText = "";
    let suppressModelTextAfterOCR = false;
    const newCards: CanvasCard[] = [];
    const animationTimers: number[] = [];
    const animationStartedAt = window.performance.now();
    let latestAnimationDueAt = 0;
    let animationEndMs = 0;
    let animationCursorClosed = false;
    const queuedCaptureKeys = new Set<string>();
    let queuedCaptureCount = 0;
    const pendingVariantPreviews: Promise<void>[] = [];
    const assetCardIds = new Map<string, string>();
    for (const card of canvasCards) {
      if (card.kind === "asset") {
        assetCardIds.set(card.asset.id, card.id);
      }
    }

    function resolveCanvasCardId(rawId: string) {
      const cardId = resolveCanvasActionCardId(rawId, canvasCards);
      if (cardId !== rawId) return cardId;
      return assetCardIds.get(rawId) ?? rawId;
    }

    function addAssetCards(assets: AssetItem[]) {
      if (assets.length === 0) return;
      const addedCards: AssetCanvasCard[] = [];
      for (const asset of assets) {
        if (assetCardIds.has(asset.id)) continue;
        const pos = searchResultCardPosition({
          cards: [...canvasCards, ...addedCards],
          metrics: cardLayoutMetrics,
          index: addedCards.length,
          viewport,
          containerSize,
        });
        const card: AssetCanvasCard = {
          id: createCanvasCardId("asset"),
          kind: "asset",
          x: pos.x,
          y: pos.y,
          createdAt: nowISO(),
          asset,
        };
        addedCards.push(card);
        assetCardIds.set(asset.id, card.id);
      }
      if (addedCards.length === 0) return;
      newCards.push(...addedCards);
      canvasCards = [...canvasCards, ...addedCards];
      setCards((current) => {
        const existingAssetIds = new Set(
          current
            .filter((card): card is AssetCanvasCard => card.kind === "asset")
            .map((card) => card.asset.id),
        );
        const fresh = addedCards.filter(
          (card) => !existingAssetIds.has(card.asset.id),
        );
        return fresh.length > 0 ? [...current, ...fresh] : current;
      });
      setSelectedCardIds(addedCards.map((card) => card.id));
      setAiCursor({
        ...focusCursorPosition(
          addedCards[0],
          cardLayoutMetrics,
          viewport.scale,
        ),
        label: fileName(addedCards[0].asset.repoPath),
        emoji: "image",
        status: "acting",
      });
    }

    async function addVariantCardsFromImageTool(tool: string, result: unknown) {
      const assetIds = actionResultAssetIds(result);
      if (assetIds.length === 0) return;
      const r = result as {
        outputFormat?: unknown;
        quality?: unknown;
        maxDimensionPx?: unknown;
        flip?: unknown;
        degrees?: unknown;
        rotateDegrees?: unknown;
      };
      const isTransform = tool === "mirror_image" || tool === "rotate_image";
      for (const assetId of assetIds) {
        const sourceCard = canvasCards.find(
          (card): card is AssetCanvasCard =>
            card.kind === "asset" && card.asset.id === assetId,
        );
        if (!sourceCard) continue;
        const preview = await renderImageToolPreview({
          assetId,
          operation: tool,
          outputFormat: stringParam(r.outputFormat, isTransform ? "" : "webp"),
          quality: numberParam(r.quality, 82),
          maxDimensionPx: numberParam(r.maxDimensionPx, 1600),
          flip:
            tool === "mirror_image"
              ? stringParam(r.flip, "horizontal")
              : undefined,
          rotateDegrees:
            tool === "rotate_image"
              ? numberParam(r.rotateDegrees ?? r.degrees, 90)
              : undefined,
        });
        const position = adjacentCardPosition(sourceCard, cardLayoutMetrics, {
          index: newCards.length,
          verticalStep: 112,
        });
        const card: VariantCanvasCard = {
          id: createCanvasCardId("variant"),
          kind: "variant",
          x: position.x,
          y: position.y,
          createdAt: nowISO(),
          sourceAssetId: assetId,
          sourceName: fileName(sourceCard.asset.repoPath),
          previewUrl: previewImageUrl(preview.token),
          token: preview.token,
          inputBytes: preview.inputBytes,
          outputBytes: preview.outputBytes,
          inputFormat: preview.inputFormat,
          outputFormat: preview.outputFormat,
          width: preview.width,
          height: preview.height,
          alpha: preview.alpha,
        };
        newCards.push(card);
        canvasCards = [...canvasCards, card];
        setCards((current) => [...current, card]);
        setSelectedCardIds([card.id]);
      }
    }

    function queueTimer(fn: () => void, delay: number) {
      const timer = window.setTimeout(fn, delay);
      animationTimers.push(timer);
      latestAnimationDueAt = Math.max(
        latestAnimationDueAt,
        window.performance.now() + delay,
      );
      return timer;
    }

    function trackProjectedAnimation(delay: number, duration: number) {
      latestAnimationDueAt = Math.max(
        latestAnimationDueAt,
        window.performance.now() + delay + duration,
      );
      animationEndMs = Math.max(animationEndMs, delay + duration);
    }

    function setAnimationCursor(next: AICursorState) {
      if (animationCursorClosed) return;
      setAiCursor(next);
    }

    function simulateAICardResize(cardId: string, width: number, delay = 0) {
      const card = canvasCards.find((c) => c.id === cardId);
      if (!card) return;
      const fromWidth = cardLayoutMetrics[cardId]?.width ?? CARD_WIDTH;
      const toWidth = Math.max(200, Math.min(800, width));
      const height = cardLayoutMetrics[cardId]?.height ?? fromWidth * 0.75;
      const steps = 28;
      const stepMs = 36;
      trackProjectedAnimation(delay, (steps + 1) * stepMs);
      queueTimer(() => {
        setAnimationCursor({
          x: card.x + fromWidth,
          y: card.y + height,
          label: t("aiCanvas.resizingCard"),
          emoji: "move",
          status: "acting",
        });
        for (let i = 1; i <= steps; i++) {
          queueTimer(() => {
            const progress = i / steps;
            const eased =
              progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            const nextWidth = fromWidth + (toWidth - fromWidth) * eased;
            setCardWidths((current) => ({ ...current, [cardId]: nextWidth }));
            setAnimationCursor({
              x: card.x + nextWidth,
              y: card.y + height,
              label: t("aiCanvas.resizingCard"),
              emoji: "move",
              status: "acting",
            });
          }, i * stepMs);
        }
      }, delay);
    }

    function simulateAICardDrag(
      cardId: string,
      x: number,
      y: number,
      delay = 0,
    ) {
      const card = canvasCards.find((c) => c.id === cardId);
      if (!card) return;
      const from = { x: card.x, y: card.y };
      const to = { x, y };
      const cardWidth = cardLayoutMetrics[cardId]?.width ?? CARD_WIDTH;
      const steps = 30;
      const stepMs = 34;
      trackProjectedAnimation(delay, (steps + 1) * stepMs);
      queueTimer(() => {
        const element = cardElementsRef.current.get(cardId);
        const previousWillChange = element?.style.willChange ?? "";
        const previousZIndex = element?.style.zIndex ?? "";
        if (element) {
          element.style.willChange = "transform";
          element.style.zIndex = "1300";
          element.style.transform = aiCardTransform(
            card,
            from.x,
            from.y,
            viewport.scale,
          );
        }
        setAnimationCursor({
          x: from.x + cardWidth / 2,
          y: from.y + 18,
          label: t("aiCanvas.draggingCard"),
          emoji: "move",
          status: "acting",
        });
        if (!element) setDragPreview({ cardId, x: from.x, y: from.y });
        for (let i = 1; i <= steps; i++) {
          queueTimer(() => {
            const progress = i / steps;
            const eased =
              progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            const next = {
              x: from.x + (to.x - from.x) * eased,
              y: from.y + (to.y - from.y) * eased,
            };
            setAnimationCursor({
              x: next.x + cardWidth / 2,
              y: next.y + 18,
              label: t("aiCanvas.draggingCard"),
              emoji: "move",
              status: "acting",
            });
            if (element) {
              element.style.transform = aiCardTransform(
                card,
                next.x,
                next.y,
                viewport.scale,
              );
            } else {
              setDragPreview({ cardId, x: next.x, y: next.y });
            }
          }, i * stepMs);
        }
        queueTimer(
          () => {
            if (element) {
              element.style.transform = aiCardTransform(
                card,
                x,
                y,
                viewport.scale,
              );
              element.style.willChange = previousWillChange;
              element.style.zIndex = previousZIndex;
            }
            setCards((cur) =>
              cur.map((c) => (c.id === cardId ? { ...c, x, y } : c)),
            );
            setDragPreview(null);
          },
          (steps + 1) * stepMs,
        );
      }, delay);
    }

    function runCaptureTool(tool: string, transparent: boolean) {
      const key = `${tool}:${transparent ? "transparent" : "opaque"}`;
      if (queuedCaptureKeys.has(key)) return;
      queuedCaptureKeys.add(key);
      const delay = canvasCaptureQueueDelay(
        Math.max(0, animationEndMs + 120),
        queuedCaptureCount,
      );
      queuedCaptureCount += 1;
      queueTimer(() => {
        if (tool === "capture_viewport") void captureViewport(transparent);
        if (tool === "capture_canvas") void captureCanvas(transparent);
        if (tool === "capture_selected") void captureSelected(transparent);
      }, delay);
    }

    function addGeneratedImageCard(
      event: Extract<CanvasChatEvent, { type: "generated_image" }>,
    ) {
      if (!event.token || !event.thumbnailDataUrl) return;
      const anchor =
        canvasCards.find((card) => card.id === canvasPrimarySelectedId) ??
        canvasCards.at(-1);
      const rect = rootRef.current?.getBoundingClientRect();
      const containerSize = rect
        ? { width: rect.width, height: rect.height }
        : undefined;
      const position = anchor
        ? adjacentCardPosition(anchor, cardLayoutMetrics, {
            index: newCards.length,
            verticalStep: 112,
          })
        : nextCardPosition(
            canvasCards.length + newCards.length,
            viewport,
            containerSize,
          );
      const card: UploadCanvasCard = {
        id: createCanvasCardId("upload"),
        kind: "upload",
        x: position.x,
        y: position.y,
        createdAt: nowISO(),
        token: event.token,
        thumbnailDataUrl: event.thumbnailDataUrl,
        fileName: event.fileName,
        uploadWidth: event.width,
        uploadHeight: event.height,
      };
      newCards.push(card);
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
      setAiCursor({
        ...focusCursorPosition(card, cardLayoutMetrics, viewport.scale),
        label: event.fileName,
        emoji: "image",
        status: "acting",
      });
    }

    function duplicateCardsFromResult(result: unknown) {
      const copies = duplicateCardCopiesFromActionResult(result);
      if (copies.length === 0) return;
      const positions = duplicateCardPositionsFromActionResult(result);
      const layout = (result as { layout?: unknown }).layout;
      const walking =
        typeof layout === "string" && /walk|walking/i.test(layout);
      const perSourceIndex = new Map<string, number>();
      const created: Array<
        AssetCanvasCard | UploadCanvasCard | VariantCanvasCard
      > = [];
      const nextWidths: Record<string, number> = {};
      for (const copy of copies) {
        if (!copy.sourceCardId || !copy.cardId) continue;
        const source = canvasCards.find(
          (card) => card.id === copy.sourceCardId,
        );
        if (
          !source ||
          (source.kind !== "asset" &&
            source.kind !== "upload" &&
            source.kind !== "variant")
        ) {
          continue;
        }
        const index = perSourceIndex.get(source.id) ?? 0;
        perSourceIndex.set(source.id, index + 1);
        const sourceWidth = cardLayoutMetrics[source.id]?.width ?? CARD_WIDTH;
        const stepX = walking ? Math.max(108, sourceWidth * 0.46) : 36;
        const stepY = walking ? (index % 2 === 0 ? 18 : -12) : 36;
        const position = positions.get(copy.cardId);
        const base = {
          ...source,
          id: copy.cardId,
          x: position?.x ?? source.x + (index + 1) * stepX,
          y: position?.y ?? source.y + (index + 1) * stepY,
          createdAt: nowISO(),
        };
        if (source.kind === "asset") created.push(base as AssetCanvasCard);
        if (source.kind === "upload") created.push(base as UploadCanvasCard);
        if (source.kind === "variant") created.push(base as VariantCanvasCard);
        if (sourceWidth) {
          nextWidths[copy.cardId] = sourceWidth;
        }
      }
      if (created.length === 0) return;
      newCards.push(...created);
      setCards((current) => [...current, ...created]);
      setSelectedCardIds(created.map((card) => card.id));
      if (Object.keys(nextWidths).length > 0) {
        setCardWidths((current) => ({ ...current, ...nextWidths }));
      }
      const createdIds = new Set(created.map((card) => card.id));
      let sourceMoveDelay = 0;
      for (const [cardId, position] of positions) {
        if (createdIds.has(cardId)) continue;
        if (!canvasCards.some((card) => card.id === cardId)) continue;
        simulateAICardDrag(cardId, position.x, position.y, sourceMoveDelay);
        sourceMoveDelay += 220;
      }
      const first = created[0];
      setAiCursor({
        ...focusCursorPosition(first, cardLayoutMetrics, viewport.scale),
        label: t("aiCanvas.duplicatedImages", { count: created.length }),
        emoji: "duplicate",
        status: "acting",
      });
    }

    function cardBox(card: CanvasCard) {
      const width = cardLayoutMetrics[card.id]?.width ?? CARD_WIDTH;
      const height = cardLayoutMetrics[card.id]?.height ?? width * 0.75;
      return {
        id: card.id,
        x: card.x,
        y: card.y,
        width,
        height,
        right: card.x + width,
        bottom: card.y + height,
        cx: card.x + width / 2,
        cy: card.y + height / 2,
      };
    }

    function runAlignTool(result: unknown) {
      const ids = canvasActionResultCardIds(result, canvasCards);
      if (ids.length < 2) return;
      const axis = (result as { axis?: string }).axis;
      const boxes = ids
        .map((id) => canvasCards.find((card) => card.id === id))
        .filter((card): card is CanvasCard => Boolean(card))
        .map(cardBox);
      const target =
        axis === "right"
          ? Math.max(...boxes.map((box) => box.right))
          : axis === "center"
            ? boxes.reduce((sum, box) => sum + box.cx, 0) / boxes.length
            : axis === "bottom"
              ? Math.max(...boxes.map((box) => box.bottom))
              : axis === "middle"
                ? boxes.reduce((sum, box) => sum + box.cy, 0) / boxes.length
                : axis === "top"
                  ? Math.min(...boxes.map((box) => box.y))
                  : Math.min(...boxes.map((box) => box.x));
      let delay = 0;
      for (const box of boxes) {
        const x =
          axis === "right"
            ? target - box.width
            : axis === "center"
              ? target - box.width / 2
              : axis === "left"
                ? target
                : box.x;
        const y =
          axis === "bottom"
            ? target - box.height
            : axis === "middle"
              ? target - box.height / 2
              : axis === "top"
                ? target
                : box.y;
        simulateAICardDrag(box.id, x, y, delay);
        delay += 220;
      }
    }

    function runDistributeTool(result: unknown) {
      const ids = canvasActionResultCardIds(result, canvasCards);
      if (ids.length < 3) return;
      const direction = (result as { direction?: string }).direction;
      const rawGap = (result as { gap?: unknown }).gap;
      const gap =
        typeof rawGap === "number" && Number.isFinite(rawGap)
          ? Math.max(0, rawGap)
          : undefined;
      const boxes = ids
        .map((id) => canvasCards.find((card) => card.id === id))
        .filter((card): card is CanvasCard => Boolean(card))
        .map(cardBox)
        .sort((a, b) => (direction === "vertical" ? a.y - b.y : a.x - b.x));
      if (direction === "vertical") {
        const top = Math.min(...boxes.map((box) => box.y));
        const bottom = Math.max(...boxes.map((box) => box.bottom));
        const totalHeight = boxes.reduce((sum, box) => sum + box.height, 0);
        const resolvedGap =
          gap ?? Math.max(0, (bottom - top - totalHeight) / (boxes.length - 1));
        let y = top;
        boxes.forEach((box, index) => {
          simulateAICardDrag(box.id, box.x, y, index * 220);
          y += box.height + resolvedGap;
        });
        return;
      }
      const left = Math.min(...boxes.map((box) => box.x));
      const right = Math.max(...boxes.map((box) => box.right));
      const totalWidth = boxes.reduce((sum, box) => sum + box.width, 0);
      const resolvedGap =
        gap ?? Math.max(0, (right - left - totalWidth) / (boxes.length - 1));
      let x = left;
      boxes.forEach((box, index) => {
        simulateAICardDrag(box.id, x, box.y, index * 220);
        x += box.width + resolvedGap;
      });
    }

    function handleEvent(event: CanvasChatEvent) {
      if (event.type === "focus" && event.cardId) {
        cancelToolStatusClear();
        const target = canvasFocusCardFromEvent(event, canvasCards);
        if (target) {
          setAiCursor({
            ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
            label: t("aiCanvas.currentTarget"),
            emoji: "select",
            status: "acting",
          });
        }
      }
      if (event.type === "focus" && !event.cardId) {
        cancelToolStatusClear();
        setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
      }
      if (event.type === "thinking") {
        cancelToolStatusClear();
        setAiCursor((prev) => ({ ...prev, status: "thinking" }));
      }
      if (event.type === "status") {
        cancelToolStatusClear();
        setAiCursor((prev) => ({
          ...prev,
          label: canvasStatusCursorLabel(event.phase, t),
          emoji: event.phase === "planning" ? "thinking" : "move",
          status: canvasStatusCursorStatus(event.phase),
        }));
      }
      if (event.type === "text") {
        if (suppressModelTextAfterOCR) return;
        const text = sanitizeCanvasChatContent(event.content);
        if (text) {
          assistantText += (assistantText ? "\n\n" : "") + text;
        }
      }
      if (event.type === "proposal") {
        if (isCaptureTool(event.tool)) {
          runCaptureTool(event.tool, event.params.transparent === true);
          return;
        }
        const card = canvasProposalCardFromEvent(event, {
          cards: canvasCards,
          selectedCardId: canvasPrimarySelectedId,
          cardLayoutMetrics,
          index: newCards.length,
        });
        newCards.push(card);
        setCards((current) => [...current, card]);
      }
      if (event.type === "generated_image") {
        addGeneratedImageCard(event);
      }
      if (event.type === "action_result" && event.tool === "select_cards") {
        const ids = canvasActionResultCardIds(event.result, canvasCards);
        if (ids.length > 0) {
          setSelectedCardIds(ids);
          const target = canvasCards.find((c) => c.id === ids[0]);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label: t("aiCanvas.selectedAssets", { count: ids.length }),
              emoji: "select",
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "remove_cards") {
        const result = event.result as { cardIds?: unknown };
        const ids = Array.isArray(result.cardIds)
          ? result.cardIds.filter(
              (id): id is string =>
                typeof id === "string" && canvasCards.some((c) => c.id === id),
            )
          : [];
        if (ids.length > 0) {
          const removeSet = new Set(ids);
          setCards((current) =>
            current.filter((card) => !removeSet.has(card.id)),
          );
          setSelectedCardIds((current) =>
            current.filter((id) => !removeSet.has(id)),
          );
          const target = canvasCards.find((c) => c.id === ids[0]);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label: t("aiCanvas.removedCards", { count: ids.length }),
              emoji: "remove",
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "duplicate_cards") {
        duplicateCardsFromResult(event.result);
      }
      if (event.type === "action_result" && isImageVariantTool(event.tool)) {
        pendingVariantPreviews.push(
          addVariantCardsFromImageTool(event.tool, event.result).catch(
            (err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : t("aiCanvas.operationError"),
              );
            },
          ),
        );
      }
      if (event.type === "action_result" && event.tool === "focus_card") {
        const result = event.result as { cardId?: string };
        if (result?.cardId) {
          const target = canvasCards.find((c) => c.id === result.cardId);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label: t("aiCanvas.currentTarget"),
              emoji: "select",
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "create_comment") {
        const r = event.result as {
          anchorCardId?: string;
          text?: string;
          region?: { x: number; y: number; width: number; height: number };
        };
        if (r?.anchorCardId && r?.text) {
          const anchorCardId = resolveCanvasCardId(r.anchorCardId);
          const anchor = canvasCards.find((c) => c.id === anchorCardId);
          const position = anchor
            ? adjacentCardPosition(anchor, cardLayoutMetrics, {
                index: newCards.length,
                verticalStep: 88,
              })
            : { x: 84, y: 72 + newCards.length * 88 };
          const card: CommentCanvasCard = {
            id: createCanvasCardId("comment"),
            kind: "comment",
            x: position.x,
            y: position.y,
            createdAt: nowISO(),
            anchorId: anchorCardId,
            text: r.text,
            region: r.region ?? { x: 0, y: 0, width: 1, height: 1 },
            isAi: true,
          };
          newCards.push(card);
          setCards((current) => [...current, card]);
          if (anchor) {
            setAiCursor({
              ...focusCursorPosition(anchor, cardLayoutMetrics, viewport.scale),
              label: t("aiCanvas.addedComment"),
              emoji: "comment",
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "update_comment") {
        const r = event.result as {
          commentCardId?: string;
          text?: string;
          region?: unknown;
        };
        const region = isCanvasRegion(r?.region) ? r.region : undefined;
        const hasText = typeof r?.text === "string";
        if (r?.commentCardId && (hasText || region)) {
          setCards((current) =>
            current.map((card) =>
              card.kind === "comment" && card.id === r.commentCardId
                ? {
                    ...card,
                    ...(hasText ? { text: r.text ?? "" } : {}),
                    ...(region ? { region } : {}),
                  }
                : card,
            ),
          );
        }
      }
      if (event.type === "action_result" && event.tool === "delete_comment") {
        const r = event.result as { commentCardId?: string };
        if (r?.commentCardId) {
          setCards((current) =>
            current.filter((card) => card.id !== r.commentCardId),
          );
        }
      }
      if (event.type === "action_result" && event.tool === "move_card") {
        const r = event.result as {
          cardId?: string;
          x?: number;
          y?: number;
        };
        if (r?.cardId && typeof r.x === "number" && typeof r.y === "number") {
          simulateAICardDrag(r.cardId, r.x, r.y);
        }
      }
      if (
        event.type === "action_result" &&
        event.tool === "bring_cards_to_front"
      ) {
        const r = event.result as {
          cardIds?: unknown;
          afterCardId?: unknown;
          label?: string;
        };
        const ids = Array.isArray(r.cardIds)
          ? r.cardIds.filter(
              (id): id is string =>
                typeof id === "string" && canvasCards.some((c) => c.id === id),
            )
          : [];
        const afterCardId =
          typeof r.afterCardId === "string" ? r.afterCardId : undefined;
        if (ids.length > 0) {
          setCards((current) => {
            const moving = current.filter((card) => ids.includes(card.id));
            const rest = current.filter((card) => !ids.includes(card.id));
            if (!afterCardId) return [...rest, ...moving];
            const targetIndex = rest.findIndex(
              (card) => card.id === afterCardId,
            );
            if (targetIndex < 0) return [...rest, ...moving];
            return [
              ...rest.slice(0, targetIndex + 1),
              ...moving,
              ...rest.slice(targetIndex + 1),
            ];
          });
          const target = canvasCards.find((c) => c.id === ids[0]);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label: t("aiCanvas.layerChanged"),
              emoji: "layer",
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "resize_card") {
        const r = event.result as {
          cardId?: string;
          width?: number;
        };
        if (
          r?.cardId &&
          typeof r.width === "number" &&
          Number.isFinite(r.width)
        ) {
          simulateAICardResize(r.cardId, r.width);
        }
      }
      if (
        event.type === "action_result" &&
        (event.tool === "capture_viewport" ||
          event.tool === "capture_canvas" ||
          event.tool === "capture_selected")
      ) {
        const r = event.result as { transparent?: boolean };
        runCaptureTool(event.tool, r?.transparent === true);
      }
      if (event.type === "action_result" && event.tool === "arrange_cards") {
        const r = event.result as {
          positions?: Array<{ cardId?: string; x?: number; y?: number }>;
        };
        if (r?.positions?.length) {
          const posMap = new Map<string, { x: number; y: number }>();
          for (const p of r.positions) {
            if (
              typeof p.cardId !== "string" ||
              typeof p.x !== "number" ||
              typeof p.y !== "number"
            ) {
              continue;
            }
            const cardId = resolveCanvasCardId(p.cardId);
            if (!canvasCards.some((card) => card.id === cardId)) continue;
            posMap.set(cardId, { x: p.x, y: p.y });
          }
          let delay = 0;
          for (const [cardId, pos] of posMap) {
            simulateAICardDrag(cardId, pos.x, pos.y, delay);
            delay += 1100;
          }
        }
      }
      if (event.type === "action_result" && event.tool === "align_cards") {
        runAlignTool(event.result);
      }
      if (event.type === "action_result" && event.tool === "distribute_cards") {
        runDistributeTool(event.result);
      }
      if (
        event.type === "action_result" &&
        canvasActionResultCreatesAssetCards(event.tool)
      ) {
        const assets = assetsFromActionResult(event.result);
        if (assets.length) {
          addAssetCards(assets);
        }
      }
      if (event.type === "action_result" && event.tool === "extract_ocr_text") {
        suppressModelTextAfterOCR = true;
        const text = formatOCRActionText(event.result, t);
        if (text) {
          assistantText += (assistantText ? "\n\n" : "") + text;
        }
        const ocrItems = ocrItemsFromActionResult(event.result);
        const readyByAssetId = new Map(
          ocrItems
            .filter((item) => item.assetId && item.status === "ready")
            .map((item) => [item.assetId as string, item]),
        );
        if (readyByAssetId.size > 0) {
          setCards((current) =>
            current.map((card) => {
              if (card.kind !== "asset") return card;
              const item = readyByAssetId.get(card.asset.id);
              if (!item) return card;
              return {
                ...card,
                asset: {
                  ...card.asset,
                  ocr: {
                    ...(card.asset.ocr ?? {}),
                    status: "ready",
                    engineName: "vlm",
                    mode: "vlm",
                    text: item.text ?? "",
                    languages: item.languages ?? [],
                  },
                },
              };
            }),
          );
        }
      }
      if (event.type === "action_result") {
        scheduleToolStatusClear();
      }
    }

    try {
      await canvasChat({
        messages,
        canvas: snapshot,
        locale,
        options: { imageOptimizationAdvice },
        canvasImage,
        attachmentTokens:
          sentAttachments.length > 0
            ? sentAttachments.map((a) => a.token)
            : undefined,
        onEvent: handleEvent,
        signal: abort.signal,
      });

      if (pendingVariantPreviews.length > 0) {
        await Promise.allSettled(pendingVariantPreviews);
      }

      assistantText = sanitizeCanvasChatContent(assistantText);
      if (assistantText) {
        setChatHistory((prev) => [
          ...prev.slice(-10),
          { role: "assistant", content: assistantText },
        ]);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : t("aiCanvas.operationError"),
        );
      }
    } finally {
      const settleDelay = canvasAnimationSettleDelay({
        latestAnimationDueAt,
        animationStartedAt,
        animationEndMs,
        now: window.performance.now(),
      });
      if (settleDelay > 0) {
        setWorking("aiApplying");
      }
      window.setTimeout(() => {
        cancelToolStatusClear();
        animationCursorClosed = true;
        setWorking("idle");
        setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
        setDragPreview(null);
        abortRef.current = null;
      }, settleDelay);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return { handleAsk, handleStop };
}

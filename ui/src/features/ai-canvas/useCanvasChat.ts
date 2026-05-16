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
  type ChatActivityEntry,
  type ChatHistoryEntry,
  type ChatMentionPreview,
  type ChatRunUsage,
  type GroupCanvasCard,
  type GroupChildCanvasCard,
  type PendingAttachment,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import {
  CARD_WIDTH,
  adjacentCardPosition,
  compactImageAspectRatio,
  nextCardPosition,
  nowISO,
} from "./canvasUtils";
import { canvasActionResultCardIds } from "./canvasChatEventContract";
import {
  dispatchCanvasChatEvent,
  type ChatEventMutableState,
} from "./canvasChatEventDispatch";
import {
  CHAT_ACTIVITY_LIMIT,
  TOOL_STATUS_CLEAR_DELAY_MS,
  actionResultAssetIds,
  aiCardTransform,
  canvasAnimationSettleDelay,
  canvasCaptureQueueDelay,
  canvasRunUsageFromDone,
  clearCanvasToolStatusCursor,
  duplicateCardCopiesFromActionResult,
  duplicateCardPositionsFromActionResult,
  focusCursorPosition,
  mentionPreviewForCard,
  numberParam,
  resizeCursorPosition,
  resolveCanvasActionCardId,
  searchResultCardPosition,
  stringParam,
  uploadCardsFromAttachments,
  type AICursorState,
} from "./canvasChatHelpers";
import type { WorkingState } from "./aiCanvasTypes";

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
  preparedSkillIds?: string[];
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
  setPreparedSkillIds?: Dispatch<SetStateAction<string[]>>;
  setMentionedCardIds: Dispatch<SetStateAction<string[]>>;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  onChatRunStart?: () => void;
  setActiveChatActivity?: Dispatch<SetStateAction<ChatActivityEntry[]>>;
  setActiveChatUsage?: Dispatch<SetStateAction<ChatRunUsage | undefined>>;
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
    preparedSkillIds = [],
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
    setPreparedSkillIds,
    setMentionedCardIds,
    pendingAttachments,
    setPendingAttachments,
    onChatRunStart,
    setActiveChatActivity,
    setActiveChatUsage,
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
    selectedSkillIds?: string[];
  }) {
    if (abortRef.current) return;
    const promptText = (overrides?.prompt ?? prompt).trim();
    const sentSelectedSkillIds = overrides
      ? (overrides.selectedSkillIds ?? [])
      : preparedSkillIds;
    const sentAttachments = pendingAttachments;
    if (!promptText && sentAttachments.length === 0) return;
    let canvasCards = overrides?.cards ?? cards;
    let canvasSelectedCardIds = (
      overrides?.selectedCardId ? [overrides.selectedCardId] : selectedCardIds
    ).filter((id) => canvasCards.some((card) => card.id === id));
    let canvasMentionedCardIds = mentionedCardIds.filter((id) =>
      canvasCards.some((card) => card.id === id),
    );
    onChatRunStart?.();
    cancelToolStatusClear();
    setPrompt("");
    setPreparedSkillIds?.([]);
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

    const assistantMentionById = new Map<string, ChatMentionPreview>();
    const pendingVariantPreviews: Promise<void>[] = [];
    const newCards: CanvasCard[] = [];
    let activitySequence = 0;
    const activityStartedAt = window.performance.now();
    const activityEntries: ChatActivityEntry[] = [];
    const animationTimers: number[] = [];
    const animationStartedAt = window.performance.now();
    let latestAnimationDueAt = 0;
    let animationEndMs = 0;
    let animationCursorClosed = false;
    const queuedCaptureKeys = new Set<string>();
    let queuedCaptureCount = 0;
    const assetCardIds = new Map<string, string>();
    for (const card of canvasCards) {
      if (card.kind === "asset") {
        assetCardIds.set(card.asset.id, card.id);
      }
    }

    function syncActiveActivity() {
      setActiveChatActivity?.(activityEntries.slice(-CHAT_ACTIVITY_LIMIT));
    }

    function pushChatActivity(
      entry: Omit<ChatActivityEntry, "id" | "atMs"> & { atMs?: number },
    ) {
      const next: ChatActivityEntry = {
        ...entry,
        id: `activity-${activitySequence}`,
        atMs:
          entry.atMs ??
          Math.max(0, Math.round(window.performance.now() - activityStartedAt)),
      };
      activitySequence += 1;
      const last = activityEntries.at(-1);
      if (
        last &&
        last.kind === next.kind &&
        last.label === next.label &&
        last.detail === next.detail
      ) {
        activityEntries[activityEntries.length - 1] = {
          ...last,
          atMs: next.atMs,
        };
      } else {
        activityEntries.push(next);
        if (activityEntries.length > CHAT_ACTIVITY_LIMIT) {
          activityEntries.splice(
            0,
            activityEntries.length - CHAT_ACTIVITY_LIMIT,
          );
        }
      }
      syncActiveActivity();
    }

    function compactActivityDetail(value: string | undefined) {
      if (!value) return undefined;
      const trimmed = value.replace(/\s+/g, " ").trim();
      return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed;
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
          allCards: [...canvasCards, ...newCards],
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
          ...resizeCursorPosition(
            card,
            { ...cardLayoutMetrics, [cardId]: { width: fromWidth, height } },
            viewport.scale,
            fromWidth,
          ),
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
              ...resizeCursorPosition(
                card,
                {
                  ...cardLayoutMetrics,
                  [cardId]: { width: fromWidth, height },
                },
                viewport.scale,
                nextWidth,
              ),
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
            allCards: [...canvasCards, ...newCards],
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

    function groupCardsFromResult(result: unknown) {
      const r = result as {
        cardIds?: unknown;
        groupId?: unknown;
        name?: unknown;
      };
      const ids = Array.isArray(r.cardIds)
        ? r.cardIds.filter(
            (id): id is string =>
              typeof id === "string" &&
              canvasCards.some((card) => card.id === id),
          )
        : [];
      const groupableCards = ids
        .map((id) => canvasCards.find((card) => card.id === id))
        .filter(
          (card): card is GroupChildCanvasCard =>
            card?.kind === "asset" ||
            card?.kind === "upload" ||
            card?.kind === "variant",
        );
      if (groupableCards.length < 2) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const childWidths: Record<string, number> = {};
      for (const card of groupableCards) {
        const width = cardLayoutMetrics[card.id]?.width ?? CARD_WIDTH;
        const height =
          cardLayoutMetrics[card.id]?.height ??
          width / compactImageAspectRatio(card);
        childWidths[card.id] = width;
        minX = Math.min(minX, card.x);
        minY = Math.min(minY, card.y);
        maxX = Math.max(maxX, card.x + width);
        maxY = Math.max(maxY, card.y + height);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

      const groupId =
        typeof r.groupId === "string" ? r.groupId : createCanvasCardId("group");
      const group: GroupCanvasCard = {
        id: groupId,
        kind: "group",
        name:
          typeof r.name === "string" && r.name.trim()
            ? r.name.trim()
            : undefined,
        x: minX,
        y: minY,
        createdAt: nowISO(),
        cards: groupableCards.map((card) => ({
          ...card,
          x: card.x - minX,
          y: card.y - minY,
        })),
        cardWidths: childWidths,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
      const removeSet = new Set(groupableCards.map((card) => card.id));
      canvasCards = [
        ...canvasCards.filter((card) => !removeSet.has(card.id)),
        group,
      ];
      newCards.push(group);
      setCards((current) => [
        ...current.filter((card) => !removeSet.has(card.id)),
        group,
      ]);
      setCardWidths((current) => {
        const next = { ...current, [group.id]: group.width };
        for (const id of removeSet) delete next[id];
        return next;
      });
      setSelectedCardIds([group.id]);
      setAiCursor({
        ...focusCursorPosition(
          group,
          {
            ...cardLayoutMetrics,
            [group.id]: { width: group.width, height: group.height },
          },
          viewport.scale,
        ),
        label:
          group.name || t("aiCanvas.groupLabel", { count: group.cards.length }),
        emoji: "layer",
        status: "acting",
      });
    }

    function ungroupCardFromResult(result: unknown) {
      const r = result as { cardId?: unknown };
      if (typeof r.cardId !== "string") return;
      const group = canvasCards.find(
        (card): card is GroupCanvasCard =>
          card.kind === "group" && card.id === r.cardId,
      );
      if (!group) return;
      const renderedWidth = cardLayoutMetrics[group.id]?.width ?? group.width;
      const scale = group.width > 0 ? renderedWidth / group.width : 1;
      const childWidths = group.cardWidths ?? {};
      const restoredCards = group.cards.map((card) => ({
        ...card,
        x: group.x + card.x * scale,
        y: group.y + card.y * scale,
      }));
      canvasCards = canvasCards.flatMap((card) =>
        card.id === group.id ? restoredCards : [card],
      );
      setCards((current) =>
        current.flatMap((card) =>
          card.id === group.id ? restoredCards : [card],
        ),
      );
      setCardWidths((current) => {
        const next = { ...current };
        delete next[group.id];
        for (const card of group.cards) {
          const width = childWidths[card.id];
          if (width) next[card.id] = width * scale;
        }
        return next;
      });
      setSelectedCardIds(group.cards.map((card) => card.id));
    }

    function renameGroupFromResult(result: unknown) {
      const r = result as { cardId?: unknown; name?: unknown };
      if (typeof r.cardId !== "string" || typeof r.name !== "string") return;
      const name = r.name.trim();
      if (!name) return;
      canvasCards = canvasCards.map((card) =>
        card.kind === "group" && card.id === r.cardId
          ? { ...card, name }
          : card,
      );
      setCards((current) =>
        current.map((card) =>
          card.kind === "group" && card.id === r.cardId
            ? { ...card, name }
            : card,
        ),
      );
      setSelectedCardIds([r.cardId]);
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

    const eventState: ChatEventMutableState = {
      assistantText: "",
      suppressModelTextAfterOCR: false,
      searchConfirmationNeeded: false,
      runUsage: undefined,
      newCards,
      assistantMentionById,
      pendingVariantPreviews,
    };

    function handleEvent(event: CanvasChatEvent) {
      dispatchCanvasChatEvent(event, {
        state: eventState,
        canvasCards,
        canvasPrimarySelectedId,
        cardLayoutMetrics,
        viewportScale: viewport.scale,
        cancelToolStatusClear,
        scheduleToolStatusClear,
        pushChatActivity,
        compactActivityDetail,
        resolveCanvasCardId,
        simulateAICardDrag,
        simulateAICardResize,
        runCaptureTool,
        addGeneratedImageCard,
        groupCardsFromResult,
        ungroupCardFromResult,
        renameGroupFromResult,
        duplicateCardsFromResult,
        addAssetCards,
        addVariantCardsFromImageTool,
        runAlignTool,
        runDistributeTool,
        setAiCursor,
        setCards,
        setSelectedCardIds,
        setActiveChatUsage,
        setError,
        t,
      });
    }

    try {
      const done = await canvasChat({
        messages,
        canvas: snapshot,
        locale,
        options: { imageOptimizationAdvice },
        selectedSkillIds:
          sentSelectedSkillIds.length > 0 ? sentSelectedSkillIds : undefined,
        canvasImage,
        attachmentTokens:
          sentAttachments.length > 0
            ? sentAttachments.map((a) => a.token)
            : undefined,
        onEvent: handleEvent,
        signal: abort.signal,
      });
      if (done && !eventState.runUsage) {
        eventState.runUsage = canvasRunUsageFromDone(done);
        setActiveChatUsage?.(eventState.runUsage);
      }

      if (eventState.pendingVariantPreviews.length > 0) {
        await Promise.allSettled(eventState.pendingVariantPreviews);
      }

      let assistantText = sanitizeCanvasChatContent(eventState.assistantText);
      const assistantMentions = Array.from(
        eventState.assistantMentionById.values(),
      );
      if (eventState.searchConfirmationNeeded) {
        const notice = t("aiCanvas.searchNeedsConfirmation", {
          count: assistantMentions.length,
        });
        assistantText = sanitizeCanvasChatContent(
          assistantText ? `${notice}\n\n${assistantText}` : notice,
        );
      }
      const activity = activityEntries.slice(-CHAT_ACTIVITY_LIMIT);
      if (
        assistantText ||
        assistantMentions.length > 0 ||
        activity.length > 0 ||
        eventState.runUsage
      ) {
        setChatHistory((prev) => [
          ...prev.slice(-10),
          {
            role: "assistant",
            content: assistantText,
            mentions:
              assistantMentions.length > 0 ? assistantMentions : undefined,
            activity: activity.length > 0 ? activity : undefined,
            usage: eventState.runUsage,
          },
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

import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRef } from "react";
import type { TFunction } from "i18next";
import { getCatalogItems } from "@/api";
import {
  canvasChat,
  serializeCanvasSnapshot,
  type CanvasCardLayoutMetrics,
  type CanvasChatEvent,
} from "@/api/canvasChat";
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
  type ProposalCanvasCard,
} from "./aiCanvasState";
import { CARD_WIDTH, imageMeta, nextCardPosition, nowISO } from "./canvasUtils";

type AICursorState = {
  x: number;
  y: number;
  label?: string;
  status: "thinking" | "acting" | "idle";
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

function isScreenStableCard(card: CanvasCard) {
  return (
    card.kind === "comment" ||
    card.kind === "assistant" ||
    card.kind === "proposal" ||
    card.kind === "operation"
  );
}

function focusCursorPosition(
  card: CanvasCard,
  metrics: CanvasCardLayoutMetrics,
  viewportScale: number,
): Pick<AICursorState, "x" | "y"> {
  const stableScale =
    isScreenStableCard(card) && viewportScale > 0 ? 1 / viewportScale : 1;
  const width = metrics[card.id]?.width ?? CARD_WIDTH * stableScale;
  const pointerXOffset = viewportScale > 0 ? 6 / viewportScale : 6;
  const pointerYOffset = viewportScale > 0 ? 8 / viewportScale : 8;
  return {
    x: card.x + width / 2 - pointerXOffset,
    y: card.y - pointerYOffset,
  };
}

function isCaptureTool(tool: string) {
  return (
    tool === "capture_viewport" ||
    tool === "capture_canvas" ||
    tool === "capture_selected"
  );
}

function requestedSearchCardLimit(promptText: string): number | undefined {
  if (
    /多張|多個|一些|幾張|全部|所有|several|multiple|many|all/i.test(promptText)
  ) {
    return undefined;
  }
  if (
    /(一張|1\s*張|一個|1\s*個|one|single|a\s+(new\s+)?image)/i.test(promptText)
  ) {
    return 1;
  }
  return undefined;
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
}) {
  const {
    scanId,
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
  } = opts;

  const abortRef = useRef<AbortController | null>(null);
  const searchResultsRef = useRef<Array<{ id: string; repoPath: string }>>([]);

  function shouldAttachCanvasImage(promptText: string, selectedCount: number) {
    return (
      selectedCount >= 2 ||
      /排版|擺放|布局|佈局|合照|散開|分散|靠近|對齊|移動|拖|放大|縮小|縮放|拍照|截圖|layout|arrange|spread|align|move|drag|resize/i.test(
        promptText,
      )
    );
  }

  async function handleAsk(overrides?: {
    prompt?: string;
    selectedCardId?: string;
    cards?: CanvasCard[];
  }) {
    if (abortRef.current) return;
    const promptText = (overrides?.prompt ?? prompt).trim();
    if (!promptText) return;
    const canvasCards = overrides?.cards ?? cards;
    const canvasSelectedCardIds = (
      overrides?.selectedCardId ? [overrides.selectedCardId] : selectedCardIds
    ).filter((id) => canvasCards.some((card) => card.id === id));
    const canvasPrimarySelectedId = canvasSelectedCardIds[0];
    const canvasMentionedCardIds = mentionedCardIds.filter((id) =>
      canvasCards.some((card) => card.id === id),
    );
    const searchCardLimit = requestedSearchCardLimit(promptText);
    searchResultsRef.current = [];
    setPrompt("");
    setMentionedCardIds([]);
    setError("");
    setWorking("ai");

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
    if (
      captureCanvasForAI &&
      shouldAttachCanvasImage(promptText, canvasSelectedCardIds.length)
    ) {
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
      },
    ]);

    let assistantText = "";
    const newCards: CanvasCard[] = [];
    const animationTimers: number[] = [];
    let animationEndMs = 0;
    let captureQueued = false;

    function queueTimer(fn: () => void, delay: number) {
      const timer = window.setTimeout(fn, delay);
      animationTimers.push(timer);
      return timer;
    }

    function simulateAICardResize(cardId: string, width: number, delay = 0) {
      const card = canvasCards.find((c) => c.id === cardId);
      if (!card) return;
      const fromWidth = cardLayoutMetrics[cardId]?.width ?? CARD_WIDTH;
      const toWidth = Math.max(200, Math.min(800, width));
      const height = cardLayoutMetrics[cardId]?.height ?? fromWidth * 0.75;
      const steps = 28;
      const stepMs = 36;
      animationEndMs = Math.max(animationEndMs, delay + (steps + 1) * stepMs);
      queueTimer(() => {
        setAiCursor({
          x: card.x + fromWidth,
          y: card.y + height,
          label: t("aiCanvas.resizingCard"),
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
            setAiCursor({
              x: card.x + nextWidth,
              y: card.y + height,
              label: t("aiCanvas.resizingCard"),
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
      animationEndMs = Math.max(animationEndMs, delay + (steps + 1) * stepMs);
      queueTimer(() => {
        setAiCursor({
          x: from.x + cardWidth / 2,
          y: from.y + 18,
          label: t("aiCanvas.draggingCard"),
          status: "acting",
        });
        setDragPreview({ cardId, x: from.x, y: from.y });
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
            setAiCursor({
              x: next.x + cardWidth / 2,
              y: next.y + 18,
              label: t("aiCanvas.draggingCard"),
              status: "acting",
            });
            setDragPreview({ cardId, x: next.x, y: next.y });
          }, i * stepMs);
        }
        queueTimer(
          () => {
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
      if (captureQueued) return;
      captureQueued = true;
      const delay = Math.max(0, animationEndMs + 120);
      queueTimer(() => {
        if (tool === "capture_viewport") void captureViewport(transparent);
        if (tool === "capture_canvas") void captureCanvas(transparent);
        if (tool === "capture_selected") void captureSelected(transparent);
      }, delay);
    }

    function handleEvent(event: CanvasChatEvent) {
      if (event.type === "focus" && event.cardId) {
        const target = canvasCards.find((c) => c.id === event.cardId);
        if (target) {
          setAiCursor({
            ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
            label: event.label,
            status: "acting",
          });
        }
      }
      if (event.type === "focus" && !event.cardId) {
        setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
      }
      if (event.type === "thinking") {
        setAiCursor((prev) => ({ ...prev, status: "thinking" }));
      }
      if (event.type === "text") {
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
        const selectedCard = canvasCards.find(
          (c) => c.id === canvasPrimarySelectedId,
        );
        const baseX = selectedCard ? selectedCard.x - CARD_WIDTH - 36 : 84;
        const baseY = selectedCard ? selectedCard.y : 72;
        const card: ProposalCanvasCard = {
          id: createCanvasCardId("proposal"),
          kind: "proposal",
          x: baseX,
          y: baseY + newCards.length * 220,
          createdAt: nowISO(),
          proposalId: event.id,
          tool: event.tool,
          params: event.params,
          description: event.description,
          impact: event.impact,
          status: "pending",
          sourceAssetId: event.targetAssetId,
        };
        newCards.push(card);
        setCards((current) => [...current, card]);
      }
      if (event.type === "action_result" && event.tool === "select_cards") {
        const result = event.result as { cardIds?: unknown; label?: string };
        const ids = Array.isArray(result.cardIds)
          ? result.cardIds.filter(
              (id): id is string =>
                typeof id === "string" && canvasCards.some((c) => c.id === id),
            )
          : [];
        if (ids.length > 0) {
          setSelectedCardIds(ids);
          const target = canvasCards.find((c) => c.id === ids[0]);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label:
                result.label ??
                t("aiCanvas.selectedAssets", { count: ids.length }),
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "remove_cards") {
        const result = event.result as { cardIds?: unknown; label?: string };
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
              label:
                result.label ??
                t("aiCanvas.removedCards", { count: ids.length }),
              status: "acting",
            });
          }
        }
      }
      if (event.type === "action_result" && event.tool === "focus_card") {
        const result = event.result as { cardId?: string; label?: string };
        if (result?.cardId) {
          const target = canvasCards.find((c) => c.id === result.cardId);
          if (target) {
            setAiCursor({
              ...focusCursorPosition(target, cardLayoutMetrics, viewport.scale),
              label: result.label,
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
          const anchor = canvasCards.find((c) => c.id === r.anchorCardId);
          const card: CommentCanvasCard = {
            id: createCanvasCardId("comment"),
            kind: "comment",
            x: anchor ? anchor.x - CARD_WIDTH - 24 : 84,
            y: anchor ? anchor.y + 100 + newCards.length * 160 : 72,
            createdAt: nowISO(),
            anchorId: r.anchorCardId,
            text: r.text,
            region: r.region ?? { x: 0, y: 0, width: 1, height: 1 },
          };
          newCards.push(card);
          setCards((current) => [...current, card]);
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
              label: r.label || t("aiCanvas.layerChanged"),
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
          const posMap = new Map(
            r.positions
              .filter(
                (p): p is { cardId: string; x: number; y: number } =>
                  typeof p.cardId === "string" &&
                  typeof p.x === "number" &&
                  typeof p.y === "number",
              )
              .map((p) => [p.cardId, { x: p.x, y: p.y }]),
          );
          let delay = 0;
          for (const [cardId, pos] of posMap) {
            simulateAICardDrag(cardId, pos.x, pos.y, delay);
            delay += 1100;
          }
        }
      }
      if (event.type === "action_result" && event.tool === "search_assets") {
        const r = event.result as {
          q?: string;
          items?: Array<{ id: string; repoPath: string }>;
        };
        if (r?.items?.length) {
          for (const it of r.items) {
            if (
              searchCardLimit != null &&
              searchResultsRef.current.length >= searchCardLimit
            ) {
              break;
            }
            if (!searchResultsRef.current.some((s) => s.id === it.id)) {
              searchResultsRef.current.push({
                id: it.id,
                repoPath: it.repoPath,
              });
            }
          }
        }
      }
    }

    try {
      await canvasChat({
        messages,
        canvas: snapshot,
        locale,
        options: { imageOptimizationAdvice },
        canvasImage,
        onEvent: handleEvent,
        signal: abort.signal,
      });

      assistantText = sanitizeCanvasChatContent(assistantText);
      if (assistantText) {
        setChatHistory((prev) => [
          ...prev.slice(-10),
          { role: "assistant", content: assistantText },
        ]);
      }

      if (searchResultsRef.current.length > 0 && scanId) {
        try {
          const wanted =
            searchCardLimit == null
              ? [...searchResultsRef.current]
              : searchResultsRef.current.slice(0, searchCardLimit);
          searchResultsRef.current = [];
          const wantedIds = new Set(wanted.map((w) => w.id));
          const names = [
            ...new Set(
              wanted.map((w) => {
                const parts = w.repoPath.split("/");
                return parts[parts.length - 1].replace(/\.[^.]+$/, "");
              }),
            ),
          ];
          const allItems: AssetItem[] = [];
          const seenIds = new Set<string>();
          for (const name of names.slice(0, 12)) {
            const page = await getCatalogItems({
              scanId,
              q: name,
              limit: 3,
            });
            for (const item of page.items) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                allItems.push(item);
              }
            }
          }
          const matchedAssets = allItems.filter((a) => wantedIds.has(a.id));
          const rect = rootRef.current?.getBoundingClientRect();
          const containerSize = rect
            ? { width: rect.width, height: rect.height }
            : undefined;
          const addedCards: AssetCanvasCard[] = [];
          for (const asset of matchedAssets) {
            const pos = nextCardPosition(
              canvasCards.length + newCards.length + addedCards.length,
              viewport,
              containerSize,
            );
            const card: AssetCanvasCard = {
              id: createCanvasCardId("asset"),
              kind: "asset",
              x: pos.x + (addedCards.length % 3) * (CARD_WIDTH + 24),
              y: pos.y + Math.floor(addedCards.length / 3) * 420,
              createdAt: nowISO(),
              asset,
            };
            addedCards.push(card);
          }
          if (addedCards.length > 0) {
            setCards((cur) => [...cur, ...addedCards]);
          }
        } catch {
          // search result fetch failed — non-critical
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : t("aiCanvas.operationError"),
        );
      }
    } finally {
      setWorking("idle");
      const settleDelay = animationTimers.length > 0 ? 900 : 0;
      window.setTimeout(() => {
        setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
        setDragPreview(null);
      }, settleDelay);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return { handleAsk, handleStop };
}

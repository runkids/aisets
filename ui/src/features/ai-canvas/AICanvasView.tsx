import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  embeddingStats,
  getCatalogItems,
  previewImageUrl,
  semanticSearch,
} from "@/api";
import type { CanvasCardLayoutMetrics } from "@/api/canvasChat";
import { uploadCanvasImages } from "@/api/canvasChat";
import { renderImageToolPreview } from "@/api/imageTools";
import { useToast } from "@/components/shared/ToastProvider";
import { ConfirmDialog } from "@/components/ui";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  CARD_WIDTH,
  DEFAULT_IMAGE_TOOL_SETTINGS,
  commentIds,
  imageMeta,
  AI_MENTION_COMMENT_RE,
  AI_MENTION_COMMENT_RE_G,
  adjacentCardPosition,
  compactImageAspectRatio,
  isImageCard,
  nextCardPosition,
  nowISO,
  selectedAssetIds,
  zoomViewportAtPoint,
} from "./canvasUtils";
import { useCanvasCapture } from "./useCanvasCapture";
import {
  buildAssistantBullets,
  cardDisplayName,
  cardIdsForDeletion,
  clampCanvasScale,
  DEFAULT_CANVAS_VIEWPORT,
  commentsForAssets,
  createCanvasCardId,
  emptyAICanvasSession,
  readAICanvasSession,
  selectedAssetCards,
  writeAICanvasSession,
  type AICanvasSession,
  type AssetCanvasCard,
  type CanvasCard,
  type CommentCanvasCard,
  type ChatHistoryEntry,
  type ProposalCanvasCard,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import { useCanvasChat } from "./useCanvasChat";
import { useCanvasDrag } from "./useCanvasDrag";
import { useProposalExecution } from "./useProposalExecution";
import { AICanvasComposer } from "./AICanvasComposer";
import { AICanvasCapturePreview, AICanvasDebugPanel } from "./AICanvasOverlays";
import { AICanvasSearchPanel } from "./AICanvasSearchPanel";
import { AICanvasStage } from "./AICanvasStage";
import { AICanvasToolbar } from "./AICanvasToolbar";
import type { AIBackendOption, WorkingState } from "./aiCanvasTypes";

const COMPOSER_HEIGHT_STORAGE_KEY = "aisets.canvas.composerHeight";
const IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY =
  "aisets.canvas.imageOptimizationAdvice";
const DEFAULT_COMPOSER_HEIGHT = 320;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

type Props = {
  scanId?: number;
  aiEnabled: boolean;
  aiNickname?: string;
  aiBackendLabel?: string;
  aiBackendValue?: string;
  aiBackendOptions?: AIBackendOption[];
  aiBackendPending?: boolean;
  onAiBackendChange?: (value: string) => void;
  onOpenAsset?: (assetId: string) => void;
  onExitCanvas?: () => void;
};

export function AICanvasView({
  scanId,
  aiEnabled,
  aiNickname,
  aiBackendLabel,
  aiBackendValue,
  aiBackendOptions = [],
  aiBackendPending,
  onAiBackendChange,
  onOpenAsset,
  onExitCanvas,
}: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const initialSession = useMemo<AICanvasSession>(() => {
    if (typeof window === "undefined") return emptyAICanvasSession();
    return readAICanvasSession(window.sessionStorage);
  }, []);
  const [cards, setCards] = useState<CanvasCard[]>(initialSession.cards);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(
    initialSession.selectedCardIds ?? [],
  );
  const primarySelectedId = selectedCardIds[0] as string | undefined;
  const [viewport, setViewport] = useState(initialSession.viewport);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AssetItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [searchMode, setSearchMode] = useState<"catalog" | "semantic">(
    "catalog",
  );
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchSelectedIds, setSearchSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [mentionedCardIds, setMentionedCardIds] = useState<string[]>([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkingState>("idle");
  const [composerCollapsed, setComposerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("aisets.canvas.collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [composerAdvancedOpen] = useState(false);
  const [imageOptimizationAdvice, setImageOptimizationAdvice] = useState(() => {
    try {
      return (
        localStorage.getItem(IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>(
    initialSession.chatHistory ?? [],
  );
  const [aiCursor, setAiCursor] = useState<{
    x: number;
    y: number;
    label?: string;
    status: "thinking" | "acting" | "idle";
  }>(() => {
    const rect =
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 1440, height: 900 };
    return {
      x: rect.width / 2 - CARD_WIDTH / 2,
      y: rect.height / 2 - 100,
      status: "idle" as const,
    };
  });
  const [hideNonImageCards, setHideNonImageCards] = useState(
    initialSession.viewMode === "hidden",
  );
  const viewMode = hideNonImageCards ? "hidden" : "normal";
  const [cardWidths, setCardWidths] = useState<Record<string, number>>(
    initialSession.cardWidths ?? {},
  );
  const [captureTransparent, setCaptureTransparent] = useState(() => {
    try {
      return (
        localStorage.getItem("aisets.canvas.captureTransparent") === "true"
      );
    } catch {
      return false;
    }
  });
  const [commentMode, setCommentMode] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const lastToastedErrorRef = useRef("");
  const [composerHeight, setComposerHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY));
      return Number.isFinite(saved) && saved >= 200
        ? saved
        : DEFAULT_COMPOSER_HEIGHT;
    } catch {
      return DEFAULT_COMPOSER_HEIGHT;
    }
  });
  const [dragPreview, setDragPreview] = useState<{
    cardId: string;
    x: number;
    y: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const focusSearchAfterOpenRef = useRef(false);
  const searchOpenRef = useRef(searchOpen);

  useEffect(() => {
    if (!error || lastToastedErrorRef.current === error) return;
    lastToastedErrorRef.current = error;
    toast.error(error, { title: t("aiCanvas.statusError") });
  }, [error, t, toast]);

  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;
    embeddingStats()
      .then((stats) => {
        if (!cancelled) {
          setSemanticAvailable(
            (stats.textCount ?? 0) > 0 || (stats.imageCount ?? 0) > 0,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aiEnabled]);
  const {
    canvasSelection,
    cardElementsRef,
    canvasInnerRef,
    registerCardElement,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleWheel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerEnd,
  } = useCanvasDrag({
    rootRef,
    viewport,
    cards,
    selectedCardIds,
    setCards,
    setViewport,
    setSelectedCardIds,
    setDragPreview,
  });

  const {
    captureViewport,
    captureCanvas,
    captureSelected,
    captureCanvasForAI,
    isCapturing,
    preview: capturePreview,
    dismissPreview: dismissCapturePreview,
  } = useCanvasCapture({
    rootRef,
    cardElementsRef,
    scanId,
    cards,
    selectedCardIds,
    viewport,
  });

  const [cardElementSizes, setCardElementSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const registerMeasuredCardElement = useCallback(
    (cardId: string, node: HTMLElement | null) => {
      registerCardElement(cardId, node);
      if (!node) return;
      setCardElementSizes((current) => {
        const nextSize = { width: node.offsetWidth, height: node.offsetHeight };
        const previous = current[cardId];
        if (
          previous?.width === nextSize.width &&
          previous.height === nextSize.height
        ) {
          return current;
        }
        return { ...current, [cardId]: nextSize };
      });
    },
    [registerCardElement],
  );

  const cardLayoutMetrics = useMemo<CanvasCardLayoutMetrics>(() => {
    const metrics: CanvasCardLayoutMetrics = {};
    cards.forEach((card, layerIndex) => {
      const size = cardElementSizes[card.id];
      const stableScale =
        (card.kind === "comment" ||
          card.kind === "assistant" ||
          card.kind === "proposal" ||
          card.kind === "operation") &&
        viewport.scale > 0
          ? 1 / viewport.scale
          : 1;
      metrics[card.id] = {
        width: (cardWidths[card.id] ?? size?.width ?? CARD_WIDTH) * stableScale,
        height:
          (size?.height ??
            (isImageCard(card)
              ? (cardWidths[card.id] ?? CARD_WIDTH) /
                compactImageAspectRatio(card)
              : 240)) * stableScale,
        layerIndex,
      };
    });
    return metrics;
  }, [cardElementSizes, cardWidths, cards, viewport.scale]);

  const groupBounds = useMemo(() => {
    if (selectedCardIds.length <= 1) return null;
    const selected = new Set(selectedCardIds);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = 0;
    for (const card of cards) {
      if (!selected.has(card.id)) continue;
      const metrics = cardLayoutMetrics[card.id];
      const width = metrics?.width ?? CARD_WIDTH;
      const height = metrics?.height ?? 240;
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + width);
      maxY = Math.max(maxY, card.y + height);
      found++;
    }
    if (found === 0) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [cardLayoutMetrics, cards, selectedCardIds]);

  const selectedAssets = useMemo(
    () => selectedAssetCards(cards, selectedCardIds),
    [cards, selectedCardIds],
  );
  const mentionableImageCards = useMemo(
    () =>
      cards.flatMap((card) => {
        if (card.kind === "asset") {
          return [
            {
              id: card.id,
              name: fileName(card.asset.repoPath),
              meta: imageMeta(card.asset),
              src: card.asset.thumbnailUrl || card.asset.url,
            },
          ];
        }
        if (card.kind === "variant") {
          return [
            {
              id: card.id,
              name: card.sourceName,
              meta: `${card.inputFormat.toUpperCase()} → ${card.outputFormat.toUpperCase()}`,
              src: card.previewUrl,
            },
          ];
        }
        if (card.kind === "upload") {
          return [
            {
              id: card.id,
              name: card.fileName,
              meta: `${card.uploadWidth}×${card.uploadHeight} · upload`,
              src: card.thumbnailDataUrl,
            },
          ];
        }
        return [];
      }),
    [cards],
  );
  const mentionedImageCards = useMemo(
    () =>
      mentionedCardIds
        .map((id) => mentionableImageCards.find((card) => card.id === id))
        .filter((card): card is (typeof mentionableImageCards)[number] =>
          Boolean(card),
        ),
    [mentionableImageCards, mentionedCardIds],
  );
  const extractTextTargetCount = useMemo(() => {
    const targetIds = new Set<string>();
    for (const card of cards) {
      if (card.kind !== "asset" && card.kind !== "upload") continue;
      if (
        selectedCardIds.includes(card.id) ||
        mentionedCardIds.includes(card.id)
      ) {
        targetIds.add(card.id);
      }
    }
    return targetIds.size;
  }, [cards, mentionedCardIds, selectedCardIds]);
  const commentsByAnchor = useMemo(() => {
    const map = new Map<string, CommentCanvasCard[]>();
    cards.forEach((card) => {
      if (card.kind !== "comment") return;
      const next = map.get(card.anchorId) ?? [];
      next.push(card);
      map.set(card.anchorId, next);
    });
    return map;
  }, [cards]);
  const commentConnectors = useMemo(() => {
    const anchorCards = new Map(
      cards.filter(isImageCard).map((card) => [card.id, card]),
    );

    return cards.flatMap((card) => {
      if (card.kind !== "comment") return [];
      const anchor = anchorCards.get(card.anchorId);
      if (!anchor) return [];
      const anchorPosition =
        dragPreview?.cardId === anchor.id
          ? { x: dragPreview.x, y: dragPreview.y }
          : anchor;
      const commentPosition =
        dragPreview?.cardId === card.id
          ? { x: dragPreview.x, y: dragPreview.y }
          : card;

      const anchorWidth = cardWidths[anchor.id] ?? CARD_WIDTH;
      const anchorImageTop = 0;
      const anchorImageHeight = anchorWidth / compactImageAspectRatio(anchor);
      const targetX =
        anchorPosition.x +
        anchorWidth * (card.region.x + card.region.width / 2);
      const targetY =
        anchorPosition.y +
        anchorImageTop +
        anchorImageHeight * (card.region.y + card.region.height / 2);
      const commentScale = viewport.scale > 0 ? 1 / viewport.scale : 1;
      const commentWidth = (cardWidths[card.id] ?? CARD_WIDTH) * commentScale;
      const fromX =
        commentPosition.x < targetX
          ? commentPosition.x + commentWidth
          : commentPosition.x;
      const fromY = commentPosition.y + 52 * commentScale;
      const bend = Math.max(56, Math.abs(targetX - fromX) * 0.35);
      const c1x = fromX + (fromX < targetX ? bend : -bend);
      const c2x = targetX + (fromX < targetX ? -bend : bend);
      const active =
        selectedCardIds.includes(card.id) ||
        selectedCardIds.includes(anchor.id);

      return [
        {
          id: card.id,
          active,
          fromX,
          fromY,
          targetX,
          targetY,
          path: `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${targetY}, ${targetX} ${targetY}`,
        },
      ];
    });
  }, [cardWidths, cards, dragPreview, selectedCardIds, viewport.scale]);
  const { handleApproveProposal, handleRejectProposal } = useProposalExecution({
    cards,
    t,
    setCards,
  });
  const { handleAsk, handleStop } = useCanvasChat({
    scanId,
    cards,
    selectedCardIds,
    viewport,
    cardLayoutMetrics,
    captureCanvasForAI,
    captureViewport,
    captureCanvas,
    captureSelected,
    locale: i18n.language,
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
  });
  const isWorking = working !== "idle";
  const composerToolsOpen = composerAdvancedOpen;
  const assistantMessages = useMemo(
    () => chatHistory.filter((entry) => entry.role === "assistant"),
    [chatHistory],
  );
  const latestChatContent = assistantMessages.at(-1)?.content ?? "";
  const composerStatusLabel = error
    ? t("aiCanvas.statusError")
    : isWorking
      ? t("aiCanvas.statusProcessing")
      : latestChatContent
        ? t("aiCanvas.statusLatest")
        : t("aiCanvas.statusReady");
  const composerStatusText =
    error ||
    (isWorking
      ? t("aiCanvas.statusProcessingDetail")
      : latestChatContent
        ? t("aiCanvas.statusLatestDetail")
        : t("aiCanvas.statusReadyDetail"));
  const groupedBackendOptions = useMemo(() => {
    const groups: Array<{ group: string; options: AIBackendOption[] }> = [];
    for (const option of aiBackendOptions) {
      const existing = groups.find((g) => g.group === option.group);
      if (existing) existing.options.push(option);
      else groups.push({ group: option.group, options: [option] });
    }
    return groups;
  }, [aiBackendOptions]);
  const selectedProposal = useMemo(() => {
    if (!primarySelectedId) return undefined;
    const card = cards.find((c) => c.id === primarySelectedId);
    return card?.kind === "proposal" ? card : undefined;
  }, [cards, primarySelectedId]);
  const currentTargets = useMemo(() => {
    const selected = new Set(selectedCardIds);
    return cards
      .filter((card) => selected.has(card.id))
      .map((card) => {
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
        return {
          id: card.id,
          name: cardDisplayName(card),
          meta: t(`aiCanvas.targetKind.${card.kind}`),
        };
      });
  }, [cards, selectedCardIds, t]);
  const pendingProposals = useMemo(
    () =>
      cards.filter(
        (c): c is ProposalCanvasCard =>
          c.kind === "proposal" && c.status === "pending",
      ),
    [cards],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeAICanvasSession(window.sessionStorage, {
      version: 1,
      cards,
      selectedCardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
      viewport,
      chatHistory: chatHistory.slice(-10),
      cardWidths: Object.keys(cardWidths).length > 0 ? cardWidths : undefined,
      viewMode: hideNonImageCards ? "hidden" : undefined,
    });
  }, [cards, selectedCardIds, viewport, chatHistory, cardWidths, hideNonImageCards]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "aisets.canvas.collapsed",
        composerCollapsed ? "true" : "false",
      );
    } catch {
      // sessionStorage unavailable
    }
  }, [composerCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, String(composerHeight));
    } catch {
      // localStorage unavailable
    }
  }, [composerHeight]);

  useEffect(() => {
    try {
      localStorage.setItem(
        IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY,
        imageOptimizationAdvice ? "true" : "false",
      );
    } catch {
      // localStorage unavailable
    }
  }, [imageOptimizationAdvice]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "aisets.canvas.captureTransparent",
        captureTransparent ? "true" : "false",
      );
    } catch {
      // localStorage unavailable
    }
  }, [captureTransparent]);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
    if (!searchOpen || !focusSearchAfterOpenRef.current) return;
    focusSearchAfterOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    function onCanvasSearchShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const nextOpen = !searchOpenRef.current;
      searchOpenRef.current = nextOpen;
      focusSearchAfterOpenRef.current = nextOpen;
      setSearchOpen(nextOpen);
    }

    window.addEventListener("keydown", onCanvasSearchShortcut, {
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", onCanvasSearchShortcut, {
        capture: true,
      });
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        setCommentMode(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.shiftKey && e.key === "@") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setComposerCollapsed(true);
        setMentionMenuOpen(true);
        return;
      }
      if (!e.shiftKey || e.key.toLowerCase() !== "c") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setCommentMode((enabled) => !enabled);
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const uploadRef = useRef<(files: File[]) => void>(handleUploadAndCreateCards);
  useEffect(() => {
    uploadRef.current = handleUploadAndCreateCards;
  });
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (
          file.type.startsWith("image/") ||
          file.name?.toLowerCase().endsWith(".svg")
        ) {
          files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      uploadRef.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const deleteCard = useCallback(
    (target: CanvasCard) => {
      const removedIds = cardIdsForDeletion(cards, target.id);

      setCards((current) => current.filter((card) => !removedIds.has(card.id)));
      setSelectedCardIds((current) =>
        current.filter((id) => !removedIds.has(id)),
      );
    },
    [cards],
  );

  const duplicateCard = useCallback(
    (target: CanvasCard) => {
      if (
        target.kind !== "asset" &&
        target.kind !== "upload" &&
        target.kind !== "variant"
      ) {
        return;
      }
      const cloneId = createCanvasCardId("copy");
      const clone = {
        ...target,
        id: cloneId,
        x: target.x + 42,
        y: target.y + 42,
        createdAt: nowISO(),
      } as AssetCanvasCard | UploadCanvasCard | VariantCanvasCard;
      setCards((current) => [...current, clone]);
      setSelectedCardIds([cloneId]);
      const width = cardWidths[target.id];
      if (width) {
        setCardWidths((current) => ({ ...current, [cloneId]: width }));
      }
    },
    [cardWidths],
  );

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    if (searchMode === "catalog" && !scanId) {
      setSearchError(t("aiCanvas.missingScan"));
      return;
    }
    setSearchBusy(true);
    setSearchError("");
    setSearchActiveIndex(-1);
    setSearchSelectedIds(new Set());
    try {
      if (searchMode === "semantic") {
        const result = await semanticSearch({
          q,
          includeItems: true,
          limit: 18,
        });
        const items = result.results
          .map((r) => r.item)
          .filter((item): item is AssetItem => item != null);
        setSearchResults(items);
        setSearchTotal(result.results.length);
      } else {
        const page = await getCatalogItems({ scanId: scanId!, q, limit: 18 });
        setSearchResults(page.items);
        setSearchTotal(page.total);
      }
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : t("aiCanvas.searchError"),
      );
    } finally {
      setSearchBusy(false);
    }
  }

  function addAsset(asset: AssetItem) {
    const id = createCanvasCardId("asset");
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const position = nextCardPosition(cards.length, viewport, containerSize);
    const card: AssetCanvasCard = {
      id,
      kind: "asset",
      x: position.x,
      y: position.y,
      createdAt: nowISO(),
      asset,
    };
    setCards((current) => [...current, card]);
    setSelectedCardIds([id]);
  }

  function addAssistantCard(promptText: string, message?: string) {
    const assetCards = selectedAssetCards(cards, selectedCardIds);
    const commentCards = commentsForAssets(
      cards,
      assetCards.map((card) => card.id),
    );
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const position = assetCards[0]
      ? adjacentCardPosition(assetCards[0], cardLayoutMetrics)
      : nextCardPosition(cards.length, viewport, containerSize);
    const card: CanvasCard = {
      id: createCanvasCardId("ai"),
      kind: "assistant",
      x: position.x,
      y: position.y,
      createdAt: nowISO(),
      prompt: promptText,
      message:
        message ??
        (aiEnabled ? t("aiCanvas.aiResponse") : t("aiCanvas.aiContextOnly")),
      bullets: buildAssistantBullets(promptText, cards, selectedCardIds),
      assetIds: selectedAssetIds(assetCards),
      commentIds: commentIds(commentCards),
    };
    setCards((current) => [...current, card]);
    setSelectedCardIds([card.id]);
  }

  function commentRequestsAi(text: string) {
    return AI_MENTION_COMMENT_RE.test(text);
  }

  function aiPromptFromComment(text: string) {
    return text.replace(AI_MENTION_COMMENT_RE_G, " ").trim();
  }

  function addComment(
    anchorCard: CanvasCard,
    text = prompt.trim(),
    region?: { x: number; y: number; width: number; height: number },
  ) {
    const id = createCanvasCardId("comment");
    const commentText = text || t("aiCanvas.defaultComment");
    const card: CommentCanvasCard = {
      id,
      kind: "comment",
      ...adjacentCardPosition(anchorCard, cardLayoutMetrics),
      createdAt: nowISO(),
      anchorId: anchorCard.id,
      text: commentText,
      region: region ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    };
    const nextCards = [...cards, card];
    setCards((current) => [...current, card]);
    setSelectedCardIds([id]);

    if (commentRequestsAi(commentText)) {
      void handleAsk({
        prompt: aiPromptFromComment(commentText) || commentText,
        selectedCardId: id,
        cards: nextCards,
      });
    }
  }

  async function createImagePreview(
    assetCard: AssetCanvasCard,
    promptText: string,
    outputFormat = DEFAULT_IMAGE_TOOL_SETTINGS.outputFormat,
  ) {
    setWorking("imagePreview");
    setError("");
    try {
      const preview = await renderImageToolPreview({
        assetId: assetCard.asset.id,
        outputFormat,
        quality: DEFAULT_IMAGE_TOOL_SETTINGS.quality,
        maxDimensionPx: DEFAULT_IMAGE_TOOL_SETTINGS.maxDimensionPx,
      });
      const card: VariantCanvasCard = {
        id: createCanvasCardId("variant"),
        kind: "variant",
        ...adjacentCardPosition(assetCard, cardLayoutMetrics),
        createdAt: nowISO(),
        sourceAssetId: assetCard.asset.id,
        sourceName: fileName(assetCard.asset.repoPath),
        previewUrl: previewImageUrl(preview.token),
        token: preview.token,
        inputBytes: preview.inputBytes,
        outputBytes: preview.outputBytes,
        inputFormat: preview.inputFormat,
        outputFormat: preview.outputFormat,
      };
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
      if (promptText) {
        addAssistantCard(promptText, t("aiCanvas.previewGenerated"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }


  function clearCanvas() {
    setCards([]);
    setSelectedCardIds([]);
    setChatHistory([]);
    setError("");
    setClearConfirmOpen(false);
  }

  function clearChatHistory() {
    setChatHistory([]);
    setError("");
  }

  function zoomCanvasBy(factor: number) {
    const bounds = rootRef.current?.getBoundingClientRect();
    const point = bounds
      ? { x: bounds.width / 2, y: bounds.height / 2 }
      : { x: 0, y: 0 };
    setViewport((current) => {
      const nextScale = clampCanvasScale(current.scale * factor);
      return zoomViewportAtPoint(current, point, nextScale);
    });
  }

  function centerCanvasView() {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;

    setViewport((current) => {
      if (cards.length === 0) {
        return {
          ...current,
          x: bounds.width / 2,
          y: bounds.height / 2,
        };
      }

      const contentBounds = cards.reduce(
        (acc, card) => {
          const element = cardElementsRef.current.get(card.id);
          const width = element?.offsetWidth ?? CARD_WIDTH;
          const height = element?.offsetHeight ?? 240;
          return {
            minX: Math.min(acc.minX, card.x),
            minY: Math.min(acc.minY, card.y),
            maxX: Math.max(acc.maxX, card.x + width),
            maxY: Math.max(acc.maxY, card.y + height),
          };
        },
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      );
      const centerX = (contentBounds.minX + contentBounds.maxX) / 2;
      const centerY = (contentBounds.minY + contentBounds.maxY) / 2;

      return {
        ...current,
        x: bounds.width / 2 - centerX * current.scale,
        y: bounds.height / 2 - centerY * current.scale,
      };
    });
  }

  function appendPromptToken(token: string) {
    appendPromptTokens([token]);
  }

  function appendPromptTokens(tokens: string[]) {
    const clean = tokens.filter(Boolean);
    if (clean.length === 0) return;
    setPrompt((current) => {
      const trimmed = current.trimEnd();
      const suffix = clean.join(" ");
      return trimmed ? `${trimmed} ${suffix}` : suffix;
    });
  }

  function mentionImageCard(cardId: string) {
    const target = mentionableImageCards.find((card) => card.id === cardId);
    if (!target) return;
    setMentionedCardIds((current) =>
      current.includes(cardId) ? current : [...current, cardId],
    );
    setSelectedCardIds([cardId]);
    appendPromptToken(`@${target.name}`);
  }

  function mentionSelectedAsset() {
    const targets = selectedAssets
      .map((asset) =>
        mentionableImageCards.find((card) => card.id === asset.id),
      )
      .filter((card): card is (typeof mentionableImageCards)[number] =>
        Boolean(card),
      );
    if (targets.length > 0) {
      const ids = targets.map((target) => target.id);
      setMentionedCardIds((current) => [
        ...current,
        ...ids.filter((id) => !current.includes(id)),
      ]);
      setSelectedCardIds(ids);
      appendPromptTokens(targets.map((target) => `@${target.name}`));
      return;
    }
    appendPromptToken("@" + t("aiCanvas.selectedMention"));
  }

  async function handleUploadAndCreateCards(files: File[]) {
    setWorking("ai");
    try {
      const results = await uploadCanvasImages(files);
      const rect = rootRef.current?.getBoundingClientRect();
      const containerSize = rect
        ? { width: rect.width, height: rect.height }
        : undefined;
      const newCards: UploadCanvasCard[] = results.map((r, i) => ({
        id: createCanvasCardId("upload"),
        kind: "upload" as const,
        ...nextCardPosition(cards.length + i, viewport, containerSize),
        createdAt: nowISO(),
        token: r.token,
        thumbnailDataUrl: r.thumbnailDataUrl,
        fileName: r.fileName,
        uploadWidth: r.width,
        uploadHeight: r.height,
      }));
      setCards((prev) => [...prev, ...newCards]);
      if (newCards.length > 0) setSelectedCardIds([newCards[0].id]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("aiCanvas.operationError"),
      );
    } finally {
      setWorking("idle");
    }
  }

  function handleAttachImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg,.avif,.heic,.heif,.webp";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) handleUploadAndCreateCards(files);
    };
    input.click();
  }

  function handleExtractText() {
    if (extractTextTargetCount === 0) {
      setError(t("aiCanvas.noOCRTargets"));
      return;
    }
    void handleAsk({ prompt: t("aiCanvas.extractTextPrompt") });
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 origin-center overscroll-none overflow-hidden bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] animate-[canvasSearchIn_220ms_var(--g-ease-out)_both] motion-reduce:animate-none [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.055)_1px,transparent_0)]"
    >
      <AICanvasStage
        t={t}
        viewport={viewport}
        canvasInnerRef={canvasInnerRef}
        cards={cards}
        setCards={setCards}
        selectedCardIds={selectedCardIds}
        setSelectedCardIds={setSelectedCardIds}
        cardWidths={cardWidths}
        setCardWidths={setCardWidths}
        hideNonImageCards={hideNonImageCards}
        commentConnectors={commentConnectors}
        commentsByAnchor={commentsByAnchor}
        groupBounds={groupBounds}
        canvasSelection={canvasSelection}
        dragPreview={dragPreview}
        aiCursor={aiCursor}
        aiNickname={aiNickname}
        commentMode={commentMode}
        setCommentMode={setCommentMode}
        isWorking={isWorking}
        onOpenAsset={onOpenAsset}
        onCanvasPointerDown={handleCanvasPointerDown}
        onCanvasPointerMove={handleCanvasPointerMove}
        onCanvasPointerEnd={handleCanvasPointerEnd}
        onWheel={handleWheel}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDeleteCard={deleteCard}
        onDuplicateCard={duplicateCard}
        onRegisterCard={registerMeasuredCardElement}
        onAddComment={addComment}
        onCreateImagePreview={createImagePreview}
      />

      <AICanvasSearchPanel
        t={t}
        open={searchOpen}
        inputRef={searchInputRef}
        query={query}
        setQuery={setQuery}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        semanticAvailable={semanticAvailable}
        searchBusy={searchBusy}
        searchError={searchError}
        searchResults={searchResults}
        searchTotal={searchTotal}
        searchActiveIndex={searchActiveIndex}
        setSearchActiveIndex={setSearchActiveIndex}
        searchSelectedIds={searchSelectedIds}
        setSearchSelectedIds={setSearchSelectedIds}
        setSearchResults={setSearchResults}
        setSearchTotal={setSearchTotal}
        setOpen={setSearchOpen}
        runSearch={runSearch}
        addAsset={addAsset}
      />

      <AICanvasToolbar
        t={t}
        onExitCanvas={onExitCanvas}
        viewportScale={viewport.scale}
        zoomCanvasBy={zoomCanvasBy}
        centerCanvasView={centerCanvasView}
        isCapturing={isCapturing}
        captureTransparent={captureTransparent}
        setCaptureTransparent={setCaptureTransparent}
        captureViewport={captureViewport}
        captureCanvas={captureCanvas}
        captureSelected={captureSelected}
        selectedCardCount={selectedCardIds.length}
        hideNonImageCards={hideNonImageCards}
        setHideNonImageCards={setHideNonImageCards}
        setSelectedCardIds={setSelectedCardIds}
        cardsCount={cards.length}
        onClear={() => setClearConfirmOpen(true)}
        debugOpen={debugOpen}
        onToggleDebug={() => setDebugOpen((v) => !v)}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        onConfirm={clearCanvas}
        onCancel={() => setClearConfirmOpen(false)}
        title={t("aiCanvas.clearConfirmTitle")}
        message={t("aiCanvas.clearConfirmMessage")}
        confirmText={t("aiCanvas.clearConfirmAction")}
        cancelText={t("common.cancel")}
        variant="danger"
      />

      <AICanvasComposer
        t={t}
        collapsed={composerCollapsed}
        setCollapsed={setComposerCollapsed}
        height={composerHeight}
        setHeight={setComposerHeight}
        isWorking={isWorking}
        composerStatusLabel={composerStatusLabel}
        composerStatusText={composerStatusText}
        currentTargets={currentTargets}
        latestChatContent={latestChatContent}
        chatHistory={chatHistory}
        composerToolsOpen={composerToolsOpen}
        composerAdvancedOpen={composerAdvancedOpen}
        imageOptimizationAdvice={imageOptimizationAdvice}
        setImageOptimizationAdvice={setImageOptimizationAdvice}
        mentionMenuOpen={mentionMenuOpen}
        setMentionMenuOpen={setMentionMenuOpen}
        mentionSelectedAsset={mentionSelectedAsset}
        handleAttachImage={handleAttachImage}
        handleExtractText={handleExtractText}
        extractTextTargetCount={extractTextTargetCount}
        extractTextDisabled={extractTextTargetCount === 0}
        commentMode={commentMode}
        setCommentMode={setCommentMode}
        addAssistantCard={addAssistantCard}
        selectedProposal={selectedProposal}
        pendingProposals={pendingProposals}
        handleRejectProposal={handleRejectProposal}
        handleApproveProposal={handleApproveProposal}
        mentionedImageCards={mentionedImageCards}
        setMentionedCardIds={setMentionedCardIds}
        mentionableImageCards={mentionableImageCards}
        mentionedCardIds={mentionedCardIds}
        mentionImageCard={mentionImageCard}
        prompt={prompt}
        setPrompt={setPrompt}
        handleAsk={handleAsk}
        handleStop={handleStop}
        aiBackendLabel={aiBackendLabel}
        aiBackendValue={aiBackendValue}
        aiBackendOptions={aiBackendOptions}
        aiBackendPending={aiBackendPending}
        onAiBackendChange={onAiBackendChange}
        groupedBackendOptions={groupedBackendOptions}
        clearChatHistory={clearChatHistory}
      />

      {capturePreview && (
        <AICanvasCapturePreview
          t={t}
          preview={capturePreview}
          dismissPreview={dismissCapturePreview}
          onSaved={(project, file) => {
            toast.success(t("aiCanvas.savedToProject", { project, file }));
          }}
          onSaveError={(msg) => {
            toast.error(msg, { title: t("aiCanvas.saveError") });
          }}
        />
      )}

      {debugOpen && (
        <AICanvasDebugPanel
          viewport={viewport}
          selectedCardIds={selectedCardIds}
          cardWidths={cardWidths}
          cards={cards}
          chatHistory={chatHistory}
          working={working}
          aiCursor={aiCursor}
          error={error}
          viewMode={viewMode}
          composerCollapsed={composerCollapsed}
          commentMode={commentMode}
          searchOpen={searchOpen}
          searchMode={searchMode}
          searchResultsCount={searchResults.length}
          searchBusy={searchBusy}
          searchError={searchError}
          onClose={() => setDebugOpen(false)}
          onResetViewport={() => setViewport({ ...DEFAULT_CANVAS_VIEWPORT })}
          onClearCards={() => {
            setCards([]);
            setSelectedCardIds([]);
          }}
          onSelectAll={() => setSelectedCardIds(cards.map((c) => c.id))}
          onDeselectAll={() => setSelectedCardIds([])}
        />
      )}
    </div>
  );
}

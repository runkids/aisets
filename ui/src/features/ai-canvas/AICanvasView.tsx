import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  embeddingStats,
  getCatalogItems,
  previewImageUrl,
  semanticSearch,
} from "@/api";
import {
  previewImageToolAssets,
  renderImageToolPreview,
} from "@/api/imageTools";
import { ConfirmDialog } from "@/components/ui";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  CARD_WIDTH,
  DEFAULT_IMAGE_TOOL_SETTINGS,
  commentIds,
  imageMeta,
  nextCardPosition,
  nowISO,
  selectedAssetIds,
  zoomViewportAtPoint,
} from "./canvasUtils";
import { useCanvasCapture } from "./useCanvasCapture";
import {
  buildAssistantBullets,
  cardIdsForDeletion,
  clampCanvasScale,
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
  type OperationCanvasCard,
  type ProposalCanvasCard,
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

const ASSET_CARD_IMAGE_TOP = 38;
const COMPOSER_HEIGHT_STORAGE_KEY = "aisets.canvas.composerHeight";
const IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY =
  "aisets.canvas.imageOptimizationAdvice";
const DEFAULT_COMPOSER_HEIGHT = 320;

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
  const { t } = useTranslation();
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
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkingState>("idle");
  const [composerCollapsed, setComposerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("aisets.canvas.collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [composerAdvancedOpen, setComposerAdvancedOpen] = useState(false);
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
  const [viewMode, setViewMode] = useState<"normal" | "compact" | "hidden">(
    initialSession.viewMode ?? "normal",
  );
  const compactCards = viewMode === "compact" || viewMode === "hidden";
  const hideCards = viewMode === "hidden";
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
      const size = cardElementSizes[card.id];
      const width = cardWidths[card.id] ?? size?.width ?? CARD_WIDTH;
      const height =
        size?.height ??
        (card.kind === "asset" && compactCards ? width * 0.75 : 240);
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + width);
      maxY = Math.max(maxY, card.y + height);
      found++;
    }
    if (found === 0) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [cardElementSizes, cardWidths, cards, compactCards, selectedCardIds]);

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
    const assetCards = new Map(
      cards
        .filter((card): card is AssetCanvasCard => card.kind === "asset")
        .map((card) => [card.id, card]),
    );

    return cards.flatMap((card) => {
      if (card.kind !== "comment") return [];
      const anchor = assetCards.get(card.anchorId);
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
      const anchorImageTop = compactCards ? 0 : ASSET_CARD_IMAGE_TOP;
      const anchorImageHeight = anchorWidth * 0.75;
      const targetX =
        anchorPosition.x +
        anchorWidth * (card.region.x + card.region.width / 2);
      const targetY =
        anchorPosition.y +
        anchorImageTop +
        anchorImageHeight * (card.region.y + card.region.height / 2);
      const commentWidth = cardWidths[card.id] ?? CARD_WIDTH;
      const fromX =
        commentPosition.x < targetX
          ? commentPosition.x + commentWidth
          : commentPosition.x;
      const fromY = commentPosition.y + 52;
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
  }, [cardWidths, cards, compactCards, dragPreview, selectedCardIds]);
  const { handleApproveProposal, handleRejectProposal } = useProposalExecution({
    cards,
    t,
    setCards,
  });
  const { handleAsk, handleStop } = useCanvasChat({
    scanId,
    cards,
    selectedCardId: primarySelectedId,
    viewport,
    chatHistory,
    prompt,
    mentionedCardIds,
    imageOptimizationAdvice,
    t,
    rootRef,
    setCards,
    setChatHistory,
    setAiCursor,
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
      viewMode: viewMode !== "normal" ? viewMode : undefined,
    });
  }, [cards, selectedCardIds, viewport, chatHistory, cardWidths, viewMode]);

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
    const existing = cards.find(
      (card): card is AssetCanvasCard =>
        card.kind === "asset" && card.asset.id === asset.id,
    );
    if (existing) {
      setSelectedCardIds([existing.id]);
      return;
    }
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
    const position = nextCardPosition(cards.length, viewport, containerSize);
    const card: CanvasCard = {
      id: createCanvasCardId("ai"),
      kind: "assistant",
      x: position.x + CARD_WIDTH + 36,
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
    return /(^|\s)@ai(?=\s|$|[,.，。!?！？])/i.test(text);
  }

  function aiPromptFromComment(text: string) {
    return text.replace(/(^|\s)@ai(?=\s|$|[,.，。!?！？])/gi, " ").trim();
  }

  function addComment(
    assetCard: AssetCanvasCard,
    text = prompt.trim(),
    region?: { x: number; y: number; width: number; height: number },
  ) {
    const id = createCanvasCardId("comment");
    const commentText = text || t("aiCanvas.defaultComment");
    const card: CommentCanvasCard = {
      id,
      kind: "comment",
      x: assetCard.x + CARD_WIDTH + 24,
      y: assetCard.y + 32,
      createdAt: nowISO(),
      anchorId: assetCard.id,
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
  ) {
    setWorking("imagePreview");
    setError("");
    try {
      const preview = await renderImageToolPreview({
        assetId: assetCard.asset.id,
        outputFormat: DEFAULT_IMAGE_TOOL_SETTINGS.outputFormat,
        quality: DEFAULT_IMAGE_TOOL_SETTINGS.quality,
        maxDimensionPx: DEFAULT_IMAGE_TOOL_SETTINGS.maxDimensionPx,
      });
      const card: VariantCanvasCard = {
        id: createCanvasCardId("variant"),
        kind: "variant",
        x: assetCard.x + CARD_WIDTH + 36,
        y: assetCard.y,
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

  async function createOperationPreview(
    assetCards: AssetCanvasCard[],
    promptText: string,
  ) {
    setWorking("operation");
    setError("");
    try {
      const result = await previewImageToolAssets({
        assetIds: selectedAssetIds(assetCards),
        settings: DEFAULT_IMAGE_TOOL_SETTINGS,
      });
      const first = assetCards[0];
      const card: OperationCanvasCard = {
        id: createCanvasCardId("op"),
        kind: "operation",
        x: (first?.x ?? 120) + CARD_WIDTH + 36,
        y: first?.y ?? 96,
        createdAt: nowISO(),
        prompt: promptText || t("aiCanvas.safeVariantPrompt"),
        token: result.token,
        preview: result.preview,
        assetIds: selectedAssetIds(assetCards),
      };
      setCards((current) => [...current, card]);
      setSelectedCardIds([card.id]);
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
    setPrompt((current) => {
      const trimmed = current.trimEnd();
      return trimmed ? `${trimmed} ${token}` : token;
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
    const target = selectedAssets[0];
    if (target) {
      mentionImageCard(target.id);
      return;
    }
    appendPromptToken("@" + t("aiCanvas.selectedMention"));
  }

  function noteUploadPending() {
    setError(t("aiCanvas.uploadPending"));
    setComposerAdvancedOpen(true);
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 overscroll-none overflow-hidden bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.055)_1px,transparent_0)]"
    >
      <AICanvasStage
        t={t}
        viewport={viewport}
        cards={cards}
        setCards={setCards}
        selectedCardIds={selectedCardIds}
        setSelectedCardIds={setSelectedCardIds}
        cardWidths={cardWidths}
        setCardWidths={setCardWidths}
        compactCards={compactCards}
        hideCards={hideCards}
        commentConnectors={commentConnectors}
        commentsByAnchor={commentsByAnchor}
        groupBounds={groupBounds}
        canvasSelection={canvasSelection}
        dragPreview={dragPreview}
        aiCursor={aiCursor}
        aiNickname={aiNickname}
        commentMode={commentMode}
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
        onRegisterCard={registerMeasuredCardElement}
        onAddComment={addComment}
        onCreateImagePreview={createImagePreview}
        onCreateOperationPreview={createOperationPreview}
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
        commentMode={commentMode}
        setCommentMode={setCommentMode}
        isCapturing={isCapturing}
        captureTransparent={captureTransparent}
        setCaptureTransparent={setCaptureTransparent}
        captureViewport={captureViewport}
        captureCanvas={captureCanvas}
        captureSelected={captureSelected}
        selectedCardCount={selectedCardIds.length}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setSelectedCardIds={setSelectedCardIds}
        cardsCount={cards.length}
        onClear={() => setClearConfirmOpen(true)}
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
        latestChatContent={latestChatContent}
        chatHistory={chatHistory}
        composerToolsOpen={composerToolsOpen}
        composerAdvancedOpen={composerAdvancedOpen}
        imageOptimizationAdvice={imageOptimizationAdvice}
        setImageOptimizationAdvice={setImageOptimizationAdvice}
        mentionSelectedAsset={mentionSelectedAsset}
        noteUploadPending={noteUploadPending}
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
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CanvasCardLayoutMetrics } from "@/api/canvasChat";
import { aisetsAppIconUrl } from "@/brandAssets";
import { useToast } from "@/components/shared/ToastProvider";
import { ConfirmDialog, PromptDialog } from "@/components/ui";
import { fileName } from "@/ui";
import {
  CARD_WIDTH,
  commentRegionDisplayOptions,
  imageMeta,
  AI_MENTION_COMMENT_RE,
  AI_MENTION_COMMENT_RE_G,
  adjacentCardPosition,
  compactImageAspectRatio,
  imageFrameSize,
  isImageCard,
  nextCardPosition,
  normalizeCommentRegion,
  nowISO,
  zoomViewportAtPoint,
} from "./canvasUtils";
import {
  DEFAULT_CAPTURE_PADDING,
  useCanvasCapture,
  type CapturePadding,
} from "./useCanvasCapture";
import {
  cardDisplayName,
  clampCanvasScale,
  DEFAULT_CANVAS_VIEWPORT,
  DEFAULT_DRAWING_HEIGHT,
  DEFAULT_DRAWING_WIDTH,
  DEFAULT_TEXT_STYLE,
  createCanvasCardId,
  emptyAICanvasSession,
  readAICanvasSession,
  selectedAssetCards,
  type AICanvasSession,
  type CanvasCard,
  type ChatActivityEntry,
  type ChatAttachment,
  type CommentCanvasCard,
  type ChatHistoryEntry,
  type ChatMentionPreview,
  type ChatRunUsage,
  type DrawingCanvasCard,
  type ProposalCanvasCard,
  type TextCanvasCard,
  type UploadCanvasCard,
} from "./aiCanvasState";
import { useCanvasCards } from "./useCanvasCards";
import { useCanvasChat } from "./useCanvasChat";
import { useCanvasEffects } from "./useCanvasEffects";
import { useCanvasComposer } from "./useCanvasComposer";
import { useCanvasDrag } from "./useCanvasDrag";
import { useCanvasSearch } from "./useCanvasSearch";
import { useCanvasSession } from "./useCanvasSession";
import { useProposalExecution } from "./useProposalExecution";
import { formatCanvasRunDuration } from "./canvasRunFormat";
import { AICanvasComposer } from "./AICanvasComposer";
import { AICanvasCapturePreview } from "./AICanvasCapturePreview";
import { AICanvasDebugPanel } from "./AICanvasDebugPanel";
import { AICanvasSearchPanel } from "./AICanvasSearchPanel";
import { AICanvasStage } from "./AICanvasStage";
import { AICanvasToolbar } from "./AICanvasToolbar";
import { AICanvasPlanDialog } from "./AICanvasPlanDialog";
import { CanvasSessionsDialog } from "./CanvasSessionsDialog";
import { createCanvasPlanState, type CanvasPlanState } from "./canvasPlanState";
import { useCanvasPlanRunner } from "./useCanvasPlanRunner";
import type { AIBackendOption, WorkingState } from "./aiCanvasTypes";

const CAPTURE_PADDING_X_STORAGE_KEY = "aisets.canvas.capturePaddingX";
const CAPTURE_PADDING_Y_STORAGE_KEY = "aisets.canvas.capturePaddingY";

function readCapturePadding(): CapturePadding {
  try {
    const storedX = localStorage.getItem(CAPTURE_PADDING_X_STORAGE_KEY);
    const storedY = localStorage.getItem(CAPTURE_PADDING_Y_STORAGE_KEY);
    const x = storedX === null ? NaN : Number(storedX);
    const y = storedY === null ? NaN : Number(storedY);
    return {
      x: Number.isFinite(x)
        ? Math.max(0, Math.min(512, x))
        : DEFAULT_CAPTURE_PADDING.x,
      y: Number.isFinite(y)
        ? Math.max(0, Math.min(512, y))
        : DEFAULT_CAPTURE_PADDING.y,
    };
  } catch {
    return DEFAULT_CAPTURE_PADDING;
  }
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
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get("session") ?? undefined;
  const initialSession = useMemo<AICanvasSession>(() => {
    if (typeof window === "undefined") return emptyAICanvasSession();
    return readAICanvasSession(window.sessionStorage);
  }, []);
  const [cards, setCards] = useState<CanvasCard[]>(initialSession.cards);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>(
    initialSession.selectedCardIds ?? [],
  );
  const [editingTextCardId, setEditingTextCardId] = useState<string | null>(
    null,
  );
  const primarySelectedId = selectedCardIds[0] as string | undefined;
  const [viewport, setViewport] = useState(initialSession.viewport);
  const {
    query,
    setQuery,
    searchResults,
    setSearchResults,
    searchTotal,
    setSearchTotal,
    searchOpen,
    setSearchOpen,
    searchError,
    searchMode,
    setSearchMode,
    searchActiveIndex,
    setSearchActiveIndex,
    searchBusy,
    searchSelectedIds,
    setSearchSelectedIds,
    semanticAvailable,
    searchInputRef,
    runSearch,
  } = useCanvasSearch({ scanId, aiEnabled, t });
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkingState>("idle");
  const [activeChatActivity, setActiveChatActivity] = useState<
    ChatActivityEntry[]
  >([]);
  const [activeChatUsage, setActiveChatUsage] = useState<
    ChatRunUsage | undefined
  >(undefined);
  const [activeChatRunStartedAt, setActiveChatRunStartedAt] = useState<
    number | null
  >(null);
  const [activeChatElapsedMs, setActiveChatElapsedMs] = useState(0);
  const [composerAdvancedOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>(
    initialSession.chatHistory ?? [],
  );
  const [plan, setPlan] = useState<CanvasPlanState | undefined>(
    initialSession.plan,
  );
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [aiCursor, setAiCursor] = useState<{
    x: number;
    y: number;
    label?: string;
    emoji?: string;
    status: "thinking" | "acting" | "idle";
  }>(() => {
    const v = initialSession.viewport;
    const screenW = typeof window !== "undefined" ? window.innerWidth : 1440;
    const screenH = typeof window !== "undefined" ? window.innerHeight : 900;
    const worldCenterX = (screenW / 2 - v.x) / v.scale;
    const worldCenterY = (screenH / 2 - v.y) / v.scale;
    return {
      x: worldCenterX - 40,
      y: worldCenterY - 40,
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
  const [capturePadding, setCapturePadding] = useState(readCapturePadding);
  const [commentMode, setCommentMode] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [aiGreeting] = useState(() => t("aiCanvas.greeting"));
  const lastToastedErrorRef = useRef("");
  const [dragPreview, setDragPreview] = useState<{
    cardId: string;
    x: number;
    y: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!error || lastToastedErrorRef.current === error) return;
    lastToastedErrorRef.current = error;
    toast.error(error, { title: t("aiCanvas.statusError") });
  }, [error, t, toast]);

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
    isDragging,
    isDraggingRef,
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
    captureCanvasBlob,
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
    capturePadding,
  });

  const {
    currentSessionId,
    currentSessionName,
    setCurrentSessionName,
    isDirty,
    isSaving,
    handleSave,
    handleSaveRef,
    handleSaveAsRef,
    handleLoadSession,
    clearCanvas,
    doSave,
    sessionsDialogOpen,
    setSessionsDialogOpen,
    newCanvasConfirmOpen,
    setNewCanvasConfirmOpen,
    saveNameDialogOpen,
    setSaveNameDialogOpen,
    saveNameDefault,
    saveAsMode,
  } = useCanvasSession({
    cards,
    selectedCardIds,
    viewport,
    chatHistory,
    cardWidths,
    plan,
    viewMode,
    setCards,
    setSelectedCardIds,
    setViewport,
    setChatHistory,
    setCardWidths,
    setPlan,
    setHideNonImageCards,
    setError,
    setClearConfirmOpen,
    isDragging,
    isDraggingRef,
    captureCanvasBlob,
    urlSessionId,
    setSearchParams,
    t,
    toast,
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
  const {
    prompt,
    setPrompt,
    preparedSkillIds,
    setPreparedSkillIds,
    mentionedCardIds,
    setMentionedCardIds,
    pendingAttachments,
    setPendingAttachments,
    mentionMenuOpen,
    setMentionMenuOpen,
    composerCollapsed,
    setComposerCollapsed,
    imageOptimizationAdvice,
    setImageOptimizationAdvice,
    composerHeight,
    setComposerHeight,
    mentionableImageCards,
    mentionedImageCards,
    extractTextTargetCount,
    mentionImageCard,
    mentionAllImageCards,
    mentionSelectedAsset,
    handleAttachImage,
  } = useCanvasComposer({
    cards,
    selectedCardIds,
    selectedAssets,
    setSelectedCardIds,
    setWorking,
    setError,
    t,
  });
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
      const anchorFrame = imageFrameSize(anchor, anchorWidth);
      const region = normalizeCommentRegion(
        card.region,
        anchorFrame,
        commentRegionDisplayOptions(card.isAi),
      );
      const targetX =
        anchorPosition.x + anchorFrame.width * (region.x + region.width / 2);
      const targetY =
        anchorPosition.y + anchorFrame.height * (region.y + region.height / 2);
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
    preparedSkillIds,
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
    onChatRunStart: () => {
      setActiveChatActivity([]);
      setActiveChatUsage(undefined);
      setActiveChatRunStartedAt(Date.now());
      setActiveChatElapsedMs(0);
    },
    setActiveChatActivity,
    setActiveChatUsage,
  });
  const { cancelPlan } = useCanvasPlanRunner({
    plan,
    setPlan,
    handleAsk,
    handleStop,
    isWorking: working !== "idle",
  });
  const isWorking = working !== "idle";
  useEffect(() => {
    if (!isWorking || activeChatRunStartedAt === null) return undefined;
    const update = () => {
      setActiveChatElapsedMs(Date.now() - activeChatRunStartedAt);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [activeChatRunStartedAt, isWorking]);

  const composerToolsOpen = composerAdvancedOpen;
  const canClearCanvas =
    cards.length > 0 ||
    chatHistory.length > 0 ||
    Boolean(plan) ||
    Boolean(currentSessionId) ||
    isDirty;
  const assistantMessages = useMemo(
    () => chatHistory.filter((entry) => entry.role === "assistant"),
    [chatHistory],
  );
  const latestChatContent = assistantMessages.at(-1)?.content ?? "";
  const composerStatusLabel = error
    ? t("aiCanvas.statusError")
    : isWorking
      ? working === "aiApplying"
        ? t("aiCanvas.statusApplying")
        : t("aiCanvas.statusProcessing")
      : latestChatContent
        ? t("aiCanvas.statusLatest")
        : t("aiCanvas.statusReady");
  const composerStatusText =
    error ||
    (isWorking
      ? working === "aiApplying"
        ? t("aiCanvas.statusApplyingDetail")
        : t("aiCanvas.statusProcessingDetail")
      : latestChatContent
        ? t("aiCanvas.statusLatestDetail")
        : t("aiCanvas.statusReadyDetail"));
  const elapsedLabel =
    isWorking && activeChatRunStartedAt !== null
      ? t("aiCanvas.elapsed", {
          time: formatCanvasRunDuration(activeChatElapsedMs),
        })
      : null;
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

  useCanvasEffects({
    cards,
    selectedCardIds,
    viewport,
    chatHistory,
    cardWidths,
    plan,
    hideNonImageCards,
    composerCollapsed,
    composerHeight,
    imageOptimizationAdvice,
    captureTransparent,
    capturePadding,
    handleSaveRef,
    handleSaveAsRef,
    setSelectedCardIds,
    setDebugOpen,
    setCommentMode,
    setComposerCollapsed,
    setMentionMenuOpen,
  });

  const {
    deleteCard,
    deleteSelectedCards,
    groupSelectedCards,
    ungroupCard,
    duplicateCard,
    addAsset,
    addAssistantCard,
    createImagePreview,
    mirrorImage,
    rotateImage,
  } = useCanvasCards({
    cards,
    setCards,
    selectedCardIds,
    setSelectedCardIds,
    cardWidths,
    setCardWidths,
    viewport,
    cardLayoutMetrics,
    rootRef,
    aiEnabled,
    t,
    setWorking,
    setError,
  });

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

  function addTextCard() {
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const pos = nextCardPosition(cards.length, viewport, containerSize);
    const card: TextCanvasCard = {
      id: createCanvasCardId("text"),
      kind: "text",
      x: pos.x,
      y: pos.y,
      createdAt: nowISO(),
      content: "",
      style: { ...DEFAULT_TEXT_STYLE },
      width: 240,
      height: 48,
    };
    setCards((current) => [...current, card]);
    setSelectedCardIds([card.id]);
    setEditingTextCardId(card.id);
  }

  function discardEmptyTextCard(cardId: string) {
    setCards((current) =>
      current.filter(
        (c) => !(c.id === cardId && c.kind === "text" && !c.content.trim()),
      ),
    );
    setSelectedCardIds((prev) => prev.filter((id) => id !== cardId));
  }

  function addDrawingCard() {
    const rect = rootRef.current?.getBoundingClientRect();
    const containerSize = rect
      ? { width: rect.width, height: rect.height }
      : undefined;
    const pos = nextCardPosition(cards.length, viewport, containerSize);
    const card: DrawingCanvasCard = {
      id: createCanvasCardId("drawing"),
      kind: "drawing",
      x: pos.x,
      y: pos.y,
      createdAt: nowISO(),
      shapes: [],
      width: DEFAULT_DRAWING_WIDTH,
      height: DEFAULT_DRAWING_HEIGHT,
    };
    setCards((current) => [...current, card]);
    setSelectedCardIds([card.id]);
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

  const handlePlaceOnCanvas = useCallback(
    (att: ChatAttachment) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const containerSize = rect
        ? { width: rect.width, height: rect.height }
        : undefined;
      const card: UploadCanvasCard = {
        id: createCanvasCardId("upload"),
        kind: "upload",
        ...nextCardPosition(cards.length, viewport, containerSize),
        createdAt: nowISO(),
        token: att.token,
        thumbnailDataUrl: att.thumbnailDataUrl,
        fileName: att.fileName,
        uploadWidth: att.width,
        uploadHeight: att.height,
      };
      setCards((prev) => [...prev, card]);
      setSelectedCardIds([card.id]);
    },
    [cards.length, viewport],
  );

  function handleAddSearchCandidate(mention: ChatMentionPreview) {
    if (!mention.asset) return;
    addAsset(mention.asset, { select: false });
  }

  function handleDismissSearchCandidates(entryIndex: number) {
    setChatHistory((current) =>
      current.map((entry, index) => {
        if (index !== entryIndex || !entry.mentions?.length) return entry;
        const mentions = entry.mentions.filter(
          (mention) => mention.kind !== "searchCandidate",
        );
        return {
          ...entry,
          mentions: mentions.length > 0 ? mentions : undefined,
        };
      }),
    );
  }

  function handleExtractText() {
    if (extractTextTargetCount === 0) {
      setError(t("aiCanvas.noOCRTargets"));
      return;
    }
    void handleAsk({ prompt: t("aiCanvas.extractTextPrompt") });
  }

  function handlePreparePhotoStaging() {
    const defaultPrompt = t("aiCanvas.photoStagePrompt");
    const styleLabel = t("aiCanvas.photoStageStyleLabel");
    const template = `${defaultPrompt}\n${styleLabel}: `;
    setPrompt((current) => {
      const text = current.trim();
      return text ? `${text}\n\n${template}` : template;
    });
    setPreparedSkillIds(["photo-staging"]);
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
        aiGreeting={aiGreeting}
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
        onDeleteSelectedCards={deleteSelectedCards}
        onDuplicateCard={duplicateCard}
        onGroupSelectedCards={groupSelectedCards}
        onUngroupCard={ungroupCard}
        onRegisterCard={registerMeasuredCardElement}
        onAddComment={addComment}
        onCreateImagePreview={createImagePreview}
        onMirrorImage={mirrorImage}
        onRotateImage={rotateImage}
        editingTextCardId={editingTextCardId}
        setEditingTextCardId={setEditingTextCardId}
        onDiscardEmptyTextCard={discardEmptyTextCard}
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

      <a
        href="https://github.com/runkids/aisets"
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto absolute left-3 top-3 z-50 flex h-[40px] items-center gap-2.5 rounded-g-lg border border-transparent bg-g-surface/75 px-3 shadow-g-pop backdrop-blur-xl transition-opacity duration-[120ms] ease-g hover:opacity-70 focus-visible:outline-none focus-visible:shadow-g-focus [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80"
        aria-label="Aisets on GitHub"
      >
        <div className="grid size-g-btn-sm shrink-0 place-items-center overflow-hidden rounded-[7px] bg-black">
          <img className="block size-full" src={aisetsAppIconUrl} alt="" />
        </div>
        <span className="font-g-display text-[15px] font-[620] leading-g-btn-sm tracking-[-0.02em] text-g-ink">
          Aisets
        </span>
      </a>

      <AICanvasToolbar
        t={t}
        onExitCanvas={onExitCanvas}
        viewportScale={viewport.scale}
        zoomCanvasBy={zoomCanvasBy}
        centerCanvasView={centerCanvasView}
        isCapturing={isCapturing}
        captureTransparent={captureTransparent}
        setCaptureTransparent={setCaptureTransparent}
        capturePadding={capturePadding}
        setCapturePadding={setCapturePadding}
        captureViewport={captureViewport}
        captureCanvas={captureCanvas}
        captureSelected={captureSelected}
        selectedCardCount={selectedCardIds.length}
        hideNonImageCards={hideNonImageCards}
        setHideNonImageCards={setHideNonImageCards}
        setSelectedCardIds={setSelectedCardIds}
        canClear={canClearCanvas}
        onClear={() => setClearConfirmOpen(true)}
        debugOpen={debugOpen}
        onToggleDebug={() => setDebugOpen((v) => !v)}
        onSave={handleSave}
        onOpenSessions={() => setSessionsDialogOpen(true)}
        onNewCanvas={() => {
          if (canClearCanvas) {
            setNewCanvasConfirmOpen(true);
          }
        }}
        isSaving={isSaving}
        isDirty={isDirty}
        hasSession={!!currentSessionId}
        sessionName={currentSessionName}
        onAddTextCard={addTextCard}
        onAddDrawingCard={addDrawingCard}
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

      <ConfirmDialog
        open={newCanvasConfirmOpen}
        onConfirm={() => {
          setNewCanvasConfirmOpen(false);
          clearCanvas();
        }}
        onCancel={() => setNewCanvasConfirmOpen(false)}
        title={t("aiCanvas.newCanvas")}
        message={t("aiCanvas.newCanvasMessage")}
        confirmText={t("aiCanvas.newCanvasConfirm")}
        cancelText={t("common.cancel")}
      />

      <CanvasSessionsDialog
        open={sessionsDialogOpen}
        onClose={() => setSessionsDialogOpen(false)}
        onLoad={(sessionId) => void handleLoadSession(sessionId)}
        onSessionRenamed={(id, name) => {
          if (id === currentSessionId) setCurrentSessionName(name);
        }}
        currentSessionId={currentSessionId}
        t={t}
      />

      <PromptDialog
        open={saveNameDialogOpen}
        onConfirm={(name) => {
          setSaveNameDialogOpen(false);
          void doSave(name, saveAsMode);
        }}
        onCancel={() => setSaveNameDialogOpen(false)}
        title={saveAsMode ? t("aiCanvas.saveAs") : t("aiCanvas.save")}
        placeholder={t("aiCanvas.sessionNamePlaceholder")}
        defaultValue={saveNameDefault}
        confirmText={t("aiCanvas.save")}
        cancelText={t("common.cancel")}
        loading={isSaving}
        allowUnchanged
      />

      <AICanvasComposer
        t={t}
        collapsed={composerCollapsed}
        setCollapsed={setComposerCollapsed}
        height={composerHeight}
        setHeight={setComposerHeight}
        isWorking={isWorking}
        aiEnabled={aiEnabled}
        composerStatusLabel={composerStatusLabel}
        composerStatusText={composerStatusText}
        elapsedLabel={elapsedLabel}
        activeChatActivity={activeChatActivity}
        activeChatUsage={activeChatUsage}
        activeElapsedMs={activeChatElapsedMs}
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
        handlePreparePhotoStaging={handlePreparePhotoStaging}
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
        mentionAllImageCards={mentionAllImageCards}
        prompt={prompt}
        setPrompt={setPrompt}
        handleAsk={handleAsk}
        handleStop={handleStop}
        plan={plan}
        onOpenPlan={() => setPlanDialogOpen(true)}
        aiBackendLabel={aiBackendLabel}
        aiBackendValue={aiBackendValue}
        aiBackendOptions={aiBackendOptions}
        aiBackendPending={aiBackendPending}
        onAiBackendChange={onAiBackendChange}
        groupedBackendOptions={groupedBackendOptions}
        clearChatHistory={clearChatHistory}
        pendingAttachments={pendingAttachments}
        setPendingAttachments={setPendingAttachments}
        handlePlaceOnCanvas={handlePlaceOnCanvas}
        handleAddSearchCandidate={handleAddSearchCandidate}
        handleDismissSearchCandidates={handleDismissSearchCandidates}
      />

      <AICanvasPlanDialog
        open={planDialogOpen}
        plan={plan}
        isWorking={working !== "idle"}
        onClose={() => setPlanDialogOpen(false)}
        onStart={(tasks) => setPlan(createCanvasPlanState(tasks))}
        onCancel={cancelPlan}
        onReset={() => setPlan(undefined)}
        t={t}
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

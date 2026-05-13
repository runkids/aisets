import {
  ArrowLeft,
  ArrowUp,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Layers3,
  LoaderCircle,
  LocateFixed,
  MessageCircle,
  X,
  Paperclip,
  Plus,
  Search,
  Square,
  Trash2,
  WandSparkles,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
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
import {
  AssetThumbnail,
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  IconButton,
  Switch,
  TextInput,
  TextInputClearButton,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import {
  CARD_WIDTH,
  DEFAULT_IMAGE_TOOL_SETTINGS,
  commentIds,
  imageMeta,
  nextCardPosition,
  nowISO,
  renderMarkdown,
  selectedAssetIds,
  selectionBounds,
  zoomViewportAtPoint,
} from "./canvasUtils";
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
import {
  AICursor,
  AssetCardBody,
  AssistantCardBody,
  CardShell,
  CommentCardBody,
  OperationCardBody,
  ProposalCardBody,
  VariantCardBody,
} from "./canvasCards";
import { useCanvasChat } from "./useCanvasChat";
import { useCanvasDrag } from "./useCanvasDrag";
import { useProposalExecution } from "./useProposalExecution";

const SEMANTIC_PHASES = [
  "向量比對中",
  "Embedding lookup",
  "計算餘弦距離",
  "Cosine similarity",
  "標記相似群集",
  "k-NN clustering",
  "語意排序中",
  "Ranking results",
  "解析語意特徵",
  "Parsing features",
  "ベクトル検索中",
  "유사도 계산",
];

const ASSET_CARD_IMAGE_TOP = 38;
const COMPOSER_HEIGHT_STORAGE_KEY = "aisets.canvas.composerHeight";
const IMAGE_OPTIMIZATION_ADVICE_STORAGE_KEY =
  "aisets.canvas.imageOptimizationAdvice";
const DEFAULT_COMPOSER_HEIGHT = 320;
const composerActionClass =
  "border-white/[0.08] bg-white/[0.07] text-white/72 hover:bg-white/[0.12] hover:text-white";
const composerIconClass =
  "rounded-full border-transparent bg-transparent text-white/52 hover:bg-white/[0.08] hover:text-white";
const composerConfirmClass =
  "border-white/80 bg-white text-black hover:bg-white/90";

type AIBackendOption = {
  value: string;
  label: string;
  group: string;
  disabled?: boolean;
};

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

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

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
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(
    initialSession.selectedCardId,
  );
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
  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    if (!searchBusy || searchMode !== "semantic") return;
    const id = window.setInterval(() => {
      setPhaseIdx((i) => (i + 1) % SEMANTIC_PHASES.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [searchBusy, searchMode]);
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
  const composerDragRef = useRef<{ startY: number; startH: number } | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<{
    cardId: string;
    x: number;
    y: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
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
    setCards,
    setViewport,
    setSelectedCardId,
    setDragPreview,
  });

  const selectedAssets = useMemo(
    () => selectedAssetCards(cards, selectedCardId),
    [cards, selectedCardId],
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
      const active = selectedCardId === card.id || selectedCardId === anchor.id;

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
  }, [cardWidths, cards, compactCards, dragPreview, selectedCardId]);
  const { handleApproveProposal, handleRejectProposal } = useProposalExecution({
    cards,
    t,
    setCards,
  });
  const { handleAsk, handleStop } = useCanvasChat({
    scanId,
    cards,
    selectedCardId,
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
    if (!selectedCardId) return undefined;
    const card = cards.find((c) => c.id === selectedCardId);
    return card?.kind === "proposal" ? card : undefined;
  }, [cards, selectedCardId]);
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
      selectedCardId,
      viewport,
      chatHistory: chatHistory.slice(-10),
      cardWidths: Object.keys(cardWidths).length > 0 ? cardWidths : undefined,
      viewMode: viewMode !== "normal" ? viewMode : undefined,
    });
  }, [cards, selectedCardId, viewport, chatHistory, cardWidths, viewMode]);

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
    function onCanvasSearchShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      setSearchOpen(true);
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }

    document.addEventListener("keydown", onCanvasSearchShortcut, {
      capture: true,
    });
    return () => {
      document.removeEventListener("keydown", onCanvasSearchShortcut, {
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
    if (composerCollapsed) return undefined;
    const el = chatScrollRef.current;
    if (!el) return undefined;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    chatHistory.length,
    composerCollapsed,
    composerHeight,
    isWorking,
    latestChatContent,
  ]);

  const deleteCard = useCallback(
    (target: CanvasCard) => {
      const removedIds = cardIdsForDeletion(cards, target.id);

      setCards((current) => current.filter((card) => !removedIds.has(card.id)));
      setSelectedCardId((current) =>
        current && removedIds.has(current) ? undefined : current,
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
      setSelectedCardId(existing.id);
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
    setSelectedCardId(id);
  }

  function addAssistantCard(promptText: string, message?: string) {
    const assetCards = selectedAssetCards(cards, selectedCardId);
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
      bullets: buildAssistantBullets(promptText, cards, selectedCardId),
      assetIds: selectedAssetIds(assetCards),
      commentIds: commentIds(commentCards),
    };
    setCards((current) => [...current, card]);
    setSelectedCardId(card.id);
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
    setSelectedCardId(id);

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
      setSelectedCardId(card.id);
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
      setSelectedCardId(card.id);
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
    setSelectedCardId(undefined);
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
    setSelectedCardId(cardId);
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
      <div
        className="absolute inset-0 z-0 cursor-default overscroll-none overflow-hidden"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerEnd}
        onPointerCancel={handleCanvasPointerEnd}
        onWheel={handleWheel}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {commentConnectors.length > 0 && !hideCards && (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-[36] overflow-visible"
              width="1"
              height="1"
              aria-hidden="true"
            >
              {commentConnectors.map((connector) => (
                <g key={connector.id}>
                  <path
                    d={connector.path}
                    fill="none"
                    stroke={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    strokeWidth={connector.active ? 2 : 1.25}
                    strokeDasharray="5 7"
                    strokeLinecap="round"
                    opacity={connector.active ? 0.62 : 0.34}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={connector.fromX}
                    cy={connector.fromY}
                    r={3.5}
                    fill="var(--g-canvas)"
                    stroke={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    strokeWidth={1.5}
                    opacity={connector.active ? 0.78 : 0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={connector.targetX}
                    cy={connector.targetY}
                    r={4}
                    fill={
                      connector.active ? "var(--g-active-bg)" : "var(--g-amber)"
                    }
                    opacity={connector.active ? 0.78 : 0.42}
                  />
                </g>
              ))}
            </svg>
          )}
          {cards.map((card) => {
            if (hideCards && card.kind !== "asset") return null;
            return (
              <CardShell
                key={card.id}
                card={card}
                selected={selectedCardId === card.id}
                compact={compactCards && card.kind === "asset"}
                width={cardWidths[card.id]}
                onSelect={(id) => {
                  setSelectedCardId(id);
                  setCards((prev) => {
                    const idx = prev.findIndex((c) => c.id === id);
                    if (idx < 0 || idx === prev.length - 1) return prev;
                    const next = [...prev];
                    next.push(next.splice(idx, 1)[0]);
                    return next;
                  });
                }}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDelete={deleteCard}
                onResize={
                  card.kind === "asset"
                    ? (id, w) => setCardWidths((prev) => ({ ...prev, [id]: w }))
                    : undefined
                }
                onRegister={registerCardElement}
                position={
                  dragPreview?.cardId === card.id
                    ? { x: dragPreview.x, y: dragPreview.y }
                    : undefined
                }
              >
                {card.kind === "asset" ? (
                  <AssetCardBody
                    card={card}
                    comments={commentsByAnchor.get(card.id) ?? []}
                    compact={compactCards && card.kind === "asset"}
                    hideOverlays={hideCards}
                    commentEnabled={commentMode}
                    onOpenAsset={onOpenAsset}
                    onSelectComment={setSelectedCardId}
                    onCreateComment={addComment}
                    onRenderPreview={(assetCard) =>
                      void createImagePreview(assetCard, "")
                    }
                    onOperationPreview={(assetCard) =>
                      void createOperationPreview(
                        [assetCard],
                        t("aiCanvas.safeVariantPrompt"),
                      )
                    }
                    working={isWorking}
                  />
                ) : card.kind === "comment" ? (
                  <CommentCardBody card={card} />
                ) : card.kind === "assistant" ? (
                  <AssistantCardBody card={card} />
                ) : card.kind === "variant" ? (
                  <VariantCardBody card={card} />
                ) : card.kind === "proposal" ? (
                  <ProposalCardBody card={card} />
                ) : card.kind === "operation" ? (
                  <OperationCardBody card={card} />
                ) : null}
              </CardShell>
            );
          })}
          {!hideCards && (
            <AICursor
              position={{ x: aiCursor.x, y: aiCursor.y }}
              label={aiCursor.label}
              status={aiCursor.status}
              nickname={aiNickname}
            />
          )}
        </div>
      </div>

      {canvasSelection && (
        <div
          className="pointer-events-none absolute z-10 border border-[#0d99ff] bg-[#0d99ff]/10"
          style={selectionBounds(canvasSelection)}
        />
      )}

      {searchOpen ? (
        <aside
          data-ai-canvas-overlay="true"
          className="pointer-events-auto absolute left-3 top-3 z-50 flex w-[min(480px,calc(100%-24px))] origin-top-left flex-col gap-1 rounded-g-lg bg-g-surface/75 p-1.5 shadow-g-pop backdrop-blur-xl animate-[canvasSearchIn_200ms_var(--g-ease-out)_both] motion-reduce:animate-none"
        >
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <TextInput
              ref={searchInputRef}
              value={query}
              variant="command"
              size="sm"
              icon={
                searchBusy ? (
                  <LoaderCircle
                    size={14}
                    className="animate-spin text-g-ink-3"
                  />
                ) : (
                  <span className="relative inline-grid size-[14px] place-items-center">
                    <Search
                      size={14}
                      className={cn(
                        "absolute inset-0 transition-[opacity,transform] duration-[280ms] ease-g-spring",
                        searchMode === "catalog"
                          ? "rotate-0 scale-100 opacity-100"
                          : "rotate-[-20deg] scale-75 opacity-0",
                      )}
                    />
                    <WandSparkles
                      size={14}
                      className={cn(
                        "absolute inset-0 text-g-purple transition-[opacity,transform] duration-[280ms] ease-g-spring",
                        searchMode === "semantic"
                          ? "rotate-0 scale-100 opacity-100"
                          : "rotate-[20deg] scale-75 opacity-0",
                      )}
                    />
                  </span>
                )
              }
              placeholder={
                searchMode === "semantic"
                  ? t("toolbar.semanticSearch")
                  : t("aiCanvas.searchPlaceholder")
              }
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab" && !e.shiftKey && semanticAvailable) {
                  e.preventDefault();
                  setSearchMode((m) =>
                    m === "catalog" ? "semantic" : "catalog",
                  );
                  return;
                }
                if (e.key === "ArrowDown" && searchResults.length > 0) {
                  e.preventDefault();
                  setSearchActiveIndex((i) =>
                    Math.min(i + 1, searchResults.length - 1),
                  );
                  return;
                }
                if (e.key === "ArrowUp" && searchResults.length > 0) {
                  e.preventDefault();
                  setSearchActiveIndex((i) => Math.max(i - 1, -1));
                  return;
                }
                if (e.key === "Enter") {
                  e.stopPropagation();
                  if (
                    searchActiveIndex >= 0 &&
                    searchResults[searchActiveIndex]
                  ) {
                    e.preventDefault();
                    setSearchSelectedIds((prev) => {
                      const next = new Set(prev);
                      const id = searchResults[searchActiveIndex].id;
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }
                  return;
                }
              }}
              suffix={
                <span className="-mr-1 inline-flex h-full items-center gap-1">
                  {query && (
                    <TextInputClearButton
                      label={t("toolbar.clearSearch")}
                      onClick={() => setQuery("")}
                      className="mr-0.5"
                    />
                  )}
                  {semanticAvailable && (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-5 items-center gap-1 border-l border-g-line px-2 pr-1 font-g text-[12px] font-[650] tracking-g-ui transition-colors duration-[140ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus",
                        searchMode === "semantic"
                          ? "text-g-purple hover:text-g-purple"
                          : "text-g-ink-3 hover:text-g-ink",
                      )}
                      aria-label={t("toolbar.searchMode")}
                      onClick={() =>
                        setSearchMode((m) =>
                          m === "catalog" ? "semantic" : "catalog",
                        )
                      }
                    >
                      {searchMode === "semantic" ? (
                        <WandSparkles size={13} aria-hidden="true" />
                      ) : (
                        <Search size={13} aria-hidden="true" />
                      )}
                      <span>
                        {searchMode === "semantic"
                          ? t("toolbar.aiSearchMode")
                          : t("toolbar.catalogSearchMode")}
                      </span>
                      <kbd className="ml-0.5 font-g-mono text-[10px] font-[650] text-g-ink-4 opacity-70">
                        TAB
                      </kbd>
                    </button>
                  )}
                  {searchBusy && searchMode === "semantic" && (
                    <span className="relative ml-1.5 mr-0.5 inline-flex h-[18px] items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--g-purple)_10%,transparent)] px-2 animate-[semanticGlow_2s_ease-in-out_infinite]">
                      <span className="absolute inset-0 animate-[semanticScan_1.4s_ease-in-out_infinite]">
                        <span className="block h-full w-[40%] bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--g-purple)_45%,transparent)] to-transparent" />
                      </span>
                      <span
                        key={phaseIdx}
                        className="relative whitespace-nowrap font-g text-[10px] font-[590] tracking-wide text-g-purple animate-[ghostSwap_1.8s_ease-in-out_both]"
                      >
                        {SEMANTIC_PHASES[phaseIdx]}
                      </span>
                    </span>
                  )}
                </span>
              }
              className="flex-1"
              inputClassName={cn(
                "font-g text-g-ui tracking-g-ui",
                searchMode === "semantic" &&
                  (query.trim() ? "caret-g-ink" : "caret-transparent"),
              )}
            />
            <button
              type="button"
              aria-label={t("aiCanvas.closeSearch")}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-g-sm text-g-ink-3 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
              onClick={() => {
                if (searchResults.length > 0) {
                  setSearchResults([]);
                  setSearchTotal(0);
                  setSearchSelectedIds(new Set());
                  setQuery("");
                } else {
                  setSearchOpen(false);
                }
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </form>

          {searchError && (
            <div className="rounded-g-sm border border-g-red/40 bg-g-red-soft px-2 py-1.5 text-g-caption text-g-red">
              {searchError}
            </div>
          )}

          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-g-out motion-reduce:transition-none",
              searchResults.length > 0
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <div className="flex items-center justify-between px-1.5 pb-0.5 text-g-chip font-[510] tracking-[0.02em] text-g-ink-4">
                <span>
                  {t("aiCanvas.searchResults", { count: searchTotal })}
                </span>
                {searchSelectedIds.size > 0 ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-g-pill bg-g-accent px-2 py-0.5 font-g text-[11px] font-[590] text-white transition-opacity duration-[100ms] ease-g hover:opacity-85 focus-visible:outline-none focus-visible:shadow-g-focus"
                    onClick={() => {
                      searchResults
                        .filter((a) => searchSelectedIds.has(a.id))
                        .forEach(addAsset);
                      setSearchResults([]);
                      setSearchTotal(0);
                      setSearchActiveIndex(-1);
                      setSearchSelectedIds(new Set());
                    }}
                  >
                    <Plus size={11} />
                    {t("imageTools.addSelected", {
                      count: searchSelectedIds.size,
                    })}
                  </button>
                ) : (
                  <span>{t("aiCanvas.addHint")}</span>
                )}
              </div>
              <div
                data-ai-canvas-scroll="true"
                className="max-h-[320px] overflow-y-auto"
              >
                {searchResults.map((asset, i) => {
                  const selected = searchSelectedIds.has(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      data-active={searchActiveIndex === i || undefined}
                      className={cn(
                        "group flex w-full items-center gap-2.5 px-1.5 py-1.5 text-left transition-colors duration-[100ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus data-[active]:bg-g-surface-2",
                        selected && "bg-g-accent-soft",
                        i === 0 && "rounded-t-g-sm",
                        i === searchResults.length - 1 && "rounded-b-g-sm",
                        i < searchResults.length - 1 &&
                          "border-b border-g-line/50",
                      )}
                      onMouseEnter={() => setSearchActiveIndex(i)}
                      onClick={() => {
                        setSearchSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(asset.id)) next.delete(asset.id);
                          else next.add(asset.id);
                          return next;
                        });
                      }}
                    >
                      <AssetThumbnail
                        src={asset.thumbnailUrl || asset.url}
                        size="sm"
                        className="size-8 rounded-g-sm"
                        imageClassName="select-none"
                        draggable={false}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-g-mono text-g-caption font-[510] tracking-g-mono text-g-ink">
                          {fileName(asset.repoPath)}
                        </span>
                        <span className="block truncate text-g-chip text-g-ink-3">
                          {asset.projectName} · {imageMeta(asset)}
                        </span>
                      </span>
                      {selected ? (
                        <Check size={14} className="shrink-0 text-g-accent" />
                      ) : (
                        <Plus
                          size={14}
                          className="shrink-0 text-g-ink-4 opacity-0 transition-opacity duration-[100ms] ease-g group-hover:opacity-100"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      ) : (
        <IconButton
          data-ai-canvas-overlay="true"
          size="md"
          aria-label={t("aiCanvas.openSearch")}
          className="pointer-events-auto absolute left-3 top-3 z-50 border border-g-line bg-g-surface shadow-g-pop animate-[canvasSearchIn_160ms_var(--g-ease-out)_both] motion-reduce:animate-none"
          onClick={() => setSearchOpen(true)}
        >
          <Search />
        </IconButton>
      )}

      <div
        data-ai-canvas-overlay="true"
        className="pointer-events-auto absolute right-3 top-3 z-50 flex items-center gap-1 rounded-g-lg bg-g-surface/75 p-1.5 shadow-g-pop backdrop-blur-xl"
      >
        {onExitCanvas && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<ArrowLeft />}
            onClick={onExitCanvas}
          >
            {t("aiCanvas.exitCanvas")}
          </Button>
        )}
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.zoomOut")}
          onClick={() => zoomCanvasBy(1 / 1.25)}
        >
          <ZoomOut />
        </IconButton>
        <Badge tone="line">{Math.round(viewport.scale * 100)}%</Badge>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.zoomIn")}
          onClick={() => zoomCanvasBy(1.25)}
        >
          <ZoomIn />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.centerView")}
          onClick={centerCanvasView}
        >
          <LocateFixed />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.commentMode")}
          data-active={commentMode || undefined}
          className={cn(commentMode && "bg-g-surface-3 text-g-ink")}
          onClick={() => setCommentMode((v) => !v)}
        >
          <MessageCircle />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.viewMode")}
          data-active={viewMode !== "normal" || undefined}
          className={cn(viewMode !== "normal" && "bg-g-surface-3 text-g-ink")}
          onClick={() => {
            setViewMode((m) =>
              m === "normal"
                ? "compact"
                : m === "compact"
                  ? "hidden"
                  : "normal",
            );
            setSelectedCardId(undefined);
          }}
        >
          {viewMode === "hidden" ? (
            <EyeOff />
          ) : viewMode === "compact" ? (
            <Layers3 />
          ) : (
            <Eye />
          )}
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.clear")}
          disabled={cards.length === 0}
          onClick={() => setClearConfirmOpen(true)}
        >
          <Trash2 />
        </IconButton>
      </div>

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

      <div
        data-ai-canvas-overlay="true"
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-[60] mx-auto max-w-[1120px] px-4 pb-3 text-white max-[760px]:px-2 max-[760px]:pb-2"
        style={{ height: composerCollapsed ? 92 : composerHeight }}
      >
        <div className="relative h-full">
          <div
            className={cn(
              "absolute inset-x-7 bottom-[52px] overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,28,0.78)] shadow-g-pop backdrop-blur-xl max-[760px]:inset-x-2 rounded-t-[24px] rounded-b-none border-b-0",
              composerCollapsed && "!h-[44px]",
            )}
            style={
              composerCollapsed ? undefined : { height: composerHeight - 72 }
            }
          >
            {!composerCollapsed && (
              <div
                className="flex h-3 cursor-ns-resize items-center justify-center"
                onPointerDown={(e) => {
                  e.preventDefault();
                  composerDragRef.current = {
                    startY: e.clientY,
                    startH: composerHeight,
                  };
                  const onMove = (ev: PointerEvent) => {
                    if (!composerDragRef.current) return;
                    const delta = composerDragRef.current.startY - ev.clientY;
                    const next = Math.min(
                      Math.max(composerDragRef.current.startH + delta, 200),
                      window.innerHeight * 0.75,
                    );
                    setComposerHeight(next);
                  };
                  const onUp = () => {
                    composerDragRef.current = null;
                    document.removeEventListener("pointermove", onMove);
                    document.removeEventListener("pointerup", onUp);
                  };
                  document.addEventListener("pointermove", onMove);
                  document.addEventListener("pointerup", onUp);
                }}
              >
                <div className="h-[3px] w-8 rounded-full bg-white/20" />
              </div>
            )}
            <button
              type="button"
              aria-label={t("aiCanvas.resizeComposer")}
              className="flex h-12 w-full shrink-0 items-center gap-3 px-5 text-left text-g-body text-white/62 transition-colors duration-[120ms] ease-g hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus"
              onClick={() => setComposerCollapsed((current) => !current)}
            >
              {isWorking && (
                <LoaderCircle
                  size={14}
                  className="shrink-0 animate-spin text-white/54"
                />
              )}
              <span className="shrink-0 font-[590] text-white/68">
                {composerStatusLabel}
              </span>
              <span className="min-w-0 flex-1 truncate text-white/58">
                {composerStatusText}
              </span>
              <ChevronDown
                size={17}
                className={cn(
                  "shrink-0 text-white/42 transition-transform duration-[160ms] ease-g",
                  !composerCollapsed && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            {!composerCollapsed && (
              <div
                ref={chatScrollRef}
                data-ai-canvas-scroll="true"
                className="flex h-[calc(100%-48px)] flex-col gap-2 overflow-y-auto px-5 pb-16"
              >
                {chatHistory.length === 0 ? (
                  <div className="py-4 text-center text-g-caption text-white/30">
                    {t("aiCanvas.emptyDesc")}
                  </div>
                ) : (
                  chatHistory.map((entry, i) => {
                    const isUser = entry.role === "user";
                    return (
                      <article
                        key={i}
                        className={cn(
                          "max-w-[calc(100%-16px)] rounded-g-lg border px-4 py-3 text-g-body leading-[1.55] text-white/84",
                          isUser
                            ? "self-end border-white/[0.1] bg-white/[0.12]"
                            : "self-start border-white/[0.06] bg-white/[0.06]",
                        )}
                      >
                        {entry.mentions && entry.mentions.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {entry.mentions.map((mention) => (
                              <span
                                key={mention.id}
                                className="inline-flex max-w-[200px] items-center gap-2 rounded-[12px] border border-white/[0.08] bg-black/[0.16] py-1 pl-1 pr-2"
                              >
                                <AssetThumbnail
                                  src={mention.src}
                                  size="sm"
                                  className="size-7 rounded-[9px] border-white/[0.1] bg-white/[0.06]"
                                  imageClassName="max-h-5 max-w-5"
                                  draggable={false}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-g-mono text-g-chip font-[510] tracking-g-mono text-white/86">
                                    @{mention.name}
                                  </span>
                                  <span className="block truncate text-[9px] leading-3 text-white/38">
                                    {mention.meta}
                                  </span>
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">
                          {renderMarkdown(entry.content)}
                        </div>
                        {!isUser && (
                          <div className="mt-3 flex items-center gap-1 border-t border-white/[0.05] pt-2 text-white/38">
                            <CopyButton
                              value={entry.content}
                              label={t("ai.copyResult")}
                              className="size-6 text-white/42 hover:bg-white/[0.08] hover:text-white"
                            />
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
                {isWorking && (
                  <div className="flex items-center gap-2 self-start rounded-g-md border border-white/[0.06] bg-white/[0.07] px-3 py-2 text-g-caption text-white/56">
                    <LoaderCircle size={12} className="animate-spin" />
                    {t("aiCanvas.statusProcessingDetail")}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[rgba(31,31,31,0.96)] px-2.5 py-2 shadow-g-pop backdrop-blur-xl">
            {composerToolsOpen && (
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3 text-g-caption text-white/58">
                {composerAdvancedOpen && (
                  <>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<AtSign />}
                      className={composerActionClass}
                      onClick={mentionSelectedAsset}
                    >
                      {t("aiCanvas.mentionAsset")}
                    </Button>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<Paperclip />}
                      className={composerActionClass}
                      onClick={noteUploadPending}
                    >
                      {t("aiCanvas.attachImage")}
                    </Button>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<CheckCircle2 />}
                      className={composerActionClass}
                      onClick={() =>
                        addAssistantCard(t("aiCanvas.describePrompt"))
                      }
                    >
                      {t("aiCanvas.describe")}
                    </Button>
                    <Badge tone={imageOptimizationAdvice ? "amber" : "line"}>
                      {imageOptimizationAdvice
                        ? t("aiCanvas.imageOptimizationAdviceShort")
                        : t("aiCanvas.autoReview")}
                    </Badge>
                    <Badge tone="line">{t("aiCanvas.modelHigh")}</Badge>
                  </>
                )}
              </div>
            )}
            {(selectedProposal?.status === "pending" ||
              pendingProposals.length > 0) && (
              <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2 mb-2">
                {selectedProposal?.status === "pending" ? (
                  <>
                    <Badge tone="amber">
                      {selectedProposal.tool.replaceAll("_", " ")}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-g-caption text-white/70">
                      {selectedProposal.description}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
                      leadingIcon={<XCircle />}
                      onClick={() => handleRejectProposal(selectedProposal)}
                    >
                      {t("aiCanvas.reject")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      leadingIcon={<Check />}
                      className={composerConfirmClass}
                      onClick={() => handleApproveProposal(selectedProposal)}
                    >
                      {t("aiCanvas.approve")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-g-caption text-white/50">
                      {t("aiCanvas.pendingProposals", {
                        count: pendingProposals.length,
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
                      onClick={() => {
                        for (const p of pendingProposals)
                          handleRejectProposal(p);
                      }}
                    >
                      {t("aiCanvas.rejectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className={composerConfirmClass}
                      onClick={() => {
                        for (const p of pendingProposals)
                          handleApproveProposal(p);
                      }}
                    >
                      {t("aiCanvas.approveAll")}
                    </Button>
                  </>
                )}
              </div>
            )}
            {mentionedImageCards.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {mentionedImageCards.map((card) => (
                  <span
                    key={card.id}
                    className="inline-flex max-w-[220px] items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.07] py-1 pl-1 pr-1.5 text-white/78"
                  >
                    <AssetThumbnail
                      src={card.src}
                      size="sm"
                      className="size-7 rounded-[10px] border-white/[0.1] bg-white/[0.06]"
                      imageClassName="max-h-5 max-w-5"
                      draggable={false}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-g-mono text-g-chip font-[510] tracking-g-mono">
                        @{card.name}
                      </span>
                      <span className="block truncate text-[9px] leading-3 text-white/38">
                        {card.meta}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={t("aiCanvas.removeMention")}
                      className="grid size-5 shrink-0 place-items-center rounded-full text-white/42 transition-colors duration-[120ms] ease-g hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus"
                      onClick={() =>
                        setMentionedCardIds((current) =>
                          current.filter((id) => id !== card.id),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex min-h-10 items-center gap-2 pl-1 pr-0.5">
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger asChild>
                  <IconButton
                    size="md"
                    aria-label={t("aiCanvas.addAttachment")}
                    className={composerIconClass}
                  >
                    <Plus />
                  </IconButton>
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.Content
                    align="start"
                    sideOffset={10}
                    className="z-[80] min-w-[220px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.96)] p-2 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
                  >
                    <DropdownMenuPrimitive.Item
                      onSelect={noteUploadPending}
                      className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-white/[0.1]"
                    >
                      <Paperclip size={14} className="shrink-0 text-white/54" />
                      <span>{t("aiCanvas.attachImage")}</span>
                    </DropdownMenuPrimitive.Item>
                    <div className="flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2 font-g text-white outline-none transition-colors duration-[120ms] ease-g hover:bg-white/[0.06]">
                      <WandSparkles
                        size={14}
                        className="shrink-0 text-white/54"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-g-ui font-[510]">
                          {t("aiCanvas.imageOptimizationAdvice")}
                        </div>
                        <div className="mt-0.5 text-g-caption text-white/42">
                          {t("aiCanvas.imageOptimizationAdviceDesc")}
                        </div>
                      </div>
                      <Switch
                        checked={imageOptimizationAdvice}
                        onCheckedChange={setImageOptimizationAdvice}
                        aria-label={t("aiCanvas.imageOptimizationAdvice")}
                        className="data-[state=checked]:!bg-g-amber-soft"
                      />
                    </div>
                    <DropdownMenuPrimitive.Separator className="mx-2 my-2 h-px bg-white/[0.1]" />
                    <DropdownMenuPrimitive.Item
                      disabled={chatHistory.length === 0}
                      onSelect={clearChatHistory}
                      className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-1.5 font-g text-g-ui font-[510] text-white outline-none transition-colors duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]"
                    >
                      <Trash2 size={14} className="shrink-0 text-white/54" />
                      <span>{t("aiCanvas.clearChat")}</span>
                    </DropdownMenuPrimitive.Item>
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger asChild>
                  <IconButton
                    size="sm"
                    aria-label={t("aiCanvas.mentionAsset")}
                    className={composerIconClass}
                  >
                    <AtSign />
                  </IconButton>
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.Content
                    align="start"
                    sideOffset={10}
                    className="z-[80] min-w-[280px] max-w-[360px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.96)] p-2 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
                  >
                    <DropdownMenuPrimitive.Label className="px-3 py-1.5 font-g text-g-caption font-[510] tracking-g-ui text-white/38">
                      {t("aiCanvas.mentionCanvasImage")}
                    </DropdownMenuPrimitive.Label>
                    {mentionableImageCards.length === 0 ? (
                      <div className="px-3 py-2 text-g-caption text-white/42">
                        {t("aiCanvas.noMentionImages")}
                      </div>
                    ) : (
                      mentionableImageCards.map((card) => (
                        <DropdownMenuPrimitive.Item
                          key={card.id}
                          onSelect={() => mentionImageCard(card.id)}
                          className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[12px] px-2 py-1.5 font-g text-white outline-none transition-colors duration-[120ms] ease-g data-[highlighted]:bg-white/[0.1]"
                        >
                          <AssetThumbnail
                            src={card.src}
                            size="sm"
                            className="size-8 rounded-[10px] border-white/[0.1] bg-white/[0.06]"
                            imageClassName="max-h-6 max-w-6"
                            draggable={false}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-g-mono text-g-caption font-[510] tracking-g-mono text-white/86">
                              {card.name}
                            </span>
                            <span className="block truncate text-g-chip text-white/42">
                              {card.meta}
                            </span>
                          </span>
                          {mentionedCardIds.includes(card.id) && (
                            <Check size={14} className="shrink-0 text-white" />
                          )}
                        </DropdownMenuPrimitive.Item>
                      ))
                    )}
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
              <textarea
                value={prompt}
                placeholder={t("aiCanvas.composerPlaceholder")}
                className="max-h-20 min-h-5 flex-1 resize-none border-0 bg-transparent py-0 font-g-mono text-g-body leading-5 text-white outline-none placeholder:text-white/35"
                rows={1}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void handleAsk();
                  }
                }}
              />
              {aiBackendLabel && (
                <DropdownMenuPrimitive.Root>
                  <DropdownMenuPrimitive.Trigger asChild>
                    <button
                      type="button"
                      disabled={
                        aiBackendPending ||
                        !onAiBackendChange ||
                        aiBackendOptions.length === 0
                      }
                      className="flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 truncate rounded-full px-2 font-g text-g-caption font-[510] tracking-g-ui text-white/72 transition-colors duration-[120ms] ease-g hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="truncate">{aiBackendLabel}</span>
                      <ChevronDown
                        size={14}
                        className="shrink-0 text-white/42"
                        aria-hidden="true"
                      />
                    </button>
                  </DropdownMenuPrimitive.Trigger>
                  <DropdownMenuPrimitive.Portal>
                    <DropdownMenuPrimitive.Content
                      align="end"
                      sideOffset={10}
                      className="z-[80] min-w-[240px] max-w-[360px] overflow-auto rounded-[18px] border border-white/[0.08] bg-[rgba(42,42,42,0.98)] p-3 shadow-g-pop backdrop-blur-xl animate-[modalIn_120ms_var(--g-ease-out)]"
                      style={{ maxHeight: 320 }}
                    >
                      {groupedBackendOptions.map((group, groupIndex) => (
                        <DropdownMenuPrimitive.Group key={group.group}>
                          {groupIndex > 0 && (
                            <DropdownMenuPrimitive.Separator className="mx-2 my-2 h-px bg-white/[0.12]" />
                          )}
                          <DropdownMenuPrimitive.Label className="px-3 py-1 font-g text-g-caption font-[510] tracking-g-ui text-white/38">
                            {group.group}
                          </DropdownMenuPrimitive.Label>
                          {group.options.map((option) => {
                            const selected = option.value === aiBackendValue;
                            return (
                              <DropdownMenuPrimitive.Item
                                key={option.value}
                                disabled={option.disabled || aiBackendPending}
                                onSelect={() =>
                                  onAiBackendChange?.(option.value)
                                }
                                className={cn(
                                  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-1.5 font-g text-g-ui font-[510] leading-[1.35] text-white outline-none transition-[background,color,box-shadow] duration-[120ms] ease-g data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38] data-[highlighted]:bg-white/[0.1]",
                                  selected && "bg-white/[0.13]",
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {option.label}
                                </span>
                                <span className="grid size-4 shrink-0 place-items-center text-white">
                                  {selected && <Check size={15} />}
                                </span>
                              </DropdownMenuPrimitive.Item>
                            );
                          })}
                        </DropdownMenuPrimitive.Group>
                      ))}
                    </DropdownMenuPrimitive.Content>
                  </DropdownMenuPrimitive.Portal>
                </DropdownMenuPrimitive.Root>
              )}
              {isWorking ? (
                <button
                  type="button"
                  aria-label={t("aiCanvas.stopChat")}
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-white/70 bg-white/[0.92] text-black transition-colors duration-[120ms] ease-g hover:bg-white focus-visible:outline-none focus-visible:shadow-g-focus"
                  onClick={handleStop}
                >
                  <Square size={15} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("aiCanvas.ask")}
                  disabled={prompt.trim() === ""}
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-white/70 bg-white/[0.82] text-black transition-colors duration-[120ms] ease-g hover:bg-white focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
                  onClick={() => void handleAsk()}
                >
                  <ArrowUp size={20} strokeWidth={2.1} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {debugOpen && (
        <div
          data-ai-canvas-overlay="true"
          className="pointer-events-auto absolute right-3 bottom-[160px] z-[70] max-h-[60vh] w-[420px] overflow-auto rounded-g-md border border-white/10 bg-[rgba(20,20,20,0.95)] p-3 font-mono text-[11px] leading-[1.5] text-green-400 shadow-g-pop backdrop-blur-xl"
          data-ai-canvas-scroll="true"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between text-white/60">
            <span className="font-[590] uppercase tracking-wider">
              Canvas Debug
            </span>
            <div className="flex items-center gap-2">
              <CopyButton
                value={JSON.stringify(
                  {
                    version: 1,
                    viewport,
                    selectedCardId,
                    cardWidths,
                    cards: cards.map((c) => {
                      const base: Record<string, unknown> = {
                        id: c.id,
                        kind: c.kind,
                        x: Math.round(c.x),
                        y: Math.round(c.y),
                        width: cardWidths[c.id] ?? CARD_WIDTH,
                      };
                      if (c.kind === "asset") {
                        base.assetId = c.asset.id;
                        base.repoPath = c.asset.repoPath;
                      }
                      if (c.kind === "proposal") {
                        base.tool = c.tool;
                        base.status = c.status;
                      }
                      if (c.kind === "comment") {
                        base.anchor = c.anchorId;
                        base.text = c.text;
                        base.region = c.region;
                      }
                      return base;
                    }),
                    chatHistory,
                  },
                  null,
                  2,
                )}
                size="sm"
                className="text-white/40 hover:text-white"
              />
              <button
                type="button"
                className="text-white/40 hover:text-white"
                onClick={() => setDebugOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(
              {
                viewport,
                selectedCardId,
                working,
                cardsCount: cards.length,
                cardWidths,
                cardKinds: cards.map((c) => `${c.kind}:${c.id.slice(0, 8)}`),
                chatHistoryCount: chatHistory.length,
                aiCursor,
                cards: cards.map((c) => {
                  const base: Record<string, unknown> = {
                    id: c.id,
                    kind: c.kind,
                    x: Math.round(c.x),
                    y: Math.round(c.y),
                    width: cardWidths[c.id] ?? CARD_WIDTH,
                  };
                  if (c.kind === "asset") {
                    base.assetId = c.asset.id;
                    base.repoPath = c.asset.repoPath;
                  }
                  if (c.kind === "proposal") {
                    base.tool = c.tool;
                    base.status = c.status;
                  }
                  if (c.kind === "comment") {
                    base.anchor = c.anchorId;
                    base.text = c.text?.slice(0, 40);
                  }
                  return base;
                }),
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

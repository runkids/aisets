import {
  ArrowLeft,
  ArrowUp,
  AtSign,
  Check,
  CheckCircle2,
  Eye,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Maximize2,
  X,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getCatalogItems, previewImageUrl } from "@/api";
import { request } from "@/api/client";
import {
  previewImageToolAssets,
  renderImageToolPreview,
} from "@/api/imageTools";
import {
  AssetThumbnail,
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  TextInput,
} from "@/components/ui";
import {
  canvasChat,
  serializeCanvasSnapshot,
  type CanvasChatEvent,
} from "@/api/canvasChat";
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
  type ProposalStatus,
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
import { useCanvasDrag } from "./useCanvasDrag";
import { useProposalExecution } from "./useProposalExecution";

const ASSET_CARD_IMAGE_TOP = 38;
const ASSET_CARD_IMAGE_HEIGHT = 240;

type Props = {
  scanId?: number;
  aiEnabled: boolean;
  aiNickname?: string;
  onOpenAsset?: (assetId: string) => void;
  onExitCanvas?: () => void;
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

export function AICanvasView({
  scanId,
  aiEnabled,
  aiNickname,
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
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkingState>("idle");
  const [composerCollapsed, setComposerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem("aisets.canvas.collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [composerPreviewOpen, setComposerPreviewOpen] = useState(false);
  const [composerAdvancedOpen, setComposerAdvancedOpen] = useState(false);
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(320);
  const composerDragRef = useRef<{ startY: number; startH: number } | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<{
    cardId: string;
    x: number;
    y: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchResultsRef = useRef<Array<{ id: string; repoPath: string }>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
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

      const targetX =
        anchorPosition.x + CARD_WIDTH * (card.region.x + card.region.width / 2);
      const targetY =
        anchorPosition.y +
        ASSET_CARD_IMAGE_TOP +
        ASSET_CARD_IMAGE_HEIGHT * (card.region.y + card.region.height / 2);
      const fromX =
        commentPosition.x < targetX
          ? commentPosition.x + CARD_WIDTH
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
  }, [cards, dragPreview, selectedCardId]);
  const selectedLabel =
    selectedAssets.length > 0
      ? selectedAssets.map((card) => fileName(card.asset.repoPath)).join(", ")
      : t("aiCanvas.noSelection");
  const { handleApproveProposal, handleRejectProposal } =
    useProposalExecution({ cards, t, setCards });
  const isWorking = working !== "idle";
  const composerToolsOpen = composerPreviewOpen || composerAdvancedOpen;
  const latestChatContent = chatHistory.at(-1)?.content ?? "";
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
    });
  }, [cards, selectedCardId, viewport, chatHistory]);

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
    if (!scanId) {
      setSearchError(t("aiCanvas.missingScan"));
      return;
    }
    setWorking("search");
    setSearchError("");
    try {
      const page = await getCatalogItems({ scanId, q, limit: 18 });
      setSearchResults(page.items);
      setSearchTotal(page.total);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : t("aiCanvas.searchError"),
      );
    } finally {
      setWorking("idle");
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

  function addComment(
    assetCard: AssetCanvasCard,
    text = prompt.trim(),
    region?: { x: number; y: number; width: number; height: number },
  ) {
    const id = createCanvasCardId("comment");
    const card: CommentCanvasCard = {
      id,
      kind: "comment",
      x: assetCard.x + CARD_WIDTH + 24,
      y: assetCard.y + 32,
      createdAt: nowISO(),
      anchorId: assetCard.id,
      text: text || t("aiCanvas.defaultComment"),
      region: region ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    };
    setCards((current) => [...current, card]);
    setSelectedCardId(id);
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

  async function handleAsk() {
    const promptText = prompt.trim();
    if (!promptText) return;
    setPrompt("");
    setError("");
    setWorking("ai");

    setChatHistory((prev) => [
      ...prev.slice(-9),
      { role: "user", content: promptText },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;

    const messages: ChatHistoryEntry[] = [
      ...chatHistory,
      { role: "user", content: promptText },
    ];
    const snapshot = serializeCanvasSnapshot(cards, selectedCardId, viewport);

    let assistantText = "";
    const newCards: CanvasCard[] = [];

    function handleEvent(event: CanvasChatEvent) {
      if (event.type === "focus" && event.cardId) {
        const target = cards.find((c) => c.id === event.cardId);
        if (target) {
          setAiCursor({
            x: target.x + CARD_WIDTH / 2,
            y: target.y - 24,
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
        assistantText += (assistantText ? "\n\n" : "") + event.content;
      }
      if (event.type === "proposal") {
        const selectedCard = cards.find((c) => c.id === selectedCardId);
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
      if (event.type === "action_result" && event.tool === "focus_card") {
        const result = event.result as { cardId?: string; label?: string };
        if (result?.cardId) {
          const target = cards.find((c) => c.id === result.cardId);
          if (target) {
            setAiCursor({
              x: target.x + CARD_WIDTH / 2,
              y: target.y - 24,
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
          const anchor = cards.find((c) => c.id === r.anchorCardId);
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
      if (event.type === "action_result" && event.tool === "search_assets") {
        const r = event.result as {
          q?: string;
          items?: Array<{ id: string; repoPath: string }>;
        };
        if (r?.items?.length) {
          for (const it of r.items) {
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
        locale: "zh-TW",
        onEvent: handleEvent,
        signal: abort.signal,
      });

      if (assistantText) {
        setChatHistory((prev) => [
          ...prev.slice(-10),
          { role: "assistant", content: assistantText },
        ]);
      }

      if (searchResultsRef.current.length > 0 && scanId) {
        try {
          const wanted = [...searchResultsRef.current];
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
            const exists = cards.some(
              (c): c is AssetCanvasCard =>
                c.kind === "asset" && c.asset.id === asset.id,
            );
            if (exists) continue;
            const pos = nextCardPosition(
              cards.length + newCards.length + addedCards.length,
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
      setAiCursor((prev) => ({ ...prev, status: "idle", label: undefined }));
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function clearCanvas() {
    setCards([]);
    setSelectedCardId(undefined);
    setChatHistory([]);
    setError("");
    setClearConfirmOpen(false);
  }

  function appendPromptToken(token: string) {
    setPrompt((current) => {
      const trimmed = current.trimEnd();
      return trimmed ? `${trimmed} ${token}` : token;
    });
  }

  function mentionSelectedAsset() {
    const target = selectedAssets[0];
    appendPromptToken(
      "@" +
        (target
          ? fileName(target.asset.repoPath)
          : t("aiCanvas.selectedMention")),
    );
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
        className="absolute inset-0 cursor-default overscroll-none overflow-hidden"
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
          {commentConnectors.length > 0 && (
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
          {cards.map((card) => (
            <CardShell
              key={card.id}
              card={card}
              selected={selectedCardId === card.id}
              onSelect={setSelectedCardId}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDelete={deleteCard}
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
          ))}
          <AICursor
            position={{ x: aiCursor.x, y: aiCursor.y }}
            label={aiCursor.label}
            status={aiCursor.status}
            nickname={aiNickname}
          />
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
          className="pointer-events-auto absolute left-3 top-3 z-20 flex w-[min(620px,calc(100%-24px))] flex-col gap-1 rounded-g-md border border-g-line bg-g-surface/95 p-1 shadow-g-md backdrop-blur"
        >
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <TextInput
              value={query}
              variant="search"
              icon={<Search size={14} />}
              placeholder={t("aiCanvas.searchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="submit"
              size="md"
              variant="primary"
              disabled={working === "search"}
              leadingIcon={
                working === "search" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Search />
                )
              }
            >
              {t("aiCanvas.search")}
            </Button>
            <IconButton
              size="sm"
              aria-label={t("aiCanvas.closeSearch")}
              className="text-g-ink-3 hover:text-g-ink"
              onClick={() => setSearchOpen(false)}
            >
              <X size={14} />
            </IconButton>
          </form>

          {searchError && (
            <div className="rounded-g-sm border border-g-red/40 bg-g-red-soft px-2 py-1.5 text-g-caption text-g-red">
              {searchError}
            </div>
          )}

          {searchResults.length > 0 && (
            <>
              <div className="flex items-center justify-between text-g-caption text-g-ink-3">
                <span>
                  {t("aiCanvas.searchResults", { count: searchTotal })}
                </span>
                <span>{t("aiCanvas.addHint")}</span>
              </div>
              <div
                data-ai-canvas-scroll="true"
                className="max-h-[320px] overflow-y-auto"
              >
                {searchResults.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-g-md px-2 py-2 text-left transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
                    onClick={() => addAsset(asset)}
                  >
                    <AssetThumbnail
                      src={asset.thumbnailUrl || asset.url}
                      size="sm"
                      className="size-10"
                      imageClassName="select-none"
                      draggable={false}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-g-caption font-[590] text-g-ink">
                        {fileName(asset.repoPath)}
                      </span>
                      <span className="block truncate text-g-caption text-g-ink-3">
                        {asset.projectName} · {imageMeta(asset)}
                      </span>
                    </span>
                    <Plus size={14} className="shrink-0 text-g-ink-3" />
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      ) : (
        <IconButton
          data-ai-canvas-overlay="true"
          size="md"
          aria-label={t("aiCanvas.openSearch")}
          className="pointer-events-auto absolute left-3 top-3 z-20 border border-g-line bg-g-surface shadow-g-md"
          onClick={() => setSearchOpen(true)}
        >
          <Search />
        </IconButton>
      )}

      <div
        data-ai-canvas-overlay="true"
        className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-g-md border border-g-line bg-g-surface p-1 shadow-g-md"
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
          onClick={() =>
            setViewport((current) => ({
              ...current,
              scale: clampCanvasScale(current.scale - 0.12),
            }))
          }
        >
          <ZoomOut />
        </IconButton>
        <Badge tone="line">{Math.round(viewport.scale * 100)}%</Badge>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.zoomIn")}
          onClick={() =>
            setViewport((current) => ({
              ...current,
              scale: clampCanvasScale(current.scale + 0.12),
            }))
          }
        >
          <ZoomIn />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("aiCanvas.resetView")}
          onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
        >
          <Maximize2 />
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
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 mx-auto max-w-[1120px] px-4 pb-3 text-white max-[760px]:px-2 max-[760px]:pb-2"
        style={{ height: composerCollapsed ? 130 : composerHeight }}
      >
        <div className="relative h-full">
          <div
            className={cn(
              "absolute inset-x-7 bottom-[70px] overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,28,0.78)] shadow-g-pop backdrop-blur-xl max-[760px]:inset-x-2 rounded-t-[24px] rounded-b-none border-b-0",
              composerCollapsed && "!h-12",
            )}
            style={
              composerCollapsed ? undefined : { height: composerHeight - 90 }
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
              {isWorking ? (
                <LoaderCircle
                  size={14}
                  className="shrink-0 animate-spin text-g-purple"
                />
              ) : (
                <span>{t("aiCanvas.processed", { time: "" })}</span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {isWorking
                  ? "AI thinking…"
                  : error ||
                    (chatHistory.length > 0
                      ? chatHistory.at(-1)?.content
                      : selectedLabel)}
              </span>
              <span className="text-white/42">
                {composerCollapsed ? "›" : "⌄"}
              </span>
            </button>
            {!composerCollapsed && (
              <div
                ref={chatScrollRef}
                data-ai-canvas-scroll="true"
                className="flex h-[calc(100%-48px)] flex-col gap-2 overflow-y-auto px-5 pb-3"
              >
                {chatHistory.length === 0 ? (
                  <div className="py-4 text-center text-g-caption text-white/30">
                    {t("aiCanvas.emptyDesc")}
                  </div>
                ) : (
                  chatHistory.map((entry, i) => (
                    <div
                      key={i}
                      className={cn(
                        "max-w-[80%] rounded-g-md px-3 py-2 text-g-caption leading-[1.5]",
                        entry.role === "user"
                          ? "self-end bg-white/[0.08] text-white/80"
                          : "self-start bg-g-purple/20 text-white/70",
                      )}
                    >
                      <div className="mb-1 text-[10px] font-[590] uppercase tracking-wider text-white/40">
                        {entry.role === "user" ? "You" : "AI"}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {renderMarkdown(entry.content)}
                      </div>
                    </div>
                  ))
                )}
                {isWorking && (
                  <div className="flex items-center gap-2 self-start rounded-g-md bg-g-purple/20 px-3 py-2 text-g-caption text-white/50">
                    <LoaderCircle size={12} className="animate-spin" />
                    AI thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 rounded-[32px] border border-[rgba(255,255,255,0.08)] bg-[rgba(31,31,31,0.96)] px-3 py-3 shadow-g-pop backdrop-blur-xl">
            {composerToolsOpen && (
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3 text-g-caption text-white/58">
                {composerPreviewOpen && (
                  <>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<ImagePlus />}
                      disabled={selectedAssets.length === 0 || isWorking}
                      className="border-white/[0.08] bg-white/[0.06] text-white hover:bg-white/[0.1]"
                      onClick={() => {
                        const target = selectedAssets[0];
                        if (target) void createImagePreview(target, "");
                      }}
                    >
                      {t("aiCanvas.previewWebp")}
                    </Button>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<Layers3 />}
                      disabled={selectedAssets.length === 0 || isWorking}
                      className="border-white/[0.08] bg-white/[0.06] text-white hover:bg-white/[0.1]"
                      onClick={() =>
                        void createOperationPreview(
                          selectedAssets,
                          t("aiCanvas.safeVariantPrompt"),
                        )
                      }
                    >
                      {t("aiCanvas.safeVariant")}
                    </Button>
                    <Badge tone="green">{t("aiCanvas.previewOnly")}</Badge>
                  </>
                )}
                {composerAdvancedOpen && (
                  <>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<AtSign />}
                      className="border-white/[0.08] bg-white/[0.06] text-white hover:bg-white/[0.1]"
                      onClick={mentionSelectedAsset}
                    >
                      {t("aiCanvas.mentionAsset")}
                    </Button>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<Paperclip />}
                      className="border-white/[0.08] bg-white/[0.06] text-white hover:bg-white/[0.1]"
                      onClick={noteUploadPending}
                    >
                      {t("aiCanvas.attachImage")}
                    </Button>
                    <Button
                      size="sm"
                      variant="chip"
                      leadingIcon={<CheckCircle2 />}
                      className="border-white/[0.08] bg-white/[0.06] text-white hover:bg-white/[0.1]"
                      onClick={() =>
                        addAssistantCard(t("aiCanvas.describePrompt"))
                      }
                    >
                      {t("aiCanvas.describe")}
                    </Button>
                    <Badge tone="line">{t("aiCanvas.autoReview")}</Badge>
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
                      className="border-white/[0.08] text-white/60 hover:bg-white/[0.08] hover:text-white"
                      leadingIcon={<XCircle />}
                      onClick={() => handleRejectProposal(selectedProposal)}
                    >
                      {t("aiCanvas.reject")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      leadingIcon={<Check />}
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
                      className="border-white/[0.08] text-white/60 hover:bg-white/[0.08] hover:text-white"
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
            <div className="flex h-12 items-center gap-2">
              <IconButton
                size="md"
                aria-label={t("aiCanvas.addAttachment")}
                className="rounded-full border-transparent bg-transparent text-white/58 hover:bg-white/[0.08] hover:text-white"
                onClick={noteUploadPending}
              >
                <Plus />
              </IconButton>
              <IconButton
                size="sm"
                aria-label={t("aiCanvas.mentionAsset")}
                className="rounded-full border-transparent bg-transparent text-white/58 hover:bg-white/[0.08] hover:text-white"
                onClick={mentionSelectedAsset}
              >
                <AtSign />
              </IconButton>
              <textarea
                value={prompt}
                placeholder={t("aiCanvas.composerPlaceholder")}
                className="min-h-6 flex-1 resize-none border-0 bg-transparent py-0 font-g-mono text-g-body leading-6 text-white outline-none placeholder:text-white/35"
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
              <IconButton
                size="sm"
                aria-label={t("aiCanvas.previewTools")}
                className={cn(
                  "rounded-full border-transparent bg-transparent text-white/58 hover:bg-white/[0.08] hover:text-white",
                  composerPreviewOpen && "bg-white/[0.1] text-white",
                )}
                onClick={() => setComposerPreviewOpen((current) => !current)}
              >
                <Eye />
              </IconButton>
              <IconButton
                size="sm"
                aria-label={t("aiCanvas.advancedChat")}
                className={cn(
                  "rounded-full border-transparent bg-transparent text-white/58 hover:bg-white/[0.08] hover:text-white",
                  composerAdvancedOpen && "bg-white/[0.1] text-white",
                )}
                onClick={() => setComposerAdvancedOpen((current) => !current)}
              >
                <SlidersHorizontal />
              </IconButton>
              {isWorking ? (
                <IconButton
                  size="md"
                  aria-label={t("aiCanvas.stopChat")}
                  className="rounded-full border-g-red bg-g-red text-white hover:bg-g-red/90"
                  onClick={handleStop}
                >
                  <Square size={14} />
                </IconButton>
              ) : (
                <IconButton
                  size="md"
                  aria-label={t("aiCanvas.ask")}
                  disabled={prompt.trim() === ""}
                  className="rounded-full border-white bg-white text-black hover:bg-white/90 disabled:opacity-[0.38]"
                  onClick={() => void handleAsk()}
                >
                  <ArrowUp />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </div>

      {debugOpen && (
        <div
          data-ai-canvas-overlay="true"
          className="pointer-events-auto absolute right-3 bottom-[160px] z-40 max-h-[60vh] w-[420px] overflow-auto rounded-g-md border border-white/10 bg-[rgba(20,20,20,0.95)] p-3 font-mono text-[11px] leading-[1.5] text-green-400 shadow-g-pop backdrop-blur-xl"
          data-ai-canvas-scroll="true"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between text-white/60">
            <span className="font-[590] uppercase tracking-wider">
              Canvas Debug
            </span>
            <button
              type="button"
              className="text-white/40 hover:text-white"
              onClick={() => setDebugOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(
              {
                viewport,
                selectedCardId,
                working,
                cardsCount: cards.length,
                cardKinds: cards.map((c) => `${c.kind}:${c.id.slice(0, 8)}`),
                chatHistoryCount: chatHistory.length,
                aiCursor,
                cards: cards.map((c) => {
                  const base: Record<string, unknown> = {
                    id: c.id,
                    kind: c.kind,
                    x: Math.round(c.x),
                    y: Math.round(c.y),
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

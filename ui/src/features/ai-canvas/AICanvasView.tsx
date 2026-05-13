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
  MessageSquarePlus,
  MousePointer2,
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { getCatalogItems, previewImageUrl } from "@/api";
import {
  previewImageToolAssets,
  renderImageToolPreview,
  type ImageToolSettings,
} from "@/api/imageTools";
import {
  AssetThumbnail,
  Badge,
  Button,
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
import { fileName, formatBytes, formatExt } from "@/ui";
import {
  buildAssistantBullets,
  cardDisplayName,
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

type Props = {
  scanId?: number;
  aiEnabled: boolean;
  onOpenAsset?: (assetId: string) => void;
  onExitCanvas?: () => void;
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

const DEFAULT_IMAGE_TOOL_SETTINGS: ImageToolSettings = {
  outputFormat: "webp",
  quality: 82,
  maxDimensionPx: 1600,
  outputMode: "safeVariants",
};

const CARD_WIDTH = 320;

type CanvasSelection = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

function nowISO() {
  return new Date().toISOString();
}

function nextCardPosition(count: number) {
  return {
    x: 84 + (count % 5) * 34,
    y: 72 + (count % 4) * 42,
  };
}

function selectedAssetIds(cards: AssetCanvasCard[]) {
  return cards.map((card) => card.asset.id);
}

function commentIds(cards: CommentCanvasCard[]) {
  return cards.map((card) => card.id);
}

function imageMeta(asset: AssetItem) {
  return `${asset.image.width}x${asset.image.height} · ${formatBytes(asset.bytes)}`;
}

function tagLabel(asset: AssetItem) {
  return asset.aiTag?.tags?.slice(0, 4).join(", ") || "";
}

function selectionBounds(selection: CanvasSelection) {
  const left = Math.min(selection.startX, selection.currentX);
  const top = Math.min(selection.startY, selection.currentY);
  return {
    left,
    top,
    width: Math.abs(selection.currentX - selection.startX),
    height: Math.abs(selection.currentY - selection.startY),
  };
}

function intersects(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function cardTone(card: CanvasCard) {
  if (card.kind === "asset") return "border-g-line";
  if (card.kind === "comment") return "border-g-amber/50";
  if (card.kind === "assistant") return "border-g-purple/50";
  if (card.kind === "variant") return "border-g-blue/50";
  return "border-g-green/50";
}

function CardShell({
  card,
  selected,
  children,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDelete,
  onRegister,
}: {
  card: CanvasCard;
  selected: boolean;
  children: ReactNode;
  onSelect: (id: string) => void;
  onDragStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) => void;
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDelete: (card: CanvasCard) => void;
  onRegister: (id: string, node: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <section
      className={cn(
        "absolute w-[320px] touch-none select-none overflow-hidden rounded-g-md border bg-g-surface shadow-g-md transition-[border-color,box-shadow] duration-[120ms] ease-g",
        cardTone(card),
        selected && "border-g-active-bg shadow-g-lg",
      )}
      ref={(node) => onRegister(card.id, node)}
      style={{ transform: `translate(${card.x}px, ${card.y}px)` }}
      data-ai-canvas-card="true"
      data-selected={selected || undefined}
      onPointerDown={() => onSelect(card.id)}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 border-b border-g-line bg-g-surface-2 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(event) => onDragStart(event, card)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="flex min-w-0 items-center gap-2 text-g-caption font-[590] tracking-g-ui text-g-ink-2">
          <MousePointer2 size={13} />
          <span className="truncate">{cardDisplayName(card)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge tone={selected ? "accent" : "line"}>{card.kind}</Badge>
          <IconButton
            size="sm"
            aria-label={t("aiCanvas.deleteCard")}
            className="size-6 text-g-ink-3 hover:text-g-red"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(card);
            }}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
      {children}
    </section>
  );
}

function AssetCardBody({
  card,
  comments,
  onOpenAsset,
  onSelectComment,
  onCreateComment,
  onRenderPreview,
  onOperationPreview,
  working,
}: {
  card: AssetCanvasCard;
  comments: CommentCanvasCard[];
  onOpenAsset?: (assetId: string) => void;
  onSelectComment: (commentId: string) => void;
  onCreateComment: (assetCard: AssetCanvasCard) => void;
  onRenderPreview: (assetCard: AssetCanvasCard) => void;
  onOperationPreview: (assetCard: AssetCanvasCard) => void;
  working: boolean;
}) {
  const { t } = useTranslation();
  const asset = card.asset;
  const tags = tagLabel(asset);

  return (
    <div className="flex flex-col">
      <div className="relative aspect-[4/3] bg-g-surface-2">
        <img
          src={asset.thumbnailUrl || asset.url}
          alt={fileName(asset.repoPath)}
          className="size-full select-none object-contain p-3"
          draggable={false}
          loading="lazy"
        />
        {comments.map((comment) => (
          <button
            key={comment.id}
            type="button"
            aria-label={comment.text || t("aiCanvas.commentCard")}
            className="absolute rounded-g-sm border-2 border-g-amber bg-transparent shadow-g-sm transition-colors duration-[120ms] ease-g hover:bg-g-amber-soft/20 focus-visible:outline-none focus-visible:shadow-g-focus"
            style={{
              left: `${comment.region.x * 100}%`,
              top: `${comment.region.y * 100}%`,
              width: `${comment.region.width * 100}%`,
              height: `${comment.region.height * 100}%`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectComment(comment.id);
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="min-w-0">
          <div className="truncate text-g-body font-[590] tracking-g-ui text-g-ink">
            {fileName(asset.repoPath)}
          </div>
          <div className="mt-1 truncate text-g-caption text-g-ink-3">
            {asset.repoPath}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone="line">{formatExt(asset.ext)}</Badge>
          <Badge tone="line">{imageMeta(asset)}</Badge>
          {asset.usedBy.length > 0 && (
            <Badge tone="green">
              {t("aiCanvas.references", { count: asset.usedBy.length })}
            </Badge>
          )}
          {tags && <Badge tone="purple">{tags}</Badge>}
        </div>

        {asset.aiTag?.description && (
          <p className="line-clamp-2 text-g-caption leading-[1.45] text-g-ink-3">
            {asset.aiTag.description}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<ImagePlus />}
            disabled={working}
            onClick={() => onRenderPreview(card)}
          >
            {t("aiCanvas.previewWebp")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Layers3 />}
            disabled={working}
            onClick={() => onOperationPreview(card)}
          >
            {t("aiCanvas.safeVariant")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<MessageSquarePlus />}
            onClick={() => onCreateComment(card)}
          >
            {t("aiCanvas.comment")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!onOpenAsset}
            onClick={() => onOpenAsset?.(asset.id)}
          >
            {t("aiCanvas.openAsset")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentCardBody({ card }: { card: CommentCanvasCard }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <Badge tone="amber">{t("aiCanvas.pinnedRegion")}</Badge>
      <p className="whitespace-pre-wrap text-g-body leading-[1.45] text-g-ink">
        {card.text || t("aiCanvas.emptyComment")}
      </p>
      <div className="grid grid-cols-4 gap-1 text-center font-g-mono text-[10px] tracking-g-mono text-g-ink-3">
        <span>x {Math.round(card.region.x * 100)}%</span>
        <span>y {Math.round(card.region.y * 100)}%</span>
        <span>w {Math.round(card.region.width * 100)}%</span>
        <span>h {Math.round(card.region.height * 100)}%</span>
      </div>
    </div>
  );
}

function AssistantCardBody({
  card,
}: {
  card: Extract<CanvasCard, { kind: "assistant" }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge tone="purple">{t("aiCanvas.aiContext")}</Badge>
        <span className="truncate text-g-caption text-g-ink-3">
          {card.assetIds.length > 0
            ? t("aiCanvas.selectedAssets", { count: card.assetIds.length })
            : t("aiCanvas.noSelection")}
        </span>
      </div>
      <p className="text-g-body leading-[1.45] text-g-ink">{card.message}</p>
      <ul className="flex flex-col gap-1.5">
        {card.bullets.map((bullet) => (
          <li
            key={bullet}
            className="rounded-g-sm bg-g-surface-2 px-2 py-1.5 text-g-caption leading-[1.45] text-g-ink-2"
          >
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VariantCardBody({ card }: { card: VariantCanvasCard }) {
  const { t } = useTranslation();
  const savings = card.inputBytes - card.outputBytes;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="aspect-[4/3] overflow-hidden rounded-g-md border border-g-line bg-g-surface-2">
        <img
          src={card.previewUrl}
          alt={card.sourceName}
          className="size-full select-none object-contain p-3"
          draggable={false}
          loading="lazy"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="blue">
          {t("aiCanvas.renderedPreview", {
            input: card.inputFormat.toUpperCase(),
            output: card.outputFormat.toUpperCase(),
          })}
        </Badge>
        <Badge tone={savings > 0 ? "green" : "line"}>
          {card.inputBytes > 0 && card.outputBytes > 0
            ? `${formatBytes(card.inputBytes)} → ${formatBytes(card.outputBytes)}`
            : t("aiCanvas.previewOnly")}
        </Badge>
      </div>
      {savings > 0 && (
        <div className="text-g-caption text-g-green">
          {t("aiCanvas.savings", { size: formatBytes(savings) })}
        </div>
      )}
      <div className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
        {card.token}
      </div>
    </div>
  );
}

function OperationCardBody({ card }: { card: OperationCanvasCard }) {
  const { t } = useTranslation();
  const changes = card.preview.changes.length;
  const blockers = card.preview.blockers.length;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="green">{t("aiCanvas.previewOnly")}</Badge>
        <Badge tone={card.preview.canApply ? "blue" : "line"}>
          {card.preview.canApply
            ? t("aiCanvas.canApply")
            : t("aiCanvas.blocked")}
        </Badge>
        <Badge tone="line">
          {t("aiCanvas.operationChanges", { count: changes })}
        </Badge>
        {blockers > 0 && (
          <Badge tone="amber">
            {t("aiCanvas.operationBlockers", { count: blockers })}
          </Badge>
        )}
      </div>
      <p className="text-g-caption leading-[1.45] text-g-ink-3">
        {card.prompt}
      </p>
      <div className="max-h-40 overflow-y-auto rounded-g-md border border-g-line bg-g-surface-2">
        {changes === 0 && blockers === 0 ? (
          <div className="px-3 py-2 text-g-caption text-g-ink-3">
            {t("aiCanvas.noPreviewChanges")}
          </div>
        ) : (
          <>
            {card.preview.changes.slice(0, 5).map((change) => (
              <div
                key={`${change.file}:${change.line}:${change.newSpecifier}`}
                className="border-b border-g-line px-3 py-2 last:border-b-0"
              >
                <div className="truncate text-g-caption font-[590] text-g-ink">
                  {change.file}:{change.line}
                </div>
                <div className="truncate font-g-mono text-[10px] tracking-g-mono text-g-ink-3">
                  {change.oldSpecifier} → {change.newSpecifier}
                </div>
              </div>
            ))}
            {card.preview.blockers.slice(0, 4).map((blocker) => (
              <div
                key={`${blocker.file}:${blocker.line}:${blocker.code}`}
                className="border-b border-g-line px-3 py-2 last:border-b-0"
              >
                <div className="truncate text-g-caption font-[590] text-g-amber">
                  {blocker.code}
                </div>
                <div className="text-g-caption text-g-ink-3">
                  {blocker.reason}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
        {card.token}
      </div>
    </div>
  );
}

function ProposalCardBody({
  card,
  onApprove,
  onReject,
}: {
  card: ProposalCanvasCard;
  onApprove: (card: ProposalCanvasCard) => void;
  onReject: (card: ProposalCanvasCard) => void;
}) {
  const { t } = useTranslation();
  const isPending = card.status === "pending";
  const isExecuting = card.status === "executing";
  const isCompleted = card.status === "completed";
  const isFailed = card.status === "failed";
  const isRejected = card.status === "rejected";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={isPending ? "amber" : isCompleted ? "green" : isRejected ? "line" : isFailed ? "red" : "blue"}>
          {card.tool.replaceAll("_", " ")}
        </Badge>
        <Badge tone={isCompleted ? "green" : isRejected ? "line" : isPending ? "amber" : "line"}>
          {isExecuting
            ? t("aiCanvas.executing")
            : isCompleted
              ? t("aiCanvas.completed")
              : isRejected
                ? t("aiCanvas.rejected")
                : isFailed
                  ? t("aiCanvas.failed")
                  : t("aiCanvas.pending")}
        </Badge>
      </div>
      <p className={cn("text-g-body leading-[1.45] text-g-ink", isRejected && "line-through opacity-50")}>
        {card.description}
      </p>
      {card.impact && (
        <p className="text-g-caption text-g-ink-3">{card.impact}</p>
      )}
      {card.error && (
        <p className="text-g-caption text-g-red">{card.error}</p>
      )}
      {isPending && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="primary"
            leadingIcon={<Check />}
            onClick={() => onApprove(card)}
          >
            {t("aiCanvas.approve")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<XCircle />}
            onClick={() => onReject(card)}
          >
            {t("aiCanvas.reject")}
          </Button>
        </div>
      )}
      {isExecuting && (
        <div className="flex items-center gap-2 text-g-caption text-g-ink-3">
          <LoaderCircle size={14} className="animate-spin" />
          {t("aiCanvas.executing")}
        </div>
      )}
      {isFailed && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onApprove(card)}
        >
          {t("aiCanvas.retry")}
        </Button>
      )}
    </div>
  );
}

function AICursor({
  position,
  label,
  visible,
  status,
}: {
  position: { x: number; y: number };
  label?: string;
  visible: boolean;
  status?: "thinking" | "acting" | "idle";
}) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute z-[60] transition-transform duration-300 ease-out"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "size-4 rounded-full border-2 border-g-purple bg-g-purple shadow-g-sm",
            status === "thinking" && "animate-pulse",
          )}
        />
        <div className="flex items-center gap-1 rounded-g-sm bg-g-purple px-1.5 py-0.5 text-[10px] font-[590] tracking-g-ui text-white shadow-g-sm">
          <span>AI</span>
          {label && <span className="max-w-[120px] truncate opacity-80">· {label}</span>}
        </div>
      </div>
    </div>
  );
}

export function AICanvasView({
  scanId,
  aiEnabled,
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
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [composerPreviewOpen, setComposerPreviewOpen] = useState(false);
  const [composerAdvancedOpen, setComposerAdvancedOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>(
    initialSession.chatHistory ?? [],
  );
  const [aiCursor, setAiCursor] = useState<{
    x: number;
    y: number;
    label?: string;
    visible: boolean;
    status?: "thinking" | "acting" | "idle";
  }>({ x: 0, y: 0, visible: false });
  const [canvasSelection, setCanvasSelection] =
    useState<CanvasSelection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardElementsRef = useRef(new Map<string, HTMLElement>());
  const canvasSelectionRef = useRef<CanvasSelection | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    cardId: string;
    element: HTMLElement | null;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

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
  const selectedLabel =
    selectedAssets.length > 0
      ? selectedAssets.map((card) => fileName(card.asset.repoPath)).join(", ")
      : t("aiCanvas.noSelection");
  const activityCards = useMemo(
    () => cards.filter((card) => card.kind !== "asset").slice(-4),
    [cards],
  );
  const isWorking = working !== "idle";
  const composerToolsOpen = composerPreviewOpen || composerAdvancedOpen;

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
    const root = rootRef.current;
    if (!root) return;
    const options = { capture: true, passive: false } as const;
    const preventGesture = (event: Event) => event.preventDefault();
    const preventCanvasWheel = (event: WheelEvent) => {
      const target = event.target;
      const scrollContainer =
        target instanceof Element &&
        target.closest("[data-ai-canvas-scroll='true']");
      const verticalScroll = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
      if (
        scrollContainer &&
        verticalScroll &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        return;
      }
      event.preventDefault();
    };

    root.addEventListener("gesturestart", preventGesture, options);
    root.addEventListener("gesturechange", preventGesture, options);
    root.addEventListener("gestureend", preventGesture, options);
    root.addEventListener("wheel", preventCanvasWheel, options);

    return () => {
      root.removeEventListener("gesturestart", preventGesture, true);
      root.removeEventListener("gesturechange", preventGesture, true);
      root.removeEventListener("gestureend", preventGesture, true);
      root.removeEventListener("wheel", preventCanvasWheel, true);
    };
  }, []);

  const registerCardElement = useCallback(
    (cardId: string, node: HTMLElement | null) => {
      if (node) {
        cardElementsRef.current.set(cardId, node);
        return;
      }
      cardElementsRef.current.delete(cardId);
    },
    [],
  );

  const renderDragFrame = useCallback(() => {
    dragFrameRef.current = null;
    const drag = dragRef.current;
    if (!drag?.element) return;
    drag.element.style.transform =
      "translate(" + drag.currentX + "px, " + drag.currentY + "px)";
  }, []);

  const scheduleDragFrame = useCallback(() => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(renderDragFrame);
  }, [renderDragFrame]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current === null) return;
      window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

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

  function handleDragStart(
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = cardElementsRef.current.get(card.id) ?? null;
    if (element) {
      element.style.willChange = "transform";
      element.style.zIndex = "35";
    }
    dragRef.current = {
      cardId: card.id,
      element,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: card.x,
      startY: card.y,
      currentX: card.x,
      currentY: card.y,
    };
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    drag.currentX =
      drag.startX + (event.clientX - drag.startClientX) / viewport.scale;
    drag.currentY =
      drag.startY + (event.clientY - drag.startClientY) / viewport.scale;
    scheduleDragFrame();
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    if (drag.element) {
      drag.element.style.transform =
        "translate(" + drag.currentX + "px, " + drag.currentY + "px)";
      drag.element.style.willChange = "";
      drag.element.style.zIndex = "";
    }
    setCards((current) =>
      current.map((card) =>
        card.id === drag.cardId
          ? { ...card, x: drag.currentX, y: drag.currentY }
          : card,
      ),
    );
    dragRef.current = null;
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.08 : 0.08;
      setViewport((current) => ({
        ...current,
        scale: clampCanvasScale(current.scale + direction),
      }));
      return;
    }
    setViewport((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  }

  function canvasPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("[data-ai-canvas-card='true']") ||
        target.closest("[data-ai-canvas-overlay='true']"))
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    const selection = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    canvasSelectionRef.current = selection;
    setCanvasSelection(selection);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    setCanvasSelection((current) => {
      if (!current) return current;
      event.preventDefault();
      const point = canvasPoint(event);
      const next = { ...current, currentX: point.x, currentY: point.y };
      canvasSelectionRef.current = next;
      return next;
    });
  }

  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const selection = canvasSelectionRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!selection) return;
    const bounds = selectionBounds(selection);
    const rootBounds = rootRef.current?.getBoundingClientRect();
    const selected =
      rootBounds && bounds.width > 4 && bounds.height > 4
        ? cards.find((card) => {
            const element = cardElementsRef.current.get(card.id);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return intersects(bounds, {
              left: rect.left - rootBounds.left,
              top: rect.top - rootBounds.top,
              width: rect.width,
              height: rect.height,
            });
          })
        : undefined;
    setSelectedCardId(selected?.id);
    canvasSelectionRef.current = null;
    setCanvasSelection(null);
  }

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
    const position = nextCardPosition(cards.length);
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
    const position = nextCardPosition(cards.length);
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

  function addComment(assetCard: AssetCanvasCard, text = prompt.trim()) {
    const id = createCanvasCardId("comment");
    const card: CommentCanvasCard = {
      id,
      kind: "comment",
      x: assetCard.x + CARD_WIDTH + 24,
      y: assetCard.y + 32,
      createdAt: nowISO(),
      anchorId: assetCard.id,
      text: text || t("aiCanvas.defaultComment"),
      region: {
        x: 0.32,
        y: 0.28,
        width: 0.34,
        height: 0.24,
      },
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
            visible: true,
            status: "acting",
          });
        }
      }
      if (event.type === "focus" && !event.cardId) {
        setAiCursor((prev) => ({ ...prev, visible: false }));
      }
      if (event.type === "thinking") {
        setAiCursor((prev) => ({ ...prev, status: "thinking", visible: true }));
      }
      if (event.type === "text") {
        assistantText += (assistantText ? "\n\n" : "") + event.content;
      }
      if (event.type === "proposal") {
        const pos = nextCardPosition(cards.length + newCards.length);
        const card: ProposalCanvasCard = {
          id: createCanvasCardId("proposal"),
          kind: "proposal",
          x: pos.x + CARD_WIDTH + 36,
          y: pos.y + newCards.length * 60,
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
              visible: true,
              status: "acting",
            });
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
        const pos = nextCardPosition(cards.length + newCards.length);
        const card: CanvasCard = {
          id: createCanvasCardId("ai"),
          kind: "assistant",
          x: pos.x + CARD_WIDTH + 36,
          y: pos.y,
          createdAt: nowISO(),
          prompt: promptText,
          message: assistantText,
          bullets: [],
          assetIds: selectedAssets.map((c) => c.asset.id),
          commentIds: [],
        };
        setCards((current) => [...current, card]);
        setSelectedCardId(card.id);
      }

      setChatHistory((prev) => [
        ...prev.slice(-9),
        { role: "user", content: promptText },
        ...(assistantText
          ? [{ role: "assistant", content: assistantText }]
          : []),
      ]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : t("aiCanvas.operationError"),
        );
      }
    } finally {
      setWorking("idle");
      setAiCursor((prev) => ({ ...prev, visible: false, status: "idle" }));
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function updateProposalStatus(
    proposalId: string,
    status: ProposalStatus,
    extra?: Partial<ProposalCanvasCard>,
  ) {
    setCards((current) =>
      current.map((card) =>
        card.kind === "proposal" && card.proposalId === proposalId
          ? { ...card, status, ...extra }
          : card,
      ),
    );
  }

  function handleApproveProposal(card: ProposalCanvasCard) {
    const assetStillOnCanvas = !card.sourceAssetId || cards.some(
      (c) => c.kind === "asset" && c.asset.id === card.sourceAssetId,
    );
    if (!assetStillOnCanvas) {
      updateProposalStatus(card.proposalId, "failed", {
        error: t("aiCanvas.assetRemovedError"),
      });
      return;
    }
    updateProposalStatus(card.proposalId, "executing");
    void executeProposal(card);
  }

  async function executeProposal(card: ProposalCanvasCard) {
    try {
      // TODO: wire each tool to its existing API (renderImageToolPreview, /api/assets/tags, etc.)
      await new Promise((resolve) => setTimeout(resolve, 800));
      updateProposalStatus(card.proposalId, "completed");
    } catch (err) {
      updateProposalStatus(card.proposalId, "failed", {
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function handleRejectProposal(card: ProposalCanvasCard) {
    updateProposalStatus(card.proposalId, "rejected");
  }

  function clearCanvas() {
    setCards([]);
    setSelectedCardId(undefined);
    setError("");
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

  function activityText(card: CanvasCard) {
    if (card.kind === "assistant") return card.message;
    if (card.kind === "comment") return card.text || t("aiCanvas.emptyComment");
    if (card.kind === "variant") return t("aiCanvas.previewGenerated");
    if (card.kind === "operation") return card.prompt;
    if (card.kind === "proposal") return `${card.tool}: ${card.description}`;
    return cardDisplayName(card);
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
                <ProposalCardBody
                  card={card}
                  onApprove={handleApproveProposal}
                  onReject={handleRejectProposal}
                />
              ) : card.kind === "operation" ? (
                <OperationCardBody card={card} />
              ) : null}
            </CardShell>
          ))}
          <AICursor
            position={{ x: aiCursor.x, y: aiCursor.y }}
            label={aiCursor.label}
            visible={aiCursor.visible}
            status={aiCursor.status}
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
          onClick={clearCanvas}
        >
          <Trash2 />
        </IconButton>
      </div>

      <div
        data-ai-canvas-overlay="true"
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 mx-auto h-[164px] max-w-[1120px] px-4 pb-3 text-white max-[760px]:px-2 max-[760px]:pb-2"
      >
        <div className="relative h-full">
          <div
            className={cn(
              "absolute inset-x-7 bottom-[70px] overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,28,0.78)] shadow-g-pop backdrop-blur-xl transition-[height,border-radius] duration-[160ms] ease-g max-[760px]:inset-x-2",
              composerCollapsed
                ? "h-12 rounded-t-[24px] rounded-b-none border-b-0"
                : "h-[92px] rounded-t-[24px] rounded-b-none",
            )}
          >
            <button
              type="button"
              aria-label={t("aiCanvas.resizeComposer")}
              className="flex h-12 w-full items-center gap-3 px-5 text-left text-g-body text-white/62 transition-colors duration-[120ms] ease-g hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:shadow-g-focus"
              onClick={() => setComposerCollapsed((current) => !current)}
            >
              <span>{t("aiCanvas.processed", { time: "" })}</span>
              <span className="min-w-0 flex-1 truncate">
                {error ||
                  (activityCards.at(-1)
                    ? activityText(activityCards.at(-1)!)
                    : selectedLabel)}
              </span>
              <span className="text-white/42">
                {composerCollapsed ? "›" : "⌄"}
              </span>
            </button>
            {!composerCollapsed && (
              <button
                type="button"
                className="flex h-10 w-full items-center gap-3 border-t border-white/[0.06] px-5 text-left text-g-caption text-white/42 transition-colors duration-[120ms] ease-g hover:bg-white/[0.04] hover:text-white/64 focus-visible:outline-none focus-visible:shadow-g-focus"
                onClick={() => {
                  const latest = activityCards.at(-1);
                  if (latest) setSelectedCardId(latest.id);
                }}
              >
                <MousePointer2 size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {prompt.trim() ||
                    (activityCards.at(-1)
                      ? activityText(activityCards.at(-1)!)
                      : selectedLabel)}
                </span>
                <span>{t("aiCanvas.guide")}</span>
              </button>
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
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
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
    </div>
  );
}

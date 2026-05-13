import {
  Bot,
  CheckCircle2,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Maximize2,
  MessageSquarePlus,
  MousePointer2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
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
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AssetItem } from "@/types";
import { fileName, formatBytes, formatExt } from "@/ui";
import {
  buildAssistantBullets,
  cardDisplayName,
  clampCanvasScale,
  commentsForAssets,
  createCanvasCardId,
  emptyAICanvasSession,
  inferPromptIntent,
  readAICanvasSession,
  selectedAssetCards,
  writeAICanvasSession,
  type AICanvasSession,
  type AssetCanvasCard,
  type CanvasCard,
  type CommentCanvasCard,
  type OperationCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";

type Props = {
  scanId?: number;
  aiEnabled: boolean;
  onOpenAsset?: (assetId: string) => void;
};

type WorkingState = "idle" | "search" | "ai" | "imagePreview" | "operation";

const DEFAULT_IMAGE_TOOL_SETTINGS: ImageToolSettings = {
  outputFormat: "webp",
  quality: 82,
  maxDimensionPx: 1600,
  outputMode: "safeVariants",
};

const CARD_WIDTH = 320;

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
}) {
  return (
    <section
      className={cn(
        "absolute w-[320px] overflow-hidden rounded-g-md border bg-g-surface shadow-g-md transition-[border-color,box-shadow,transform] duration-[120ms] ease-g",
        cardTone(card),
        selected && "border-g-active-bg shadow-g-lg",
      )}
      style={{ transform: `translate(${card.x}px, ${card.y}px)` }}
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
        <Badge tone={selected ? "accent" : "line"}>{card.kind}</Badge>
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
          className="size-full object-contain p-3"
          loading="lazy"
        />
        {comments.map((comment) => (
          <button
            key={comment.id}
            type="button"
            aria-label={comment.text || t("aiCanvas.commentCard")}
            className="absolute rounded-g-sm border border-g-amber bg-g-amber-soft shadow-g-sm focus-visible:outline-none focus-visible:shadow-g-focus"
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
          className="size-full object-contain p-3"
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

export function AICanvasView({ scanId, aiEnabled, onOpenAsset }: Props) {
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
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkingState>("idle");
  const dragRef = useRef<{
    cardId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const selectedAssets = useMemo(
    () => selectedAssetCards(cards, selectedCardId),
    [cards, selectedCardId],
  );
  const selectedComments = useMemo(
    () =>
      commentsForAssets(
        cards,
        selectedAssets.map((card) => card.id),
      ),
    [cards, selectedAssets],
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
  const isWorking = working !== "idle";

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeAICanvasSession(window.sessionStorage, {
      version: 1,
      cards,
      selectedCardId,
      viewport,
    });
  }, [cards, selectedCardId, viewport]);

  const updateCardPosition = useCallback(
    (cardId: string, x: number, y: number) => {
      setCards((current) =>
        current.map((card) => (card.id === cardId ? { ...card, x, y } : card)),
      );
    },
    [],
  );

  function handleDragStart(
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      cardId: card.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: card.x,
      startY: card.y,
    };
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    updateCardPosition(
      drag.cardId,
      drag.startX + (event.clientX - drag.startClientX) / viewport.scale,
      drag.startY + (event.clientY - drag.startClientY) / viewport.scale,
    );
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      dragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
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

  async function runSearch() {
    const q = query.trim();
    if (!scanId) {
      setError(t("aiCanvas.missingScan"));
      return;
    }
    setWorking("search");
    setError("");
    try {
      const page = await getCatalogItems({ scanId, q, limit: 18 });
      setSearchResults(page.items);
      setSearchTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aiCanvas.searchError"));
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
    const assetCards = selectedAssets;
    const intent = inferPromptIntent(promptText);
    setPrompt("");

    if (intent === "comment") {
      const target = assetCards[0];
      if (!target) {
        setError(t("aiCanvas.selectionRequired"));
        addAssistantCard(promptText, t("aiCanvas.selectionRequired"));
        return;
      }
      addComment(target, promptText);
      return;
    }

    if (intent === "operationPreview") {
      if (assetCards.length === 0) {
        setError(t("aiCanvas.selectionRequired"));
        addAssistantCard(promptText, t("aiCanvas.selectionRequired"));
        return;
      }
      await createOperationPreview(assetCards, promptText);
      return;
    }

    if (intent === "imagePreview") {
      const target = assetCards[0];
      if (!target) {
        setError(t("aiCanvas.selectionRequired"));
        addAssistantCard(promptText, t("aiCanvas.selectionRequired"));
        return;
      }
      await createImagePreview(target, promptText);
      return;
    }

    setWorking("ai");
    addAssistantCard(promptText);
    setWorking("idle");
  }

  function clearCanvas() {
    setCards([]);
    setSelectedCardId(undefined);
    setError("");
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-g-canvas">
      <div
        className="absolute inset-0 cursor-move overflow-hidden"
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
              ) : (
                <OperationCardBody card={card} />
              )}
            </CardShell>
          ))}
        </div>
      </div>

      {cards.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto grid size-11 place-items-center rounded-g-md border border-g-line bg-g-surface text-g-ink-2 shadow-g-sm">
              <Sparkles size={20} />
            </div>
            <h2 className="mt-4 text-g-heading font-[650] tracking-g-heading text-g-ink">
              {t("aiCanvas.emptyTitle")}
            </h2>
            <p className="mt-2 text-g-body leading-[1.55] text-g-ink-3">
              {t("aiCanvas.emptyDesc")}
            </p>
          </div>
        </div>
      )}

      <aside className="pointer-events-auto absolute left-3 top-3 z-20 flex w-[min(380px,calc(100%-24px))] flex-col gap-2 rounded-g-md border border-g-line bg-g-surface p-3 shadow-g-md">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-g-body font-[650] tracking-g-ui text-g-ink">
              <Wand2 size={16} />
              <span>{t("mode.aiCanvas")}</span>
            </div>
            <div className="mt-0.5 truncate text-g-caption text-g-ink-3">
              {t("aiCanvas.searchPanelDesc")}
            </div>
          </div>
          <Badge tone={aiEnabled ? "purple" : "line"}>
            {aiEnabled ? t("aiCanvas.aiReady") : t("aiCanvas.aiContext")}
          </Badge>
        </div>
        <form
          className="flex gap-2"
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
        </form>
        {error && (
          <div className="rounded-g-md border border-g-red/40 bg-g-red-soft px-3 py-2 text-g-caption text-g-red">
            {error}
          </div>
        )}
        {searchResults.length > 0 && (
          <div className="flex items-center justify-between text-g-caption text-g-ink-3">
            <span>{t("aiCanvas.searchResults", { count: searchTotal })}</span>
            <span>{t("aiCanvas.addHint")}</span>
          </div>
        )}
        <div className="max-h-[360px] overflow-y-auto">
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
      </aside>

      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-g-md border border-g-line bg-g-surface p-1 shadow-g-md">
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

      <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 mx-auto max-w-5xl rounded-g-md border border-g-line bg-g-surface p-3 shadow-g-lg">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-g-caption text-g-ink-3">
          <Badge tone={selectedAssets.length > 0 ? "blue" : "line"}>
            {selectedAssets.length > 0
              ? t("aiCanvas.selectedAssets", { count: selectedAssets.length })
              : t("aiCanvas.noSelection")}
          </Badge>
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          {selectedComments.length > 0 && (
            <Badge tone="amber">
              {t("aiCanvas.comments", { count: selectedComments.length })}
            </Badge>
          )}
          <Badge tone="green">{t("aiCanvas.previewOnly")}</Badge>
        </div>
        <div className="flex items-end gap-2 max-[760px]:flex-col max-[760px]:items-stretch">
          <Textarea
            value={prompt}
            placeholder={t("aiCanvas.composerPlaceholder")}
            className="flex-1"
            textareaClassName="min-h-12 resize-none text-g-body"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void handleAsk();
              }
            }}
          />
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              disabled={selectedAssets.length === 0}
              leadingIcon={<MessageSquarePlus />}
              onClick={() => {
                const target = selectedAssets[0];
                if (target) addComment(target);
              }}
            >
              {t("aiCanvas.mark")}
            </Button>
            <Button
              variant="primary"
              disabled={prompt.trim() === "" || isWorking}
              leadingIcon={
                isWorking ? <LoaderCircle className="animate-spin" /> : <Bot />
              }
              onClick={() => void handleAsk()}
            >
              {t("aiCanvas.ask")}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="chip"
            leadingIcon={<ImagePlus />}
            disabled={selectedAssets.length === 0 || isWorking}
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
            onClick={() =>
              void createOperationPreview(
                selectedAssets,
                t("aiCanvas.safeVariantPrompt"),
              )
            }
          >
            {t("aiCanvas.safeVariant")}
          </Button>
          <Button
            size="sm"
            variant="chip"
            leadingIcon={<CheckCircle2 />}
            disabled={isWorking}
            onClick={() => addAssistantCard(t("aiCanvas.describePrompt"))}
          >
            {t("aiCanvas.describe")}
          </Button>
        </div>
      </div>
    </div>
  );
}

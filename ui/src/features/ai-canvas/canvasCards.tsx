import {
  ArrowUp,
  Bot,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MessageCircle,
  MousePointer2,
  Trash2,
} from "lucide-react";
import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fileName, formatBytes, formatExt } from "@/ui";
import {
  cardDisplayName,
  type AssetCanvasCard,
  type CanvasCard,
  type CommentCanvasCard,
  type OperationCanvasCard,
  type ProposalCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import {
  CARD_WIDTH,
  cardTone,
  imageMeta,
  renderMarkdown,
  tagLabel,
} from "./canvasUtils";

type CommentRegion = { x: number; y: number; width: number; height: number };

const FIGMA_COMMENT_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2730%27 height=%2730%27 viewBox=%270 0 30 30%27%3E%3Cfilter id=%27s%27 x=%27-30%25%27 y=%27-30%25%27 width=%27160%25%27 height=%27160%25%27%3E%3CfeDropShadow dx=%270%27 dy=%271.5%27 stdDeviation=%271.5%27 flood-color=%27%23000000%27 flood-opacity=%27.2%27/%3E%3C/filter%3E%3Cpath filter=%27url(%23s)%27 d=%27M6 15a9.5 9.5 0 0 1 9.5-9.5h1A9.5 9.5 0 0 1 26 15v1a9.5 9.5 0 0 1-9.5 9.5H6Z%27 fill=%27white%27 stroke=%27%23111%27 stroke-width=%271.6%27/%3E%3C/svg%3E") 6 25, crosshair';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function pointCommentRegion(x: number, y: number): CommentRegion {
  const width = 0.24;
  const height = 0.2;
  return {
    x: clamp01(x - width / 2),
    y: clamp01(y - height / 2),
    width,
    height,
  };
}

function FigmaCommentIcon({ size = "sm" }: { size?: "xs" | "sm" | "lg" }) {
  const iconSize = size === "lg" ? 18 : size === "xs" ? 11 : 14;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center border border-g-line bg-g-surface text-g-ink-2 shadow-g-sm",
        size === "lg"
          ? "size-12 rounded-[15px]"
          : size === "xs"
            ? "size-4 rounded-[6px]"
            : "size-5 rounded-[7px]",
      )}
      aria-hidden="true"
    >
      <MessageCircle size={iconSize} strokeWidth={2.4} />
    </span>
  );
}

function FigmaCommentMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-6 shrink-0 rounded-[12px] rounded-bl-[3px] border-2 border-g-ink bg-g-surface shadow-g-md",
        className,
      )}
      aria-hidden="true"
    />
  );
}

function figmaCommentBoxPosition(region: CommentRegion) {
  const x = clamp01(region.x + region.width / 2);
  const y = clamp01(region.y + region.height / 2);
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
  };
}

export function CardShell({
  card,
  selected,
  compact,
  width,
  children,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDelete,
  onResize,
  onRegister,
  position,
}: {
  card: CanvasCard;
  selected: boolean;
  compact?: boolean;
  width?: number;
  children: ReactNode;
  position?: { x: number; y: number };
  onSelect: (id: string) => void;
  onDragStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    card: CanvasCard,
  ) => void;
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDelete: (card: CanvasCard) => void;
  onResize?: (id: string, width: number) => void;
  onRegister: (id: string, node: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  function handleResizeDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: width ?? CARD_WIDTH };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current || !onResize) return;
    const delta = e.clientX - resizeRef.current.startX;
    const next = Math.max(200, Math.min(800, resizeRef.current.startW + delta));
    onResize(card.id, next);
  }

  function handleResizeUp() {
    resizeRef.current = null;
  }

  return (
    <section
      className={cn(
        "absolute touch-none select-none rounded-g-md transition-[border-color,box-shadow] duration-[120ms] ease-g",
        card.kind === "comment" && (selected ? "z-[80]" : "z-[70]"),
        compact
          ? cn(
              "border-2 border-transparent shadow-none",
              selected &&
                "z-40 border-g-accent shadow-[0_0_0_1px_var(--g-accent)]",
            )
          : cn(
              "border bg-g-surface shadow-g-md",
              card.kind === "asset" ? "overflow-visible" : "overflow-hidden",
              cardTone(card),
              selected &&
                card.kind !== "comment" &&
                "z-40 border-g-active-bg shadow-g-lg",
              selected &&
                card.kind === "comment" &&
                "border-g-active-bg shadow-g-lg",
            ),
      )}
      ref={(node) => onRegister(card.id, node)}
      style={{
        width: width ?? CARD_WIDTH,
        transform: `translate(${position?.x ?? card.x}px, ${position?.y ?? card.y}px)`,
      }}
      data-ai-canvas-card="true"
      data-selected={selected || undefined}
      onPointerDown={() => onSelect(card.id)}
    >
      {compact ? (
        <div
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => onDragStart(event, card)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          {children}
        </div>
      ) : (
        <>
          <div
            className="flex cursor-grab items-center justify-between gap-2 border-b border-g-line bg-g-surface-2 px-3 py-2 active:cursor-grabbing"
            onPointerDown={(event) => onDragStart(event, card)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="flex min-w-0 items-center gap-2 text-g-caption font-[590] tracking-g-ui text-g-ink-2">
              {card.kind === "comment" ? (
                <FigmaCommentIcon size="xs" />
              ) : (
                <MousePointer2 size={13} />
              )}
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
        </>
      )}
      {selected && onResize && (
        <div
          className={cn(
            "absolute -bottom-1.5 -right-1.5 z-50 size-3 cursor-nwse-resize rounded-full border-2 bg-g-surface shadow-g-sm",
            compact ? "border-[#0d99ff]" : "border-g-active-bg",
          )}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
        />
      )}
    </section>
  );
}

export function AssetCardBody({
  card,
  comments,
  compact,
  hideOverlays,
  commentEnabled,
  onOpenAsset,
  onSelectComment,
  onCreateComment,
  onRenderPreview,
  onOperationPreview,
  working,
}: {
  card: AssetCanvasCard;
  comments: CommentCanvasCard[];
  compact?: boolean;
  hideOverlays?: boolean;
  commentEnabled?: boolean;
  onOpenAsset?: (assetId: string) => void;
  onSelectComment: (commentId: string) => void;
  onCreateComment: (
    assetCard: AssetCanvasCard,
    text?: string,
    region?: { x: number; y: number; width: number; height: number },
  ) => void;
  onRenderPreview: (assetCard: AssetCanvasCard) => void;
  onOperationPreview: (assetCard: AssetCanvasCard) => void;
  working: boolean;
}) {
  const { t } = useTranslation();
  const asset = card.asset;
  const tags = tagLabel(asset);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const [drawRegion, setDrawRegion] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [pendingComment, setPendingComment] = useState<CommentRegion | null>(
    null,
  );
  const [pendingCommentText, setPendingCommentText] = useState("");

  function toNormalized(clientX: number, clientY: number) {
    const rect = imageContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { nx: 0, ny: 0 };
    return {
      nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }

  function openCommentComposer(region: CommentRegion) {
    setPendingComment(region);
    setPendingCommentText("");
  }

  function handleRegionPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.button !== 0 || pendingComment) return;
    const { nx, ny } = toNormalized(e.clientX, e.clientY);
    setDrawRegion({ startX: nx, startY: ny, currentX: nx, currentY: ny });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleRegionPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (!drawRegion) return;
    const { nx, ny } = toNormalized(e.clientX, e.clientY);
    setDrawRegion((prev) =>
      prev ? { ...prev, currentX: nx, currentY: ny } : null,
    );
  }

  function handleRegionPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (!drawRegion) return;
    const x = Math.min(drawRegion.startX, drawRegion.currentX);
    const y = Math.min(drawRegion.startY, drawRegion.currentY);
    const width = Math.abs(drawRegion.currentX - drawRegion.startX);
    const height = Math.abs(drawRegion.currentY - drawRegion.startY);
    setDrawRegion(null);
    if (width > 0.03 && height > 0.03) {
      openCommentComposer({ x, y, width, height });
      return;
    }
    openCommentComposer(
      pointCommentRegion(drawRegion.startX, drawRegion.startY),
    );
  }

  const showAiMentionSuggestion = /(^|\s)@$/.test(pendingCommentText);

  function acceptAiMentionSuggestion() {
    setPendingCommentText((current) => current.replace(/(^|\s)@$/, "$1@ai "));
  }

  function submitPendingComment(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!pendingComment) return;
    const text = pendingCommentText.trim();
    if (!text) return;
    onCreateComment(card, text, pendingComment);
    setPendingComment(null);
    setPendingCommentText("");
  }

  function handlePendingCommentKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (
      showAiMentionSuggestion &&
      (event.key === "Enter" || event.key === "Tab")
    ) {
      event.preventDefault();
      acceptAiMentionSuggestion();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setPendingComment(null);
      setPendingCommentText("");
    }
  }

  const drawRect = drawRegion
    ? {
        left: `${Math.min(drawRegion.startX, drawRegion.currentX) * 100}%`,
        top: `${Math.min(drawRegion.startY, drawRegion.currentY) * 100}%`,
        width: `${Math.abs(drawRegion.currentX - drawRegion.startX) * 100}%`,
        height: `${Math.abs(drawRegion.currentY - drawRegion.startY) * 100}%`,
      }
    : null;

  const pendingCommentRect = pendingComment
    ? {
        left: `${pendingComment.x * 100}%`,
        top: `${pendingComment.y * 100}%`,
        width: `${pendingComment.width * 100}%`,
        height: `${pendingComment.height * 100}%`,
      }
    : null;

  return (
    <div className="flex flex-col">
      <div
        ref={imageContainerRef}
        className={cn(
          "relative aspect-[4/3]",
          compact ? "bg-transparent" : "bg-g-surface-2",
        )}
        style={
          commentEnabled && !hideOverlays
            ? { cursor: FIGMA_COMMENT_CURSOR }
            : undefined
        }
        onPointerDown={
          commentEnabled && !hideOverlays ? handleRegionPointerDown : undefined
        }
        onPointerMove={
          commentEnabled && !hideOverlays ? handleRegionPointerMove : undefined
        }
        onPointerUp={
          commentEnabled && !hideOverlays ? handleRegionPointerUp : undefined
        }
        onPointerCancel={
          commentEnabled && !hideOverlays
            ? (event) => {
                event.stopPropagation();
                setDrawRegion(null);
              }
            : undefined
        }
      >
        <img
          src={asset.thumbnailUrl || asset.url}
          alt={fileName(asset.repoPath)}
          className="size-full select-none object-contain p-3"
          draggable={false}
          loading="lazy"
        />
        {!hideOverlays &&
          comments.map((comment) => (
            <button
              key={comment.id}
              type="button"
              aria-label={comment.text || t("aiCanvas.commentCard")}
              className="absolute rounded-g-sm border-2 border-g-blue bg-g-blue/10 shadow-g-sm transition-colors duration-[120ms] ease-g hover:bg-g-blue/20 focus-visible:outline-none focus-visible:shadow-g-focus"
              style={{
                left: `${comment.region.x * 100}%`,
                top: `${comment.region.y * 100}%`,
                width: `${comment.region.width * 100}%`,
                height: `${comment.region.height * 100}%`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelectComment(comment.id);
              }}
            />
          ))}
        {drawRect && (
          <div
            className="pointer-events-none absolute z-[60] border-2 border-g-blue bg-g-blue/10"
            style={drawRect}
          />
        )}
        {pendingCommentRect && (
          <div
            className="pointer-events-none absolute z-[60] border-2 border-g-blue bg-g-blue/10"
            style={pendingCommentRect}
          />
        )}
        {pendingComment && (
          <div
            className="pointer-events-auto absolute z-[80]"
            style={figmaCommentBoxPosition(pendingComment)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <FigmaCommentMarker className="absolute left-0 top-0 -translate-y-full" />
            <form
              className="absolute left-7 top-[-32px] flex h-9 w-[min(240px,calc(100vw-32px))] items-center gap-2 rounded-[15px] bg-[rgba(31,31,31,0.96)] px-3 text-white shadow-g-pop"
              onSubmit={submitPendingComment}
            >
              <input
                autoFocus
                value={pendingCommentText}
                placeholder={t("aiCanvas.addCommentPlaceholder")}
                className="min-w-0 flex-1 border-0 bg-transparent font-g text-g-body leading-none text-white outline-none placeholder:text-white/45"
                onChange={(event) => setPendingCommentText(event.target.value)}
                onKeyDown={handlePendingCommentKeyDown}
              />
              <button
                type="submit"
                aria-label={t("aiCanvas.saveComment")}
                disabled={pendingCommentText.trim() === ""}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-white/20 text-white transition-colors duration-[120ms] ease-g hover:bg-white/28 disabled:opacity-40"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              {showAiMentionSuggestion && (
                <button
                  type="button"
                  className="absolute left-0 top-11 flex min-h-9 w-[220px] items-center gap-2 rounded-[14px] border border-white/[0.08] bg-[rgba(31,31,31,0.96)] px-3 py-2 text-left font-g text-g-ui text-white shadow-g-pop backdrop-blur-xl transition-colors duration-[120ms] ease-g hover:bg-[rgba(48,48,48,0.98)] focus-visible:outline-none focus-visible:shadow-g-focus"
                  onClick={acceptAiMentionSuggestion}
                >
                  <Bot size={14} className="shrink-0 text-white/64" />
                  <span className="font-[590]">@ai</span>
                  <span className="min-w-0 flex-1 truncate text-white/46">
                    {t("aiCanvas.ask")}
                  </span>
                </button>
              )}
            </form>
          </div>
        )}
      </div>
      {!compact && (
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
              leadingIcon={<FigmaCommentIcon />}
              onClick={() =>
                openCommentComposer({
                  x: 0.22,
                  y: 0.2,
                  width: 0.56,
                  height: 0.37,
                })
              }
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
      )}
    </div>
  );
}

export function CommentCardBody({ card }: { card: CommentCanvasCard }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <Badge tone="amber">{t("aiCanvas.pinnedRegion")}</Badge>
      <p className="whitespace-pre-wrap text-g-body leading-[1.45] text-g-ink">
        {card.text || t("aiCanvas.emptyComment")}
      </p>
    </div>
  );
}

export function AssistantCardBody({
  card,
}: {
  card: Extract<CanvasCard, { kind: "assistant" }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge tone="line">{t("aiCanvas.aiContext")}</Badge>
        <span className="truncate text-g-caption text-g-ink-3">
          {card.assetIds.length > 0
            ? t("aiCanvas.selectedAssets", { count: card.assetIds.length })
            : t("aiCanvas.noSelection")}
        </span>
      </div>
      <p className="text-g-body leading-[1.45] text-g-ink">
        {renderMarkdown(card.message)}
      </p>
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

export function VariantCardBody({ card }: { card: VariantCanvasCard }) {
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

export function OperationCardBody({ card }: { card: OperationCanvasCard }) {
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

export function ProposalCardBody({ card }: { card: ProposalCanvasCard }) {
  const { t } = useTranslation();
  const isPending = card.status === "pending";
  const isExecuting = card.status === "executing";
  const isCompleted = card.status === "completed";
  const isFailed = card.status === "failed";
  const isRejected = card.status === "rejected";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge
          tone={
            isPending
              ? "amber"
              : isCompleted
                ? "green"
                : isRejected
                  ? "line"
                  : isFailed
                    ? "red"
                    : "blue"
          }
        >
          {card.tool.replaceAll("_", " ")}
        </Badge>
        <Badge
          tone={
            isCompleted
              ? "green"
              : isRejected
                ? "line"
                : isPending
                  ? "amber"
                  : "line"
          }
        >
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
      <p
        className={cn(
          "text-g-body leading-[1.45] text-g-ink",
          isRejected && "line-through opacity-50",
        )}
      >
        {card.description}
      </p>
      {card.impact && (
        <p className="text-g-caption text-g-ink-3">{card.impact}</p>
      )}
      {card.error && <p className="text-g-caption text-g-red">{card.error}</p>}
      {isExecuting && (
        <div className="flex items-center gap-2 text-g-caption text-g-ink-3">
          <LoaderCircle size={14} className="animate-spin" />
          {t("aiCanvas.executing")}
        </div>
      )}
    </div>
  );
}

export function AICursor({
  position,
  label,
  status,
  nickname,
}: {
  position: { x: number; y: number };
  label?: string;
  status?: "thinking" | "acting" | "idle";
  nickname?: string;
}) {
  const active = status === "thinking" || status === "acting";
  return (
    <div
      className="pointer-events-none absolute z-[60] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="flex flex-col items-start">
        <MousePointer2
          size={22}
          strokeWidth={2.5}
          className={cn(
            "drop-shadow-md transition-all duration-500",
            active
              ? "fill-g-purple text-white"
              : "fill-g-purple/60 text-white/70",
            status === "thinking" && "animate-pulse",
          )}
        />
        <div
          className={cn(
            "-mt-1 ml-3 flex items-center gap-1 whitespace-nowrap rounded-g-sm px-1.5 py-0.5 text-[10px] font-[590] tracking-g-ui text-white shadow-g-sm transition-opacity duration-500",
            active ? "bg-g-purple opacity-100" : "bg-g-purple/60 opacity-60",
          )}
        >
          <span>{nickname || "AI"}</span>
          {active && label && (
            <span className="max-w-[160px] truncate opacity-80">· {label}</span>
          )}
        </div>
      </div>
    </div>
  );
}

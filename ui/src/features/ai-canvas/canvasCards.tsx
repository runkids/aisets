import {
  ImagePlus,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  MousePointer2,
  Trash2,
} from "lucide-react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AssetItem } from "@/types";
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
import { cardTone, imageMeta, renderMarkdown, tagLabel } from "./canvasUtils";

export function CardShell({
  card,
  selected,
  children,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDelete,
  onRegister,
  position,
}: {
  card: CanvasCard;
  selected: boolean;
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
      style={{
        transform: `translate(${position?.x ?? card.x}px, ${position?.y ?? card.y}px)`,
      }}
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

export function AssetCardBody({
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

  function toNormalized(clientX: number, clientY: number) {
    const rect = imageContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { nx: 0, ny: 0 };
    return {
      nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }

  function handleRegionPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const { nx, ny } = toNormalized(e.clientX, e.clientY);
    setDrawRegion({ startX: nx, startY: ny, currentX: nx, currentY: ny });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleRegionPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawRegion) return;
    const { nx, ny } = toNormalized(e.clientX, e.clientY);
    setDrawRegion((prev) =>
      prev ? { ...prev, currentX: nx, currentY: ny } : null,
    );
  }

  function handleRegionPointerUp() {
    if (!drawRegion) return;
    const x = Math.min(drawRegion.startX, drawRegion.currentX);
    const y = Math.min(drawRegion.startY, drawRegion.currentY);
    const width = Math.abs(drawRegion.currentX - drawRegion.startX);
    const height = Math.abs(drawRegion.currentY - drawRegion.startY);
    setDrawRegion(null);
    if (width > 0.03 && height > 0.03) {
      onCreateComment(card, "", { x, y, width, height });
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

  return (
    <div className="flex flex-col">
      <div
        ref={imageContainerRef}
        className="relative aspect-[4/3] cursor-crosshair bg-g-surface-2"
        onPointerDown={handleRegionPointerDown}
        onPointerMove={handleRegionPointerMove}
        onPointerUp={handleRegionPointerUp}
        onPointerCancel={() => setDrawRegion(null)}
      >
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
        {drawRect && (
          <div
            className="pointer-events-none absolute border-2 border-g-amber bg-g-amber-soft/30"
            style={drawRect}
          />
        )}
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

export function CommentCardBody({ card }: { card: CommentCanvasCard }) {
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

export function AssistantCardBody({
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
              ? "fill-g-purple text-black"
              : "fill-g-purple/40 text-black/40",
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

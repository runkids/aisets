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
import { request } from "@/api/client";
import {
  previewImageToolAssets,
  renderImageToolPreview,
  type ImageToolSettings,
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
  aiNickname?: string;
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

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith("**") && t.endsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-${j}`}>{t.slice(2, -2)}</strong>);
    } else if (t.startsWith("`") && t.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-${j}`}
          className="rounded bg-black/10 px-1 py-0.5 text-[0.9em] dark:bg-white/10"
        >
          {t.slice(1, -1)}
        </code>,
      );
    } else if (t) {
      nodes.push(t);
    }
  }
  return nodes;
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("|") && line.includes("|", 1)) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!row.every((c) => /^[-:]+$/.test(c))) {
          tableRows.push(row);
        }
        i++;
      }
      if (tableRows.length > 0) {
        const [header, ...body] = tableRows;
        elements.push(
          <table
            key={`tbl-${i}`}
            className="my-1 w-full border-collapse text-[0.85em]"
          >
            <thead>
              <tr>
                {header.map((h, ci) => (
                  <th
                    key={ci}
                    className="border border-white/10 px-2 py-1 text-left font-[590]"
                  >
                    {renderInline(h, `th-${i}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-white/10 px-2 py-1">
                      {renderInline(cell, `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#{1,3})\s/)![1].length;
      const text = line.replace(/^#{1,3}\s+/, "");
      const cls =
        level === 1
          ? "text-[1.1em] font-[590]"
          : level === 2
            ? "text-[1em] font-[590]"
            : "text-[0.95em] font-[590]";
      elements.push(
        <div key={`h-${i}`} className={`mt-1 ${cls}`}>
          {renderInline(text, `h-${i}`)}
        </div>,
      );
      i++;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-0.5 list-disc pl-4">
          {items.map((item, li) => (
            <li key={li}>{renderInline(item, `li-${i}-${li}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-0.5 list-decimal pl-4">
          {items.map((item, li) => (
            <li key={li}>{renderInline(item, `li-${i}-${li}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} className="h-2" />);
      i++;
      continue;
    }

    elements.push(<div key={`p-${i}`}>{renderInline(line, `p-${i}`)}</div>);
    i++;
  }
  return elements;
}

function nextCardPosition(
  count: number,
  viewport?: { x: number; y: number; scale: number },
  containerSize?: { width: number; height: number },
) {
  const jitterX = (count % 5) * 34;
  const jitterY = (count % 4) * 42;
  if (viewport && containerSize && containerSize.width > 0) {
    const cx =
      (-viewport.x + containerSize.width / 2) / viewport.scale -
      CARD_WIDTH / 2 +
      jitterX;
    const cy =
      (-viewport.y + containerSize.height / 2) / viewport.scale - 120 + jitterY;
    return { x: Math.round(cx), y: Math.round(cy) };
  }
  return { x: 84 + jitterX, y: 72 + jitterY };
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

function ProposalCardBody({ card }: { card: ProposalCanvasCard }) {
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

function AICursor({
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
  const [canvasSelection, setCanvasSelection] =
    useState<CanvasSelection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchResultsRef = useRef<Array<{ id: string; repoPath: string }>>([]);
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
  const isWorking = working !== "idle";
  const composerToolsOpen = composerPreviewOpen || composerAdvancedOpen;
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

  function resolveAssetId(ref: string | undefined): string | undefined {
    if (!ref) return undefined;
    for (const c of cards) {
      if (c.kind !== "asset") continue;
      if (c.asset.id === ref || c.id === ref) return c.asset.id;
    }
    return undefined;
  }

  function handleApproveProposal(card: ProposalCanvasCard) {
    const targetRef =
      card.sourceAssetId || (card.params.assetId as string) || "";
    const resolvedId = resolveAssetId(targetRef);
    const assetStillOnCanvas = !targetRef || resolvedId;
    if (!assetStillOnCanvas) {
      updateProposalStatus(card.proposalId, "failed", {
        error: t("aiCanvas.assetRemovedError"),
      });
      return;
    }
    updateProposalStatus(card.proposalId, "executing");
    void executeProposal(card, resolvedId || targetRef);
  }

  function findAssetData(ref: string) {
    for (const c of cards) {
      if (c.kind !== "asset") continue;
      if (c.asset.id === ref || c.id === ref) return c.asset;
    }
    return undefined;
  }

  async function executeProposal(
    proposal: ProposalCanvasCard,
    assetId: string,
  ) {
    try {
      const p = proposal.params;
      const asset = findAssetData(assetId);

      switch (proposal.tool) {
        case "compress_image":
        case "convert_image":
        case "resize_image": {
          const result = await renderImageToolPreview({
            assetId,
            outputFormat: (p.outputFormat as string) || "webp",
            quality: (p.quality as number) || 82,
            maxDimensionPx: (p.maxDimensionPx as number) || 1600,
          });
          const variantCard: CanvasCard = {
            id: createCanvasCardId("variant"),
            kind: "variant",
            x: proposal.x,
            y: proposal.y + 200,
            createdAt: nowISO(),
            sourceAssetId: assetId,
            sourceName: proposal.description,
            previewUrl: previewImageUrl(result.token),
            token: result.token,
            inputBytes: result.inputBytes,
            outputBytes: result.outputBytes,
            inputFormat: result.inputFormat,
            outputFormat: result.outputFormat,
          };
          setCards((current) => [...current, variantCard]);
          updateProposalStatus(proposal.proposalId, "completed", {
            result: {
              token: result.token,
              inputBytes: result.inputBytes,
              outputBytes: result.outputBytes,
            },
          });
          break;
        }
        case "update_tags": {
          if (!asset) throw new Error("Asset not found on canvas");
          const tags = Array.isArray(p.tags)
            ? p.tags.filter((t): t is string => typeof t === "string")
            : [];
          await request("/api/assets/tags", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              tags,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, tags } }
                : c,
            ),
          );
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "update_description": {
          if (!asset) throw new Error("Asset not found on canvas");
          const desc = (p.description as string) || "";
          await request("/api/assets/description", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              description: desc,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, description: desc } }
                : c,
            ),
          );
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "update_ocr_text": {
          if (!asset) throw new Error("Asset not found on canvas");
          const text = (p.text as string) || "";
          await request("/api/assets/ocr-text", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              text,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, ocrText: text } }
                : c,
            ),
          );
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        default:
          updateProposalStatus(proposal.proposalId, "completed");
      }
    } catch (err) {
      updateProposalStatus(proposal.proposalId, "failed", {
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
                ref={(el) => {
                  if (el) el.scrollTop = el.scrollHeight;
                }}
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
                searchResultsRef: searchResultsRef.current.length,
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

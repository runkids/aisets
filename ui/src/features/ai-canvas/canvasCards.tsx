import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  Layers3,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MousePointer2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { basePath } from "@/api/client";
import { Badge, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fileName, formatBytes, formatExt } from "@/ui";
import {
  cardDisplayName,
  type AssetCanvasCard,
  type CanvasCard,
  type CommentCanvasCard,
  type OperationCanvasCard,
  type ProposalCanvasCard,
  type UploadCanvasCard,
  type VariantCanvasCard,
} from "./aiCanvasState";
import {
  AI_MENTION_TAG,
  CARD_WIDTH,
  compactImageAspectRatio,
  imageMeta,
  isImageCard,
  renderMarkdown,
  tagLabel,
} from "./canvasUtils";
import { proposalToolLabel } from "./proposalLabels";

const CONTEXT_MENU_HINT_KEY = "aisets.canvas.contextMenuHintSeen";

function cardKindIcon(kind: CanvasCard["kind"], size = 13) {
  switch (kind) {
    case "comment":
      return <MessageCircle size={size} />;
    case "assistant":
      return <Bot size={size} />;
    case "variant":
      return <ImagePlus size={size} />;
    case "proposal":
      return <Lightbulb size={size} />;
    case "operation":
      return <Layers3 size={size} />;
    default:
      return <Sparkles size={size} />;
  }
}

function cardKindAccent(kind: CanvasCard["kind"]) {
  switch (kind) {
    case "comment":
      return {
        text: "text-g-amber",
        bg: "bg-g-amber/10",
        border: "border-g-amber/20",
      };
    case "assistant":
      return {
        text: "text-g-purple",
        bg: "bg-g-purple/10",
        border: "border-g-purple/20",
      };
    case "variant":
      return {
        text: "text-g-blue",
        bg: "bg-g-blue/10",
        border: "border-g-blue/20",
      };
    case "proposal":
      return {
        text: "text-g-green",
        bg: "bg-g-green/10",
        border: "border-g-green/20",
      };
    case "operation":
      return {
        text: "text-g-green",
        bg: "bg-g-green/10",
        border: "border-g-green/20",
      };
    default:
      return {
        text: "text-g-ink-3",
        bg: "bg-g-surface-2",
        border: "border-g-line",
      };
  }
}

type CommentRegion = { x: number; y: number; width: number; height: number };

const AI_MENTION_DETECT_RE = /(^|\s)@$/;
const AI_MENTION_REPLACE = `$1${AI_MENTION_TAG} `;

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

function useCommentOverlay(opts: {
  enabled: boolean;
  canvasScale: number;
  onSubmit: (text: string, region: CommentRegion) => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
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
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { nx: 0, ny: 0 };
    return {
      nx: clamp01((clientX - rect.left) / rect.width),
      ny: clamp01((clientY - rect.top) / rect.height),
    };
  }

  const commentComposerScale = opts.canvasScale > 0 ? 1 / opts.canvasScale : 1;
  const showAiMentionSuggestion = AI_MENTION_DETECT_RE.test(pendingCommentText);

  function acceptAiMentionSuggestion() {
    setPendingCommentText((c) =>
      c.replace(AI_MENTION_DETECT_RE, AI_MENTION_REPLACE),
    );
  }

  const pointerProps = opts.enabled
    ? {
        style: { cursor: FIGMA_COMMENT_CURSOR } as React.CSSProperties,
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (e.button !== 0 || pendingComment) return;
          const { nx, ny } = toNormalized(e.clientX, e.clientY);
          setDrawRegion({ startX: nx, startY: ny, currentX: nx, currentY: ny });
          e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (!drawRegion) return;
          const { nx, ny } = toNormalized(e.clientX, e.clientY);
          setDrawRegion((prev) =>
            prev ? { ...prev, currentX: nx, currentY: ny } : null,
          );
        },
        onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (!drawRegion) return;
          const x = Math.min(drawRegion.startX, drawRegion.currentX);
          const y = Math.min(drawRegion.startY, drawRegion.currentY);
          const w = Math.abs(drawRegion.currentX - drawRegion.startX);
          const h = Math.abs(drawRegion.currentY - drawRegion.startY);
          setDrawRegion(null);
          setPendingComment(
            w > 0.03 && h > 0.03
              ? { x, y, width: w, height: h }
              : pointCommentRegion(drawRegion.startX, drawRegion.startY),
          );
          setPendingCommentText("");
        },
        onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          setDrawRegion(null);
        },
      }
    : {};

  const drawRect = drawRegion
    ? {
        left: `${Math.min(drawRegion.startX, drawRegion.currentX) * 100}%`,
        top: `${Math.min(drawRegion.startY, drawRegion.currentY) * 100}%`,
        width: `${Math.abs(drawRegion.currentX - drawRegion.startX) * 100}%`,
        height: `${Math.abs(drawRegion.currentY - drawRegion.startY) * 100}%`,
      }
    : null;

  const pendingRect = pendingComment
    ? {
        left: `${pendingComment.x * 100}%`,
        top: `${pendingComment.y * 100}%`,
        width: `${pendingComment.width * 100}%`,
        height: `${pendingComment.height * 100}%`,
      }
    : null;

  const overlay = opts.enabled ? (
    <>
      {drawRect && (
        <div
          className="pointer-events-none absolute z-[60] border-2 border-g-blue bg-g-blue/10"
          style={drawRect}
        />
      )}
      {pendingRect && (
        <div
          className="pointer-events-none absolute z-[60] border-2 border-g-blue bg-g-blue/10"
          style={pendingRect}
        />
      )}
      {pendingComment && (
        <div
          data-ai-canvas-comment-composer="true"
          className="pointer-events-auto absolute z-[80]"
          style={{
            ...figmaCommentBoxPosition(pendingComment),
            transform: `scale(${commentComposerScale})`,
            transformOrigin: "left top",
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <FigmaCommentMarker className="absolute left-0 top-0 -translate-y-full" />
          <form
            className="absolute left-7 top-[-32px] flex h-9 w-[min(240px,calc(100vw-32px))] items-center gap-2 rounded-[15px] bg-[rgba(31,31,31,0.96)] px-3 text-white shadow-g-pop"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pendingComment) return;
              const text = pendingCommentText.trim();
              if (!text) return;
              opts.onSubmit(text, pendingComment);
              setPendingComment(null);
              setPendingCommentText("");
            }}
          >
            <input
              autoFocus
              value={pendingCommentText}
              placeholder={t("aiCanvas.addCommentPlaceholder")}
              className="min-w-0 flex-1 border-0 bg-transparent font-g text-g-body leading-none text-white outline-none placeholder:text-white/45"
              onChange={(e) => setPendingCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  showAiMentionSuggestion &&
                  (e.key === "Enter" || e.key === "Tab")
                ) {
                  e.preventDefault();
                  acceptAiMentionSuggestion();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setPendingComment(null);
                  setPendingCommentText("");
                }
              }}
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
                <span className="font-[590]">{AI_MENTION_TAG}</span>
                <span className="min-w-0 flex-1 truncate text-white/46">
                  {t("aiCanvas.ask")}
                </span>
              </button>
            )}
          </form>
        </div>
      )}
    </>
  ) : null;

  return {
    containerRef,
    pointerProps,
    overlay,
    openCommentComposer: setPendingComment,
  };
}

function CommentRegionButtons({
  comments,
  onSelect,
}: {
  comments: CommentCanvasCard[];
  onSelect: (commentId: string) => void;
}) {
  const { t } = useTranslation();
  return comments.map((c) => (
    <button
      key={c.id}
      type="button"
      aria-label={c.text || t("aiCanvas.commentCard")}
      className="absolute rounded-g-sm border-2 border-g-blue bg-g-blue/10 shadow-g-sm transition-colors duration-[120ms] ease-g hover:bg-g-blue/20 focus-visible:outline-none focus-visible:shadow-g-focus"
      style={{
        left: `${c.region.x * 100}%`,
        top: `${c.region.y * 100}%`,
        width: `${c.region.width * 100}%`,
        height: `${c.region.height * 100}%`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(c.id);
      }}
    />
  ));
}

const ctxMenuContentCls =
  "z-[1300] min-w-[220px] max-w-[320px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.98)] p-1.5 shadow-g-md";
const ctxMenuItemCls =
  "flex w-full min-h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3 py-1.5 font-g text-g-ui text-white outline-none transition-colors duration-[120ms] ease-g hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-default";
const ctxMenuSepCls = "mx-2 my-1 h-px bg-white/[0.08]";
const ctxMenuLabelCls =
  "px-3 py-1.5 font-g text-g-caption text-white/50 select-text";
const CANVAS_CONVERT_FORMATS = ["avif", "webp", "jpeg", "png"] as const;

function normalizeImageFormat(format: string) {
  const normalized = format.replace(/^\./, "").toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return normalized || "image";
}

function autoConvertFormat(asset: AssetCanvasCard["asset"]) {
  const source = normalizeImageFormat(asset.image.format || asset.ext);
  if (source === "png" && asset.image.alpha) return "webp";
  if (source === "avif") return "webp";
  if (source === "gif") return "webp";
  return "avif";
}

export type ImageCardContextMenuProps = {
  onAddComment?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
};

export type AssetContextMenuProps = ImageCardContextMenuProps & {
  card: AssetCanvasCard;
  onOpenAsset?: () => void;
  onRenderPreview?: (outputFormat?: string) => void;
  working?: boolean;
};

export function AssetContextMenu({
  card,
  onOpenAsset,
  onRenderPreview,
  onAddComment,
  onDuplicate,
  onDelete,
  working,
}: AssetContextMenuProps) {
  const { t } = useTranslation();
  const asset = card.asset;
  const tags = tagLabel(asset);
  const [convertOpen, setConvertOpen] = useState(false);
  const sourceFormat = normalizeImageFormat(
    asset.image.format || asset.ext,
  ).toUpperCase();
  const autoFormat = autoConvertFormat(asset).toUpperCase();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">
          {fileName(asset.repoPath)}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-white/36">
          {asset.repoPath}
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      <div className="px-3 py-1.5 font-g text-[11px] text-white/50">
        <span>{formatExt(asset.ext).toUpperCase()}</span>
        <span className="mx-1.5 text-white/20">·</span>
        <span>{imageMeta(asset)}</span>
        {asset.usedBy.length > 0 && (
          <>
            <span className="mx-1.5 text-white/20">·</span>
            <span className="text-white/60">
              {t("aiCanvas.references", { count: asset.usedBy.length })}
            </span>
          </>
        )}
        {tags && <div className="mt-1 truncate text-white/40">{tags}</div>}
      </div>
      {asset.aiTag?.description && (
        <div className="line-clamp-2 px-3 pb-1 font-g text-[11px] leading-[1.45] text-white/36">
          {asset.aiTag.description}
        </div>
      )}
      <div className={ctxMenuSepCls} />
      {onRenderPreview && (
        <div className="px-1 py-1">
          <button
            type="button"
            className={ctxMenuItemCls}
            disabled={working}
            aria-expanded={convertOpen}
            onClick={(event) => {
              event.stopPropagation();
              setConvertOpen((open) => !open);
            }}
          >
            <ImagePlus size={14} className="shrink-0 text-white/46" />
            <span className="min-w-0 flex-1 text-left">
              <span className="font-[590]">
                {t("aiCanvas.convertHeader", { ext: sourceFormat })}
              </span>
              <span className="ml-1.5 font-g-mono text-white/54">
                {autoFormat}
              </span>
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-white/42 transition-transform duration-[120ms] ease-g",
                convertOpen && "rotate-180",
              )}
            />
          </button>
          {convertOpen && (
            <div className="mt-1 border-t border-white/[0.08] pt-1">
              <button
                type="button"
                className={ctxMenuItemCls}
                disabled={working}
                onClick={() => onRenderPreview(autoConvertFormat(asset))}
              >
                <span className="w-5 shrink-0" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="font-[590]">
                    {t("aiCanvas.convertAuto")}
                  </span>
                  <span className="mx-1.5 text-white/28">·</span>
                  <span className="text-white/54">{autoFormat}</span>
                </span>
                <Check size={14} className="shrink-0 text-white/78" />
              </button>
              {CANVAS_CONVERT_FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  className={ctxMenuItemCls}
                  disabled={working}
                  onClick={() => onRenderPreview(format)}
                >
                  <span className="w-5 shrink-0" />
                  <span className="font-g-mono text-[15px] font-[590] uppercase tracking-[-0.02em]">
                    {format}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onAddComment && (
        <button type="button" className={ctxMenuItemCls} onClick={onAddComment}>
          <MessageCircle size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.comment")}
        </button>
      )}
      {onOpenAsset && (
        <button type="button" className={ctxMenuItemCls} onClick={onOpenAsset}>
          <ExternalLink size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.openAsset")}
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={ctxMenuItemCls} onClick={onDuplicate}>
          <Copy size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.duplicateImage")}
        </button>
      )}
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

export type UploadContextMenuProps = ImageCardContextMenuProps & {
  card: UploadCanvasCard;
};

export function UploadContextMenu({
  card,
  onAddComment,
  onDuplicate,
  onDelete,
}: UploadContextMenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={ctxMenuLabelCls}>
        <div className="truncate font-[590] text-white">{card.fileName}</div>
        <div className="mt-0.5 text-[11px] text-white/36">
          {card.uploadWidth}×{card.uploadHeight} · upload
        </div>
      </div>
      <div className={ctxMenuSepCls} />
      {onAddComment && (
        <button type="button" className={ctxMenuItemCls} onClick={onAddComment}>
          <MessageCircle size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.comment")}
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={ctxMenuItemCls} onClick={onDuplicate}>
          <Copy size={14} className="shrink-0 text-white/46" />
          {t("aiCanvas.duplicateImage")}
        </button>
      )}
      <div className={ctxMenuSepCls} />
      <button
        type="button"
        className={cn(ctxMenuItemCls, "text-[#ff453a]")}
        onClick={onDelete}
      >
        <Trash2 size={14} className="shrink-0" />
        {t("aiCanvas.deleteCard")}
      </button>
    </>
  );
}

function ContextMenuHint() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(
    () => !localStorage.getItem(CONTEXT_MENU_HINT_KEY),
  );

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setVisible(false);
      localStorage.setItem(CONTEXT_MENU_HINT_KEY, "1");
    }, 6000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
      <div className="rounded-g-sm bg-g-ink/70 px-2.5 py-1 font-g text-[11px] text-white/90 shadow-g-sm backdrop-blur-sm animate-[canvasCardIn_280ms_var(--g-ease-out)_both]">
        {t("aiCanvas.rightClickHint")}
      </div>
    </div>
  );
}

function isScreenStableCard(card: CanvasCard) {
  return (
    card.kind === "comment" ||
    card.kind === "assistant" ||
    card.kind === "proposal" ||
    card.kind === "operation"
  );
}

function floatingCardLayer(card: CanvasCard, selected: boolean) {
  if (card.kind === "comment") return selected ? "z-[1200]" : "z-[1100]";
  if (isScreenStableCard(card)) return selected ? "z-[1000]" : "z-[900]";
  return selected ? "z-40" : undefined;
}

export function CardShell({
  card,
  selected,
  compact,
  width,
  children,
  contextMenu,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDelete,
  onResize,
  onRegister,
  position,
  canvasScale = 1,
}: {
  card: CanvasCard;
  selected: boolean;
  compact?: boolean;
  width?: number;
  children: ReactNode;
  contextMenu?: ReactNode;
  position?: { x: number; y: number };
  canvasScale?: number;
  onSelect: (id: string, shiftKey?: boolean) => void;
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
  const [isNewCard] = useState(
    () => Date.now() - Date.parse(card.createdAt) < 1200,
  );
  const [hovered, setHovered] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(
    () => !!localStorage.getItem(CONTEXT_MENU_HINT_KEY),
  );
  const [ctxMenuPos, setCtxMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const stableCard = isScreenStableCard(card);
  const screenStableScale = stableCard && canvasScale > 0 ? 1 / canvasScale : 1;
  const shellScale = stableCard
    ? "var(--ai-canvas-stable-scale, 1)"
    : String(screenStableScale);
  const chromeless = isImageCard(card);
  const imageLabel = chromeless
    ? card.kind === "asset"
      ? fileName(card.asset.repoPath)
      : card.fileName
    : undefined;

  function handleResizeDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: width ?? CARD_WIDTH };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current || !onResize) return;
    const delta = e.clientX - resizeRef.current.startX;
    const next = Math.max(80, resizeRef.current.startW + delta);
    onResize(card.id, next);
  }

  function handleResizeUp() {
    resizeRef.current = null;
  }

  function dismissHint() {
    if (!hintDismissed) {
      setHintDismissed(true);
      localStorage.setItem(CONTEXT_MENU_HINT_KEY, "1");
    }
  }

  function handleContextMenu(e: React.MouseEvent<HTMLElement>) {
    if (!chromeless || !contextMenu) return;
    e.preventDefault();
    dismissHint();
    const rect = e.currentTarget.getBoundingClientRect();
    const effectiveScale = Math.max(0.01, canvasScale * screenStableScale);
    setCtxMenuPos({
      x: (e.clientX - rect.left) / effectiveScale,
      y: (e.clientY - rect.top) / effectiveScale,
    });
  }

  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ctxMenuPos) return;
    function dismiss(e: PointerEvent) {
      const menu = ctxMenuRef.current;
      if (menu && e.target instanceof Node && menu.contains(e.target)) return;
      setCtxMenuPos(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCtxMenuPos(null);
    }
    const frame = requestAnimationFrame(() => {
      document.addEventListener("pointerdown", dismiss);
      document.addEventListener("keydown", onKey);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenuPos]);

  const sectionCls = cn(
    "absolute touch-none select-none rounded-g-md transition-[border-color,box-shadow,filter] duration-[120ms] ease-g",
    isNewCard &&
      "animate-[canvasCardIn_280ms_var(--g-ease-out)_both] motion-reduce:animate-none",
    floatingCardLayer(card, selected),
    ctxMenuPos && "!z-[1300]",
    chromeless
      ? cn(
          "overflow-visible border-2 border-transparent shadow-none transition-[border-color,box-shadow,filter]",
          hovered && !selected && "brightness-[1.04] shadow-g-md",
          selected && "border-g-accent shadow-[0_0_0_1px_var(--g-accent)]",
        )
      : compact
        ? cn(
            "border-2 border-transparent shadow-none",
            selected && "border-g-accent shadow-[0_0_0_1px_var(--g-accent)]",
          )
        : cn(
            "overflow-hidden rounded-g-lg bg-g-surface/75 shadow-g-pop backdrop-blur-xl",
            selected && "ring-2 ring-g-active-bg",
          ),
  );

  const cardContent = (
    <section
      className={sectionCls}
      ref={(node) => onRegister(card.id, node)}
      style={{
        width: width ?? CARD_WIDTH,
        transform: `translate3d(${position?.x ?? card.x}px, ${position?.y ?? card.y}px, 0) scale(${shellScale})`,
        transformOrigin: "left top",
      }}
      data-ai-canvas-card="true"
      data-selected={selected || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onSelect(card.id, e.shiftKey);
      }}
      onContextMenu={handleContextMenu}
    >
      {chromeless ? (
        <div
          className="relative cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => onDragStart(event, card)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {children}
          {imageLabel && (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[inherit] bg-gradient-to-t from-black/50 to-transparent px-2.5 pb-2 pt-6 transition-opacity duration-150 ease-g",
                hovered ? "opacity-100" : "opacity-0",
              )}
            >
              <div className="truncate font-g text-[12px] font-[590] tracking-g-ui text-white drop-shadow-sm">
                {imageLabel}
              </div>
            </div>
          )}
          {!hintDismissed && <ContextMenuHint />}
        </div>
      ) : compact ? (
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
            className="flex cursor-grab items-center justify-between gap-2 border-b border-g-line px-3 py-2 active:cursor-grabbing"
            onPointerDown={(event) => onDragStart(event, card)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="flex min-w-0 items-center gap-2 text-g-caption font-[590] tracking-g-ui text-g-ink-2">
              <span className={cn("shrink-0", cardKindAccent(card.kind).text)}>
                {cardKindIcon(card.kind)}
              </span>
              <span className="truncate">{cardDisplayName(card)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(() => {
                const accent = cardKindAccent(card.kind);
                return (
                  <span
                    className={cn(
                      "rounded-[8px] border px-1.5 py-0.5 font-g text-[10px] font-[590] tracking-g-ui",
                      accent.text,
                      accent.bg,
                      accent.border,
                    )}
                  >
                    {t(`aiCanvas.cardKind.${card.kind}`)}
                  </span>
                );
              })()}
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
            chromeless || compact ? "border-[#0d99ff]" : "border-g-active-bg",
          )}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
        />
      )}
      {ctxMenuPos && contextMenu && (
        <div
          ref={ctxMenuRef}
          className={ctxMenuContentCls}
          style={{
            position: "absolute",
            left: ctxMenuPos.x,
            top: ctxMenuPos.y,
            transform: `scale(${1 / Math.max(0.01, canvasScale * screenStableScale)})`,
            transformOrigin: "left top",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCtxMenuPos(null)}
        >
          {contextMenu}
        </div>
      )}
    </section>
  );

  return cardContent;
}

export function AssetCardBody({
  card,
  comments,
  hideOverlays,
  commentEnabled,
  canvasScale = 1,
  onSelectComment,
  onCreateComment,
}: {
  card: AssetCanvasCard;
  comments: CommentCanvasCard[];
  hideOverlays?: boolean;
  commentEnabled?: boolean;
  canvasScale?: number;
  onSelectComment: (commentId: string) => void;
  onCreateComment: (
    anchorCard: CanvasCard,
    text?: string,
    region?: { x: number; y: number; width: number; height: number },
  ) => void;
}) {
  const asset = card.asset;
  const ar =
    asset.image.width > 0 && asset.image.height > 0
      ? asset.image.width / asset.image.height
      : 4 / 3;
  const {
    containerRef: commentContainerRef,
    pointerProps: commentPointerProps,
    overlay: commentOverlay,
  } = useCommentOverlay({
    enabled: !!commentEnabled && !hideOverlays,
    canvasScale,
    onSubmit: (text, region) => onCreateComment(card, text, region),
  });

  return (
    <div
      ref={commentContainerRef}
      data-ai-canvas-image-frame="true"
      data-ai-canvas-asset-frame="true"
      className="relative"
      style={{ aspectRatio: ar }}
      {...commentPointerProps}
    >
      <img
        src={asset.thumbnailUrl || asset.url}
        alt={fileName(asset.repoPath)}
        className="size-full select-none rounded-[inherit] object-contain"
        draggable={false}
        loading="lazy"
      />
      {!hideOverlays && (
        <CommentRegionButtons comments={comments} onSelect={onSelectComment} />
      )}
      {commentOverlay}
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

export function UploadCardBody({
  card,
  comments,
  hideOverlays,
  commentEnabled,
  canvasScale = 1,
  onSelectComment,
  onCreateComment,
}: {
  card: UploadCanvasCard;
  comments: CommentCanvasCard[];
  hideOverlays?: boolean;
  commentEnabled?: boolean;
  canvasScale?: number;
  onSelectComment: (commentId: string) => void;
  onCreateComment?: (
    anchorCard: CanvasCard,
    text?: string,
    region?: CommentRegion,
  ) => void;
}) {
  const previewSrc = `${basePath}/api/image-tools/preview/${card.token}`;
  const {
    containerRef: commentContainerRef,
    pointerProps: commentPointerProps,
    overlay: commentOverlay,
  } = useCommentOverlay({
    enabled: !!commentEnabled && !hideOverlays,
    canvasScale,
    onSubmit: (text, region) => onCreateComment?.(card, text, region),
  });

  return (
    <div
      ref={commentContainerRef}
      data-ai-canvas-image-frame="true"
      className="relative"
      style={{ aspectRatio: compactImageAspectRatio(card) }}
      {...commentPointerProps}
    >
      <img
        src={previewSrc}
        alt={card.fileName}
        className="size-full select-none rounded-[inherit] object-contain"
        draggable={false}
        onError={(e) => {
          if (card.thumbnailDataUrl)
            (e.target as HTMLImageElement).src = card.thumbnailDataUrl;
        }}
      />
      {!hideOverlays && (
        <CommentRegionButtons comments={comments} onSelect={onSelectComment} />
      )}
      {commentOverlay}
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

function proposalParamString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function proposalParamTags(params: Record<string, unknown>) {
  const value = params.tags;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
}

function proposalAssetIds(card: ProposalCanvasCard) {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };
  card.sourceAssetIds?.forEach(add);
  const paramIds = card.params.assetIds;
  if (Array.isArray(paramIds)) paramIds.forEach(add);
  add(card.sourceAssetId);
  add(card.params.assetId);
  return ids;
}

type ProposalItemStatus = {
  assetId?: string;
  repoPath?: string;
  status?: string;
  error?: string;
};

function proposalItemStatuses(result: unknown): ProposalItemStatus[] {
  if (!result || typeof result !== "object") return [];
  const items = (result as { itemStatuses?: unknown }).itemStatuses;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is ProposalItemStatus =>
      Boolean(item) && typeof item === "object",
  );
}

export function ProposalCardBody({ card }: { card: ProposalCanvasCard }) {
  const { t } = useTranslation();
  const isPending = card.status === "pending";
  const isExecuting = card.status === "executing";
  const isCompleted = card.status === "completed";
  const isFailed = card.status === "failed";
  const isRejected = card.status === "rejected";
  const proposalTags =
    card.tool === "update_tags" || card.tool === "batch_update_tags"
      ? proposalParamTags(card.params)
      : [];
  const proposalDescription =
    card.tool === "update_description"
      ? proposalParamString(card.params, "description")
      : undefined;
  const targetAssetIds = proposalAssetIds(card);
  const itemStatuses = proposalItemStatuses(card.result);

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
          {proposalToolLabel(t, card.tool)}
        </Badge>
        {targetAssetIds.length > 1 && (
          <Badge tone="blue">
            {t("aiCanvas.batchAssetCount", {
              count: targetAssetIds.length,
            })}
          </Badge>
        )}
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
      {proposalTags.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.proposalTags")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {proposalTags.map((tag) => (
              <Badge key={tag} tone="line" className="max-w-full truncate">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {proposalDescription && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.proposalDescription")}
          </div>
          <p className="text-g-caption leading-[1.45] text-g-ink-2 break-words">
            {proposalDescription}
          </p>
        </div>
      )}
      {itemStatuses.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 py-2">
          <div className="font-g-mono text-[10px] font-[590] tracking-g-mono text-g-ink-4">
            {t("aiCanvas.batchStatus")}
          </div>
          <div className="flex flex-col gap-1">
            {itemStatuses.slice(0, 6).map((item) => (
              <div
                key={item.assetId ?? item.repoPath}
                className="flex min-w-0 items-center gap-2 text-g-caption"
              >
                <Badge tone={item.status === "completed" ? "green" : "red"}>
                  {item.status === "completed"
                    ? t("aiCanvas.completed")
                    : t("aiCanvas.failed")}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-g-ink-2">
                  {item.repoPath ? fileName(item.repoPath) : item.assetId}
                </span>
              </div>
            ))}
            {itemStatuses.length > 6 && (
              <div className="text-g-caption text-g-ink-4">
                {t("aiCanvas.batchMore", {
                  count: itemStatuses.length - 6,
                })}
              </div>
            )}
          </div>
        </div>
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
  greeting,
  canvasScale = 1,
}: {
  position: { x: number; y: number };
  label?: string;
  status?: "thinking" | "acting" | "idle";
  nickname?: string;
  greeting?: string;
  canvasScale?: number;
}) {
  const active = status === "thinking" || status === "acting";
  const stableScale = canvasScale > 0 ? 1 / canvasScale : 1;
  const [dismissedGreeting, setDismissedGreeting] = useState("");
  useEffect(() => {
    if (!greeting) return;
    const timer = setTimeout(() => setDismissedGreeting(greeting), 3000);
    return () => clearTimeout(timer);
  }, [greeting]);
  const showGreeting = Boolean(greeting) && dismissedGreeting !== greeting;
  const showLabel = active || showGreeting;
  return (
    <div
      className="pointer-events-none absolute z-[1400] transition-[transform] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{
        transform: `translate(${position.x}px, ${position.y}px) scale(${stableScale})`,
        transformOrigin: "left top",
      }}
    >
      <div
        className={cn(
          "flex flex-col items-start",
          showGreeting && "animate-[cursorBounce_600ms_ease-in-out]",
        )}
        style={
          showGreeting
            ? ({
                "--bounce-1": "-12px",
                "--bounce-2": "4px",
                "--bounce-3": "-6px",
                "--bounce-4": "2px",
              } as React.CSSProperties)
            : undefined
        }
      >
        {showGreeting ? (
          <span
            className="inline-block text-[22px] leading-none drop-shadow-md animate-[wave_800ms_ease-in-out_2]"
            style={{ transformOrigin: "70% 70%" }}
          >
            👋
          </span>
        ) : status === "thinking" ? (
          <span className="inline-block text-[18px] leading-none drop-shadow-md animate-[cursorFloat_1.2s_ease-in-out_infinite]">
            🤔
          </span>
        ) : status === "acting" ? (
          <span className="inline-block text-[18px] leading-none drop-shadow-md animate-[cursorWrite_600ms_ease-in-out_infinite]">
            ✍️
          </span>
        ) : (
          <MousePointer2
            size={22}
            strokeWidth={2.5}
            className="drop-shadow-md transition-all duration-500 fill-g-purple/60 text-white/70"
          />
        )}
        <div
          className={cn(
            "-mt-1 ml-3 flex items-center gap-1 whitespace-nowrap rounded-g-sm px-1.5 py-0.5 text-[10px] font-[590] tracking-g-ui text-white shadow-g-sm transition-all duration-500",
            showLabel ? "bg-g-purple opacity-100" : "bg-g-purple/60 opacity-60",
          )}
        >
          <span>{nickname || "Aisets"}</span>
          {showGreeting && !active && greeting && (
            <span className="max-w-[360px] min-w-0 whitespace-nowrap opacity-80 animate-[fadeIn_400ms_var(--g-ease)]">
              · {greeting}
            </span>
          )}
          {active && label && (
            <span className="max-w-[360px] min-w-0 whitespace-nowrap opacity-80">
              · {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

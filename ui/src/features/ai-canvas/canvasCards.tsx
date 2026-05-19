import {
  Bot,
  ImagePlus,
  Layers3,
  Lightbulb,
  MessageCircle,
  MousePointer2,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fileName } from "@/ui";
import { cardDisplayName, type CanvasCard } from "./aiCanvasState";
import { CARD_WIDTH, isImageCard } from "./canvasUtils";

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
    case "group":
      return <Layers3 size={size} />;
    case "text":
      return <Type size={size} />;
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
    case "group":
      return {
        text: "text-g-ink-3",
        bg: "bg-g-surface-2",
        border: "border-g-line",
      };
    case "text":
      return {
        text: "text-g-cyan",
        bg: "bg-g-cyan/10",
        border: "border-g-cyan/20",
      };
    default:
      return {
        text: "text-g-ink-3",
        bg: "bg-g-surface-2",
        border: "border-g-line",
      };
  }
}

const ctxMenuContentCls =
  "z-[1300] min-w-[220px] max-w-[320px] rounded-[18px] border border-white/[0.08] bg-[rgba(31,31,31,0.98)] p-1.5 shadow-g-md";

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

function isChromelessImageCard(card: CanvasCard) {
  return isImageCard(card) || card.kind === "text" || card.kind === "drawing";
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
  onTextEdit,
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
  onResize?: (id: string, width: number, startWidth: number) => void;
  onRegister: (id: string, node: HTMLElement | null) => void;
  onTextEdit?: () => void;
}) {
  const { t } = useTranslation();
  const resizeRef = useRef<{
    startX: number;
    startW: number;
    scale: number;
  } | null>(null);
  const textTapRef = useRef<{ x: number; y: number } | null>(null);
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
  const chromeless = isChromelessImageCard(card);
  const imageLabel = chromeless
    ? card.kind === "asset"
      ? fileName(card.asset.repoPath)
      : card.kind === "upload"
        ? card.fileName
        : card.kind === "variant"
          ? card.sourceName
          : card.kind === "group"
            ? card.name ||
              t("aiCanvas.groupLabel", { count: card.cards.length })
            : card.kind === "text"
              ? cardDisplayName(card)
              : undefined
    : undefined;

  function handleResizeDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const effectiveScale = Math.max(0.01, canvasScale * screenStableScale);
    resizeRef.current = {
      startX: e.clientX,
      startW: width ?? CARD_WIDTH,
      scale: effectiveScale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current || !onResize) return;
    const delta =
      (e.clientX - resizeRef.current.startX) / resizeRef.current.scale;
    const next = Math.max(80, resizeRef.current.startW + delta);
    onResize(card.id, next, resizeRef.current.startW);
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

  const isTextKind = card.kind === "text";
  const isDrawingKind = card.kind === "drawing";
  const isMinimalChromeKind = isTextKind || isDrawingKind;
  const sectionCls = cn(
    "absolute touch-none select-none rounded-g-md transition-[border-color,box-shadow,filter] duration-[120ms] ease-g",
    isNewCard &&
      "animate-[canvasCardIn_420ms_var(--g-ease-out)_both] motion-reduce:animate-none",
    floatingCardLayer(card, selected),
    ctxMenuPos && "!z-[1300]",
    chromeless
      ? isMinimalChromeKind
        ? cn(
            "overflow-visible border border-transparent shadow-none",
            selected && "border-dashed border-g-accent/70 [box-shadow:none]",
          )
        : cn(
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
            "overflow-hidden rounded-g-lg border border-transparent bg-g-surface/75 shadow-g-pop backdrop-blur-xl [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80",
            selected && "ring-1 ring-g-active-bg",
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
        if (isTextKind && onTextEdit) {
          textTapRef.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        if (!isTextKind || !onTextEdit) return;
        const start = textTapRef.current;
        textTapRef.current = null;
        if (!start) return;
        if (
          Math.abs(e.clientX - start.x) < 4 &&
          Math.abs(e.clientY - start.y) < 4
        ) {
          onTextEdit();
        }
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
          {imageLabel && !isTextKind && (
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
          {!hintDismissed && !isTextKind && <ContextMenuHint />}
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
            "absolute z-50 cursor-nwse-resize rounded-full border-2 bg-g-surface shadow-g-sm",
            isTextKind
              ? "-bottom-1 -right-1 size-2.5 border border-g-accent/80 opacity-80"
              : "-bottom-1.5 -right-1.5 size-3 border-2",
            !isTextKind &&
              (chromeless || compact
                ? "border-[#0d99ff]"
                : "border-g-active-bg"),
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

  function renderIcon() {
    if (showGreeting) {
      return (
        <span
          className="inline-block text-[22px] leading-none drop-shadow-md animate-[wave_800ms_ease-in-out_2]"
          style={{ transformOrigin: "70% 70%" }}
        >
          👋
        </span>
      );
    }
    if (status === "thinking") {
      return (
        <div className="flex h-[22px] w-[22px] items-center justify-center gap-[2.5px] rounded-full bg-g-purple/80 shadow-md">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-1 w-1 rounded-full bg-white animate-[cursorDot_1.2s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      );
    }
    return (
      <MousePointer2
        size={22}
        strokeWidth={2.5}
        className="fill-g-purple/60 text-white drop-shadow-md transition-all duration-500"
      />
    );
  }

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
      >
        {renderIcon()}
        <div
          className={cn(
            "-mt-1 ml-3 flex max-w-[280px] min-w-0 items-center gap-1 whitespace-nowrap rounded-g-sm px-1.5 py-0.5 text-[10px] font-[590] tracking-g-ui text-white shadow-g-sm transition-all duration-500",
            showLabel ? "bg-g-purple opacity-100" : "bg-g-purple/60 opacity-60",
          )}
        >
          <span className="shrink-0">{nickname || "Aisets"}</span>
          {showGreeting && !active && greeting && (
            <span className="min-w-0 truncate opacity-80 animate-[fadeIn_400ms_var(--g-ease)]">
              · {greeting}
            </span>
          )}
          {active && label && (
            <span className="min-w-0 truncate opacity-80">· {label}</span>
          )}
        </div>
      </div>
    </div>
  );
}

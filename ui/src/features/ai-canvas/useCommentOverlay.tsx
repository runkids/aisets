/* eslint-disable react-refresh/only-export-components */
import { ArrowUp, Bot } from "lucide-react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { CommentCanvasCard } from "./aiCanvasState";
import {
  AI_MENTION_TAG,
  commentRegionDisplayOptions,
  normalizeCommentRegion,
} from "./canvasUtils";

export type CommentRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

export function FigmaCommentMarker({ className }: { className?: string }) {
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

export function useCommentOverlay(opts: {
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

export function CommentRegionButtons({
  comments,
  basis,
  onSelect,
}: {
  comments: CommentCanvasCard[];
  basis?: { width: number; height: number };
  onSelect: (commentId: string) => void;
}) {
  const { t } = useTranslation();
  return comments.map((c) => {
    const region = normalizeCommentRegion(
      c.region,
      basis,
      commentRegionDisplayOptions(c.isAi),
    );
    return (
      <button
        key={c.id}
        type="button"
        aria-label={c.text || t("aiCanvas.commentCard")}
        className="absolute rounded-g-sm border-2 border-g-blue bg-g-blue/10 shadow-g-sm transition-colors duration-[120ms] ease-g hover:bg-g-blue/20 focus-visible:outline-none focus-visible:shadow-g-focus"
        style={{
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.width * 100}%`,
          height: `${region.height * 100}%`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(c.id);
        }}
      />
    );
  });
}

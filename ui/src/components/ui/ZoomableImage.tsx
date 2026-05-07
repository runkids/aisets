import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { cn } from "@/lib/cn";
import {
  imageBackgroundClassName,
  useImageBackgroundMode,
} from "@/imageBackground";

type ZoomableImageProps = {
  src: string;
  alt?: string;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
};

const ZOOM_STEP = 0.15;

function ZoomableImage({
  src,
  alt = "",
  className,
  minZoom = 1,
  maxZoom = 8,
}: ZoomableImageProps) {
  const bgMode = useImageBackgroundMode();
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const applyScale = useCallback(
    (nextScale: number) => {
      const next = Math.min(maxZoom, Math.max(minZoom, nextScale));
      setScale(next);
      if (next <= minZoom) setTranslate({ x: 0, y: 0 });
    },
    [minZoom, maxZoom],
  );

  const reset = useCallback(() => {
    applyScale(minZoom);
  }, [applyScale, minZoom]);

  const zoomIn = useCallback(() => {
    applyScale(scale + ZOOM_STEP * scale);
  }, [applyScale, scale]);

  const zoomOut = useCallback(() => {
    applyScale(scale - ZOOM_STEP * scale);
  }, [applyScale, scale]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      applyScale(scale + delta * scale);
    },
    [applyScale, scale],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (scale <= minZoom) return;
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [minZoom, scale],
  );

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const zoomed = scale > minZoom;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-g-md border border-g-line",
        imageBackgroundClassName(bgMode),
        zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        className,
      )}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={reset}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="size-full select-none object-contain transition-transform duration-100 ease-g"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
        }}
      />
      <div
        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-g-md border border-g-line bg-g-surface/90 p-1 shadow-g-sm backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="grid size-6 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label="Zoom out"
          disabled={!zoomed}
          onClick={zoomOut}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="min-w-10 text-center font-g-mono text-g-chip text-g-ink-3">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="grid size-6 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label="Zoom in"
          disabled={scale >= maxZoom}
          onClick={zoomIn}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="grid size-6 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label="Reset zoom"
          disabled={!zoomed}
          onClick={reset}
        >
          <RotateCcw size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export { ZoomableImage };

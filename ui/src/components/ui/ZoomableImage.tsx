import { Minus, Plus, RotateCcw, X, ZoomIn } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";
import {
  imageBackgroundClassName,
  useImageBackgroundMode,
} from "@/imageBackground";
import { DialogOverlay } from "./DialogShell";

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
  const [isDragging, setIsDragging] = useState(false);
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

  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      applyScale(scaleRef.current + delta * scaleRef.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyScale]);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (scale <= minZoom) return;
      setIsDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [minZoom, scale],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
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
      style={{ touchAction: "none" }}
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
        className={cn(
          "size-full select-none object-contain",
          !isDragging && "transition-transform duration-100 ease-g",
        )}
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

type ImageLightboxProps = {
  src: string;
  alt?: string;
  className?: string;
};

function ImageLightbox({ src, alt = "", className }: ImageLightboxProps) {
  const { t } = useTranslation();
  const bgMode = useImageBackgroundMode();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={cn(
          "group relative overflow-hidden rounded-g-md border border-g-line cursor-zoom-in",
          imageBackgroundClassName(bgMode),
          className,
        )}
        onClick={() => setOpen(true)}
        aria-label={t("assetDrawer.clickToZoom")}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="size-full select-none object-contain"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-[background] duration-150 group-hover:bg-black/20">
          <span className="flex items-center gap-1.5 rounded-g-md bg-g-surface/90 px-2.5 py-1.5 text-g-caption font-medium text-g-ink opacity-0 shadow-g-sm backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100">
            <ZoomIn size={14} aria-hidden="true" />
            {t("assetDrawer.clickToZoom")}
          </span>
        </div>
      </button>

      {open && (
        <LightboxDialog src={src} alt={alt} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function clampScale(s: number) {
  return Math.min(8, Math.max(1, s));
}

function LightboxDialog({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const CLICK_THRESHOLD = 5;
  const CLICK_ZOOM = 2;

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const applyZoom = useCallback((next: number) => {
    const clamped = clampScale(next);
    setScale(clamped);
    if (clamped <= 1) setTranslate({ x: 0, y: 0 });
  }, []);

  const reset = useCallback(() => applyZoom(1), [applyZoom]);

  const zoomIn = useCallback(
    () => setScale((s) => clampScale(s + ZOOM_STEP * s)),
    [],
  );

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const next = clampScale(s - ZOOM_STEP * s);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // prevent browser zoom & handle wheel/pinch at document level
  useEffect(() => {
    let gestureBaseScale = 1;

    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      const cur = scaleRef.current;
      let next: number;
      if (e.ctrlKey) {
        next = cur * (1 - e.deltaY * 0.01);
      } else {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        next = cur + delta * cur;
      }
      next = clampScale(next);
      setScale(next);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureBaseScale = scaleRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number };
      const next = clampScale(gestureBaseScale * ge.scale);
      setScale(next);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
    };
    const onGestureEnd = (e: Event) => e.preventDefault();

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", onGestureStart, {
      passive: false,
    });
    document.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    document.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
      document.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  // pointer helpers for single-finger drag and two-finger touch pinch
  function pointerDist(ptrs: Map<number, { x: number; y: number }>) {
    const vals = [...ptrs.values()];
    const dx = vals[0].x - vals[1].x;
    const dy = vals[0].y - vals[1].y;
    return Math.hypot(dx, dy);
  }

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      downPosRef.current = { x: e.clientX, y: e.clientY };
      if (pointersRef.current.size === 2) {
        pinchRef.current = {
          dist: pointerDist(pointersRef.current),
          scale: scaleRef.current,
        };
        setIsDragging(false);
        return;
      }
      if (pointersRef.current.size === 1 && scale > 1) {
        setIsDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [scale],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      if (pointersRef.current.size === 2 && pinchRef.current) {
        const newDist = pointerDist(pointersRef.current);
        const ratio = newDist / pinchRef.current.dist;
        const next = clampScale(pinchRef.current.scale * ratio);
        setScale(next);
        if (next <= 1) setTranslate({ x: 0, y: 0 });
        return;
      }
      if (!isDragging) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const down = downPosRef.current;
    const wasDrag =
      !down ||
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_THRESHOLD;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    downPosRef.current = null;
    setIsDragging(false);

    // single-pointer click on image → toggle zoom
    if (
      !wasDrag &&
      pointersRef.current.size === 0 &&
      e.target instanceof HTMLImageElement
    ) {
      const cur = scaleRef.current;
      if (cur > 1) {
        applyZoom(1);
      } else {
        applyZoom(CLICK_ZOOM);
      }
    }
  }, [applyZoom]);

  const zoomed = scale > 1;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay layer="modal" />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          aria-label={alt || t("assetDrawer.clickToZoom")}
          className="fixed inset-0 z-[120] outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div
            ref={containerRef}
            className={cn(
              "absolute inset-0 flex items-center justify-center",
              isDragging
                ? "cursor-grabbing"
                : zoomed
                  ? "cursor-zoom-out"
                  : "cursor-zoom-in",
            )}
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              className={cn(
                "max-h-[85vh] max-w-[90vw] select-none object-contain",
                !isDragging &&
                  !pinchRef.current &&
                  "transition-transform duration-150 ease-g",
              )}
              style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              }}
            />
          </div>

          {/* fixed toolbar — independent of image */}
          <div className="fixed bottom-6 left-1/2 z-[121] flex -translate-x-1/2 items-center gap-1 rounded-g-md border border-g-line bg-g-surface/90 p-1 shadow-g-pop backdrop-blur-sm">
            <button
              type="button"
              className="grid size-7 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
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
              className="grid size-7 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
              aria-label="Zoom in"
              disabled={scale >= 8}
              onClick={zoomIn}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="grid size-7 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink disabled:cursor-not-allowed disabled:opacity-[0.38]"
              aria-label="Reset zoom"
              disabled={!zoomed}
              onClick={reset}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
            <div className="mx-1 h-4 w-px bg-g-line" />
            <button
              type="button"
              className="grid size-7 place-items-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { ZoomableImage, ImageLightbox };

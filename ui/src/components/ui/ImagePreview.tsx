import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  imageBackgroundClassName,
  useImageBackgroundMode,
} from "@/imageBackground";

type ImagePreviewProps = {
  src: string;
  alt?: string;
  children: ReactNode;
  delay?: number;
  delayMs?: number;
  enabled?: boolean;
  size?: "sm" | "md" | "lg" | { width: number; height: number };
};

const PREVIEW_SIZES = {
  sm: { width: 240, height: 200 },
  md: { width: 320, height: 260 },
  lg: { width: 480, height: 400 },
};

function previewSize(size: NonNullable<ImagePreviewProps["size"]>) {
  return typeof size === "string" ? PREVIEW_SIZES[size] : size;
}

export function ImagePreview({
  src,
  alt = "",
  children,
  delay = 1500,
  delayMs,
  enabled = true,
  size = "lg",
}: ImagePreviewProps) {
  const bgMode = useImageBackgroundMode();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<number | null>(null);
  const dims = previewSize(size);
  const effectiveDelay = delayMs ?? delay;

  const clear = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    if (!enabled || !src) return;
    clear();
    timerRef.current = window.setTimeout(
      () => setVisible(true),
      effectiveDelay,
    );
  }, [clear, effectiveDelay, enabled, src]);

  const handleLeave = useCallback(() => {
    clear();
    setVisible(false);
  }, [clear]);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      setPos({ x: e.clientX, y: e.clientY });
    },
    [enabled],
  );

  useEffect(() => () => clear(), [clear]);
  useEffect(() => {
    if (!enabled) clear();
  }, [clear, enabled]);

  const spaceRight = pos.x > 0 ? window.innerWidth - pos.x : 0;
  const leftPos =
    spaceRight > dims.width + 24
      ? pos.x + 12
      : pos.x > dims.width + 24
        ? pos.x - dims.width - 12
        : Math.max(16, (window.innerWidth - dims.width) / 2);

  const previewStyle: React.CSSProperties = {
    position: "fixed",
    left: leftPos,
    top: Math.max(
      8,
      Math.min(pos.y - dims.height / 2, window.innerHeight - dims.height - 16),
    ),
    width: dims.width,
    zIndex: 200,
  };

  return (
    <div
      className="contents"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMove}
    >
      {children}
      {visible &&
        enabled &&
        src &&
        createPortal(
          <div
            className="overflow-hidden rounded-g-lg border border-g-line-strong bg-g-surface-2 p-1.5 shadow-g-pop pointer-events-none animate-[fadeIn_160ms_var(--g-ease)]"
            style={previewStyle}
          >
            <div
              className={cn(
                "overflow-hidden rounded-g-md",
                imageBackgroundClassName(bgMode),
              )}
              style={{ height: dims.height }}
            >
              <img src={src} alt={alt} className="size-full object-contain" />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

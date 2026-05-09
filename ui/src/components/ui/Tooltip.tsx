import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Keycap } from "./Keycap";

type Placement = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

type TooltipProps = {
  label: ReactNode;
  shortcut?: string;
  placement?: Placement;
  align?: Align;
  delay?: number;
  disabled?: boolean;
  contentClassName?: string;
  children: ReactNode;
};

const OFFSET = 12;
const MARGIN = 8;

function Tooltip({
  label,
  shortcut,
  placement = "bottom",
  // align kept in type for API compat; cursor-following ignores it
  align: _align = "center",
  delay = 200,
  disabled,
  contentClassName,
  children,
}: TooltipProps) {
  void _align;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const visibleRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const latestCursor = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !pos) return;

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = pos.x;
    let y = pos.y;

    if (placement === "top") {
      y = pos.y - h - OFFSET;
    }

    if (x + w > vw - MARGIN) x = vw - MARGIN - w;
    if (x < MARGIN) x = MARGIN;
    if (y + h > vh - MARGIN) y = pos.y - h - OFFSET * 2;
    if (y < MARGIN) y = MARGIN;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = "visible";
  }, [pos, placement]);

  const show = useCallback(
    (e: React.MouseEvent) => {
      latestCursor.current = {
        x: e.clientX + OFFSET,
        y: e.clientY + OFFSET,
      };
      timerRef.current = setTimeout(() => {
        visibleRef.current = true;
        setPos({ ...latestCursor.current });
      }, delay);
    },
    [delay],
  );

  const move = useCallback((e: React.MouseEvent) => {
    latestCursor.current = { x: e.clientX + OFFSET, y: e.clientY + OFFSET };
    if (visibleRef.current && rafRef.current === undefined) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined;
        setPos({ ...latestCursor.current });
      });
    }
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    visibleRef.current = false;
    setPos(null);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  if (disabled) return <>{children}</>;

  return (
    <>
      <span
        className="contents"
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseMove={move}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            ref={tooltipRef}
            className={cn(
              "fixed z-[9999] max-w-[280px] rounded-g-md px-2.5 py-1.5 shadow-g-pop",
              "bg-g-ink text-g-canvas",
              "text-[12px] font-[510] leading-[1.4] tracking-[-0.011em]",
              "pointer-events-none",
              contentClassName,
            )}
            style={{ left: 0, top: 0, visibility: "hidden" }}
          >
            {shortcut ? (
              <span className="inline-flex items-center gap-1.5">
                <span>{label}</span>
                <Keycap size="sm" surface="strong">
                  {shortcut}
                </Keycap>
              </span>
            ) : (
              label
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export { Tooltip };

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const statCardVariants = cva(
  [
    "overflow-hidden rounded-g-md border border-g-line bg-g-surface px-5 py-[18px] text-left shadow-g-sm",
    "transition-[border-color,box-shadow,transform] duration-[120ms] ease-g",
    "data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:-translate-y-0.5",
    "data-[clickable=true]:hover:border-g-line-strong data-[clickable=true]:hover:shadow-g-md",
    "data-[clickable=true]:focus-visible:outline-none data-[clickable=true]:focus-visible:shadow-g-focus",
    "motion-reduce:data-[clickable=true]:hover:translate-y-0",
  ],
  {
    variants: {
      tone: {
        neutral: "[--stat-tone:var(--g-ink-4)]",
        accent: "[--stat-tone:var(--g-accent)]",
        green: "[--stat-tone:var(--g-green)]",
        red: "[--stat-tone:var(--g-red)]",
        amber: "[--stat-tone:var(--g-amber)]",
        blue: "[--stat-tone:var(--g-blue)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

function parseNumericValue(value: string | number) {
  if (typeof value === "number") return { num: value, suffix: "", decimals: 0 };
  const m = value.match(/^([\d.]+)\s*(.*)$/);
  if (!m) return { num: null, suffix: "", decimals: 0 };
  const n = parseFloat(m[1]);
  const d = m[1].split(".")[1];
  return { num: isNaN(n) ? null : n, suffix: m[2], decimals: d?.length ?? 0 };
}

function useAnimatedValue(
  value: string | number,
  duration = 400,
): string | number {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef<string | number>(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = parseNumericValue(prevRef.current);
    const to = parseNumericValue(value);
    prevRef.current = value;

    cancelAnimationFrame(rafRef.current);

    const skipAnim =
      from.num == null ||
      to.num == null ||
      from.num === to.num ||
      (from.suffix !== to.suffix && from.num !== 0);

    if (skipAnim || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const startTime = performance.now();
    const f = from.num!;
    const t = to.num!;
    const dec = to.decimals;
    const suf = to.suffix;

    function tick(now: number) {
      const p = Math.min((now - startTime) / duration, 1);
      if (p >= 1) {
        setDisplay(value);
        return;
      }
      const eased = 1 - (1 - p) ** 3;
      const cur = f + (t - f) * eased;
      const txt = dec > 0 ? cur.toFixed(dec) : Math.round(cur).toString();
      setDisplay(suf ? `${txt} ${suf}` : dec > 0 ? txt : Math.round(cur));
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return display;
}

type StatCardProps = VariantProps<typeof statCardVariants> & {
  label: string;
  value: string | number;
  meta?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function StatCard({
  label,
  value,
  meta,
  icon,
  onClick,
  tone,
  className,
}: StatCardProps) {
  const animatedValue = useAnimatedValue(value);
  const content = (
    <>
      <div className="flex items-center gap-1.5 font-g text-g-chip font-[510] uppercase tracking-[0.08em] text-g-ink-4">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-g-display text-4xl font-[590] leading-none tracking-[-0.035em] text-g-ink tabular-nums">
        {animatedValue}
      </div>
      {meta && <div className="mt-1.5 text-g-caption text-g-ink-3">{meta}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(statCardVariants({ tone }), className)}
        data-clickable="true"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cn(statCardVariants({ tone }), className)}>{content}</div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { statCardVariants };

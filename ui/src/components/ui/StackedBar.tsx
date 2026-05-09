import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

type StackedBarTone =
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "blue"
  | "accent"
  | "neutral";

export type StackedBarSegment = {
  value: number;
  tone: StackedBarTone;
  label?: string;
};

type StackedBarProps = {
  segments: StackedBarSegment[];
  total?: number;
  className?: string;
  ariaLabel?: string;
  trackTone?: StackedBarTone;
};

const segmentVariants = cva(
  "transition-[width] duration-300 ease-g first:rounded-l-full last:rounded-r-full",
  {
    variants: {
      tone: {
        green: "bg-g-green",
        amber: "bg-g-amber",
        red: "bg-g-red",
        purple: "bg-g-purple",
        blue: "bg-g-blue",
        accent: "bg-g-accent",
        neutral: "bg-g-ink-4",
      },
    },
  },
);

export function StackedBar({
  segments,
  total,
  className,
  ariaLabel,
  trackTone,
}: StackedBarProps) {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0);
  if (sum === 0) return null;

  return (
    <div
      className={cn(
        "flex h-1.5 overflow-hidden rounded-g-pill bg-g-surface-3",
        className,
      )}
      role="img"
      aria-label={ariaLabel}
      data-track-tone={trackTone}
    >
      {segments.map((seg, i) => {
        if (seg.value <= 0) return null;
        const pct = (seg.value / sum) * 100;
        return (
          <span
            key={i}
            className={cn(segmentVariants({ tone: seg.tone }))}
            style={{ width: `${pct}%` }}
            aria-label={seg.label}
          />
        );
      })}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { segmentVariants };

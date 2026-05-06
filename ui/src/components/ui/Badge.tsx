import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type BadgeTone =
  | "default"
  | "line"
  | "green"
  | "red"
  | "amber"
  | "blue"
  | "purple"
  | "info"
  | "accent"
  | "warning"
  | "danger";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const badgeBaseClassName = cn(
  "inline-flex h-[22px] items-center gap-1 rounded-g-pill border border-transparent px-2 font-g-mono text-g-chip font-[510] tracking-g-mono tabular-nums",
);

const badgeToneClassNames: Record<BadgeTone, string> = {
  default: "bg-g-surface-3 text-g-ink-3",
  line: "border-g-line-strong bg-transparent text-g-ink-2",
  green: "bg-g-green-soft text-g-green",
  red: "bg-g-red-soft text-g-red",
  amber: "bg-g-amber-soft text-g-amber",
  blue: "bg-g-blue-soft text-g-blue",
  purple: "bg-g-purple-soft text-g-purple",
  info: "bg-g-info-soft text-g-info",
  accent: "bg-g-accent text-g-accent-ink",
  warning: "bg-g-amber-soft text-g-amber",
  danger: "bg-g-red-soft text-g-red",
};

export function Badge({
  tone = "default",
  children,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(badgeBaseClassName, badgeToneClassNames[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

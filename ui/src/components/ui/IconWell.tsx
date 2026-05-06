import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type IconWellSize = "sm" | "md" | "lg";
type IconWellTone =
  | "neutral"
  | "accent"
  | "green"
  | "red"
  | "amber"
  | "blue"
  | "purple";

type IconWellProps = HTMLAttributes<HTMLDivElement> & {
  size?: IconWellSize;
  tone?: IconWellTone;
  children: ReactNode;
};

const sizeClassNames: Record<IconWellSize, string> = {
  sm: "size-8 rounded-g-sm [&_svg]:size-4",
  md: "size-10 rounded-g-md [&_svg]:size-5",
  lg: "size-12 rounded-g-md [&_svg]:size-6",
};

const toneClassNames: Record<IconWellTone, string> = {
  neutral: "bg-g-surface-2 text-g-ink-2 shadow-g-inset",
  accent: "bg-g-accent text-g-accent-ink",
  green: "bg-g-green-soft text-g-green",
  red: "bg-g-red-soft text-g-red",
  amber: "bg-g-amber-soft text-g-amber",
  blue: "bg-g-blue-soft text-g-blue",
  purple: "bg-g-purple-soft text-g-purple",
};

export function IconWell({
  size = "md",
  tone = "neutral",
  children,
  className,
  ...props
}: IconWellProps) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center",
        sizeClassNames[size],
        toneClassNames[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

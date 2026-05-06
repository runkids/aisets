import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type KeycapProps = ComponentPropsWithoutRef<"kbd"> & {
  size?: "sm" | "md";
  surface?: "default" | "strong";
};

const sizeClassName = {
  sm: "px-[5px] py-px text-[10px] leading-[1.2] tracking-g-mono",
  md: "px-2 py-0.5 text-g-caption leading-[1.33] tracking-[0]",
} as const;

const surfaceClassName = {
  default: "bg-g-surface-2",
  strong: "bg-g-surface-3",
} as const;

function Keycap({
  className,
  size = "md",
  surface = "default",
  ...props
}: KeycapProps) {
  return (
    <kbd
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-g-sm border border-solid border-g-line-strong",
        "font-g-mono font-[510] text-g-ink-3",
        sizeClassName[size],
        surfaceClassName[surface],
        className,
      )}
      {...props}
    />
  );
}

export { Keycap };

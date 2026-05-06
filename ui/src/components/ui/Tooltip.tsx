import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Placement = "top" | "bottom" | "left" | "right";

type TooltipProps = {
  label: ReactNode;
  shortcut?: string;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
  children: ReactNode;
};

function Tooltip({
  label,
  shortcut,
  placement = "bottom",
  delay = 200,
  disabled,
  children,
}: TooltipProps) {
  if (disabled) return <>{children}</>;

  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={placement}
          sideOffset={6}
          className={cn(
            "z-[200] max-w-xs whitespace-nowrap rounded-g-md border border-g-line-strong px-2 py-[5px] shadow-g-md",
            "bg-g-canvas text-g-ink",
            "text-[12px] font-[510] leading-[1.2] tracking-[-0.011em]",
            "pointer-events-none",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <span>{label}</span>
            {shortcut && (
              <kbd
                className={cn(
                  "font-g-mono text-[10px] font-[510] tracking-[-0.015em] text-g-ink-3",
                  "rounded-g-sm border border-g-line-strong bg-g-surface-3 px-[5px] py-px",
                )}
              >
                {shortcut}
              </kbd>
            )}
          </span>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip };

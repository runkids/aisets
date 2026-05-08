import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
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

function Tooltip({
  label,
  shortcut,
  placement = "bottom",
  align = "center",
  delay = 200,
  disabled,
  contentClassName,
  children,
}: TooltipProps) {
  if (disabled) return <>{children}</>;

  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={placement}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          avoidCollisions
          className={cn(
            "z-[200] max-w-xs whitespace-nowrap rounded-g-md border border-g-line-strong px-2 py-[5px] shadow-g-md",
            "bg-g-canvas text-g-ink",
            "text-[12px] font-[510] leading-[1.2] tracking-[-0.011em]",
            "pointer-events-none",
            "animate-in fade-in-0 zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            contentClassName,
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <span>{label}</span>
            {shortcut && (
              <Keycap size="sm" surface="strong">
                {shortcut}
              </Keycap>
            )}
          </span>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip };

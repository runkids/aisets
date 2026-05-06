import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

export type SegmentedControlItem<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
};

const controlVariants = cva(
  "inline-flex items-center border border-g-line rounded-g-md bg-g-surface shadow-g-inset",
  {
    variants: {
      variant: {
        text: "gap-px min-h-[34px] p-[3px]",
        icon: "gap-px min-h-[34px] p-[3px]",
        fixed: "gap-px min-h-[34px] p-[3px]",
        status: "flex w-full min-h-[44px] gap-0.5 p-1",
      },
    },
    defaultVariants: {
      variant: "text",
    },
  },
);

const itemVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 font-g font-[510] leading-none whitespace-nowrap",
    "transition-[background,color,box-shadow] duration-[120ms] ease-g",
    "focus-visible:shadow-g-focus",
    "hover:not-data-[active=true]:bg-g-surface-2 hover:not-data-[active=true]:text-g-ink",
    "data-[active=true]:bg-g-ink data-[active=true]:text-g-canvas data-[active=true]:shadow-g-sm",
  ],
  {
    variants: {
      variant: {
        text: "h-6 min-w-8 px-2.5 rounded-[calc(var(--g-r-md)-2px)] text-[13px] tracking-[-0.012em] text-g-ink-3",
        icon: "size-7 min-w-0 p-0 rounded-[calc(var(--g-r-md)-2px)] text-[13px] tracking-[-0.012em] text-g-ink-3",
        fixed:
          "h-6 w-8 p-0 rounded-[calc(var(--g-r-md)-2px)] text-[13px] tracking-[-0.012em] text-g-ink-3",
        status:
          "min-h-[34px] h-[34px] px-2.5 rounded-[calc(var(--g-r-md)-2px)] text-sm text-g-ink-2 data-[active=true]:text-g-canvas",
      },
    },
    defaultVariants: {
      variant: "text",
    },
  },
);

type SegmentedControlVariant = "icon" | "text" | "fixed" | "status";

type SegmentedControlProps<T extends string> = {
  value: T;
  items: Array<SegmentedControlItem<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: SegmentedControlVariant;
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  variant = "text",
  className,
}: SegmentedControlProps<T>) {
  const role = variant === "status" ? "tablist" : "group";

  return (
    <div
      className={cn(controlVariants({ variant }), className)}
      role={role}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = value === item.value;
        const button = (
          <button
            key={item.value}
            type="button"
            role={variant === "status" ? "tab" : undefined}
            aria-selected={variant === "status" ? active : undefined}
            aria-pressed={variant !== "status" ? active : undefined}
            aria-label={variant === "icon" ? item.label : undefined}
            data-active={active || undefined}
            className={cn(itemVariants({ variant }))}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            {variant !== "icon" && <span>{item.label}</span>}
            {item.badge}
          </button>
        );

        if (variant !== "icon") return button;

        return (
          <Tooltip key={item.value} label={item.label}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { controlVariants, itemVariants };

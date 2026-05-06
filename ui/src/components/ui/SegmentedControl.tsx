import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

export type SegmentedControlItem<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
};

type SegmentedControlVariant = "icon" | "text" | "status";

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
      className={cn(
        "segmented-control",
        `segmented-control--${variant}`,
        className,
      )}
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
            className="segmented-control-item"
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

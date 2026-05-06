import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type TabItem<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
};

type TabsVariant = "segment" | "pills";
type TabsSize = "sm" | "md";

type TabsProps<T extends string> = {
  value: T;
  items: Array<TabItem<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: TabsVariant;
  size?: TabsSize;
  className?: string;
};

const tabsBaseClassName = "inline-flex items-center gap-1";

const tabsVariantClassNames: Record<TabsVariant, string> = {
  segment:
    "rounded-g-md border border-g-line bg-g-surface-2 p-[3px] shadow-g-inset",
  pills: "flex-wrap",
};

const tabBaseClassName = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-g-md border border-transparent font-g font-[510] tracking-g-ui text-g-ink-2 transition-[background,border-color,color,box-shadow] duration-[120ms] ease-g",
  "hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus",
  "[&_svg]:size-[13px] [&_svg]:shrink-0",
);

const tabSizeClassNames: Record<TabsSize, string> = {
  sm: "h-g-btn-sm px-2 text-g-caption",
  md: "h-g-btn-md px-3 text-g-ui",
};

const tabVariantClassNames: Record<TabsVariant, string> = {
  segment:
    "data-[active=true]:bg-g-surface data-[active=true]:text-g-ink data-[active=true]:shadow-g-sm",
  pills:
    "border-g-line-strong bg-transparent data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[590]",
};

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  variant = "segment",
  size = "md",
  className,
}: TabsProps<T>) {
  return (
    <div
      className={cn(
        tabsBaseClassName,
        tabsVariantClassNames[variant],
        className,
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active || undefined}
            className={cn(
              tabBaseClassName,
              tabSizeClassNames[size],
              tabVariantClassNames[variant],
            )}
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

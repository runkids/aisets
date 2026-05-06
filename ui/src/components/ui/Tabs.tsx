import type { ReactNode } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

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

const listVariants = cva("inline-flex items-center gap-1", {
  variants: {
    variant: {
      segment:
        "rounded-g-md border border-g-line bg-g-surface-2 p-[3px] shadow-g-inset",
      pills: "flex-wrap",
    },
  },
  defaultVariants: { variant: "segment" },
});

const triggerVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 rounded-g-md border border-transparent font-g font-[510] tracking-g-ui text-g-ink-2 cursor-pointer",
    "transition-[background,border-color,color,box-shadow] duration-[120ms] ease-g",
    "hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus",
    "[&_svg]:size-[13px] [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        segment:
          "data-[state=active]:bg-g-surface data-[state=active]:text-g-ink data-[state=active]:shadow-g-sm",
        pills:
          "border-g-line-strong bg-transparent data-[state=active]:bg-g-active-bg data-[state=active]:text-g-active-text data-[state=active]:font-[590]",
      },
      size: {
        sm: "h-g-btn-sm px-2 text-g-caption",
        md: "h-g-btn-md px-3 text-g-ui",
      },
    },
    defaultVariants: { variant: "segment", size: "md" },
  },
);

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
    <TabsPrimitive.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      activationMode="manual"
    >
      <TabsPrimitive.List
        className={cn(listVariants({ variant }), className)}
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={triggerVariants({ variant, size })}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

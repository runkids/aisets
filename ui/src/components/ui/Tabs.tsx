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

type TabsVariant = "segment" | "pills" | "underline";
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
      underline:
        "flex w-full gap-4 overflow-x-auto border-b border-g-line bg-g-surface px-6 py-1 max-[600px]:gap-3 max-[600px]:px-4",
    },
  },
  defaultVariants: { variant: "segment" },
});

const triggerVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-g-md border border-transparent font-g font-[510] tracking-g-ui text-g-ink-2 cursor-pointer",
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
        underline:
          "relative !h-auto min-h-10 gap-2 rounded-none border-0 bg-transparent py-1.5 text-g-ink-3 hover:bg-g-surface-2 hover:text-g-ink data-[state=active]:bg-transparent data-[state=active]:text-g-ink data-[state=active]:font-[590] data-[state=active]:shadow-none after:pointer-events-none after:absolute after:inset-x-0 after:bottom-[-5px] after:hidden after:h-[2px] after:rounded-t-g-pill after:bg-g-accent data-[state=active]:after:block",
      },
      size: {
        sm: "h-g-btn-sm px-2 text-g-caption",
        md: "h-g-btn-md px-3 text-g-ui",
      },
    },
    compoundVariants: [
      { variant: "underline", size: "sm", class: "px-2.5 text-g-ui" },
      { variant: "underline", size: "md", class: "px-2.5 text-g-ui" },
    ],
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
            className={cn(triggerVariants({ variant, size }))}
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

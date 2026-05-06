import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type SelectSize = "sm" | "md";

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  size?: SelectSize;
  className?: string;
};

const triggerVariants = cva(
  [
    "inline-flex w-full items-center gap-2 rounded-g-md bg-g-surface px-3 font-g font-[510] tracking-g-ui text-g-ink",
    "border border-g-line shadow-g-inset",
    "transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
    "hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus",
    "data-[placeholder]:text-g-ink-3",
  ],
  {
    variants: {
      size: {
        sm: "h-g-btn-sm text-g-caption",
        md: "h-g-btn-md text-g-ui",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export function Select({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
  className,
}: Props) {
  const selected = options.find((o) => o.value === value);

  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        className={cn(triggerVariants({ size }), className)}
        aria-label={ariaLabel}
      >
        {selected?.icon && (
          <span className="shrink-0 [&_svg]:size-[15px]">{selected.icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value>
            {selected?.label ?? value}
          </SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={15} className="shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cn(
            "z-[60] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]",
          )}
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="flex flex-col gap-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-g-md px-2.5 py-2 text-left font-g text-g-ui text-g-ink-2 outline-none",
                  "transition-[background,color] duration-[120ms] ease-g",
                  "data-[highlighted]:bg-g-surface-2 data-[highlighted]:text-g-ink",
                  "data-[state=checked]:bg-g-active-bg data-[state=checked]:font-[590] data-[state=checked]:text-g-active-text",
                )}
              >
                {option.icon && (
                  <span className="shrink-0 [&_svg]:size-[15px]">
                    {option.icon}
                  </span>
                )}
                <SelectPrimitive.ItemText>
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto shrink-0">
                  <Check size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
};

type SelectSize = "sm" | "md";
type SelectVariant = "default" | "dark";

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  size?: SelectSize;
  variant?: SelectVariant;
  className?: string;
  disabled?: boolean;
};

const triggerVariants = cva(
  [
    "inline-flex w-full items-center gap-2 rounded-g-md px-3 font-g font-[510] tracking-g-ui",
    "transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
    "focus-visible:outline-none focus-visible:shadow-g-focus",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38]",
  ],
  {
    variants: {
      size: {
        sm: "h-g-btn-sm text-g-caption",
        md: "h-g-btn-md text-g-ui",
      },
      variant: {
        default: [
          "bg-g-surface text-g-ink border border-g-line shadow-g-inset",
          "hover:border-g-input-hover hover:bg-g-input-hover-bg",
          "data-[placeholder]:text-g-ink-3",
        ],
        dark: [
          "bg-white/[0.08] text-white/80 border border-white/[0.08]",
          "hover:bg-white/[0.12] hover:text-white",
          "data-[placeholder]:text-white/38",
        ],
      },
    },
    defaultVariants: { size: "md", variant: "default" },
  },
);

const EMPTY_SENTINEL = "__select_none__";

export function Select({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
  variant = "default",
  className,
  disabled,
}: Props) {
  const internalValue = value === "" ? EMPTY_SENTINEL : value;
  const normalizedOptions = options.map((o) =>
    o.value === "" ? { ...o, value: EMPTY_SENTINEL } : o,
  );
  const selected = normalizedOptions.find((o) => o.value === internalValue);
  const dark = variant === "dark";

  function handleChange(v: string) {
    onChange(v === EMPTY_SENTINEL ? "" : v);
  }

  return (
    <SelectPrimitive.Root
      value={internalValue}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(triggerVariants({ size, variant }), className)}
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
            "z-[140] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[min(480px,calc(100vw-24px))] overflow-hidden p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]",
            dark
              ? "rounded-[18px] border border-white/[0.08] bg-[rgba(42,42,42,0.98)] backdrop-blur-xl"
              : "rounded-g-md border border-g-line-strong bg-g-surface",
          )}
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.Viewport className="flex flex-col gap-1">
            {normalizedOptions.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left font-g text-g-ui outline-none",
                  "transition-[background,color] duration-[120ms] ease-g",
                  dark
                    ? [
                        "rounded-[14px] text-white",
                        "data-[highlighted]:bg-white/[0.1]",
                        "data-[state=checked]:bg-white/[0.13] data-[state=checked]:font-[590]",
                      ]
                    : [
                        "rounded-g-md text-g-ink-2",
                        "data-[highlighted]:bg-g-surface-2 data-[highlighted]:text-g-ink",
                        "data-[state=checked]:bg-g-active-bg data-[state=checked]:font-[590] data-[state=checked]:text-g-active-text",
                      ],
                )}
              >
                {option.icon && (
                  <span className="shrink-0 [&_svg]:size-[15px]">
                    {option.icon}
                  </span>
                )}
                <SelectPrimitive.ItemText>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span
                        className={cn(
                          "block text-g-caption font-normal leading-snug",
                          dark ? "text-white/38" : "text-g-ink-3",
                        )}
                      >
                        {option.description}
                      </span>
                    )}
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

import type { ReactNode } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export type DropdownMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
};

type DropdownMenuProps = {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  align?: "left" | "right";
};

export function DropdownMenu({
  trigger,
  items,
  align = "right",
}: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align === "right" ? "end" : "start"}
          sideOffset={6}
          className="z-[60] min-w-[180px] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop animate-[modalIn_120ms_var(--g-ease-out)]"
          style={{ maxHeight: 320 }}
        >
          {items.map((item, i) => (
            <DropdownMenuPrimitive.Item
              key={i}
              disabled={item.disabled}
              className={cn(
                "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] outline-none",
                "transition-[background,color,box-shadow] duration-[120ms] ease-g",
                "focus-visible:shadow-g-focus",
                "data-[highlighted]:outline-none",
                "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.38]",
                item.variant === "danger"
                  ? "text-g-red data-[highlighted]:bg-g-red-soft"
                  : "text-g-ink-2 data-[highlighted]:bg-g-surface-3 data-[highlighted]:text-g-ink",
              )}
              onSelect={item.onClick}
            >
              {item.icon && (
                <span className="shrink-0 [&_svg]:size-[15px]">
                  {item.icon}
                </span>
              )}
              {item.label}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

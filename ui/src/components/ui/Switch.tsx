import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export function Switch({ className, children, ...props }: SwitchProps) {
  return (
    <span className="inline-flex w-9 shrink-0">
      <SwitchPrimitive.Root
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-g-pill border border-transparent !bg-g-surface-3 p-0 transition-[background,box-shadow,transform] duration-[120ms] ease-g before:absolute before:inset-[-12px_-8px] before:content-[''] focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38] data-[state=checked]:!bg-g-active-bg [&:active:not(:disabled)]:scale-[0.97] [&:active:not(:disabled)]:duration-[100ms] [&:active:not(:disabled)]:ease-g-spring motion-reduce:[&:active:not(:disabled)]:scale-100",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="pointer-events-none ml-[3px] block size-3.5 rounded-g-pill bg-g-ink-3 transition-[background,translate] duration-[120ms] ease-g data-[state=checked]:translate-x-4 data-[state=checked]:bg-g-active-text" />
        {children}
      </SwitchPrimitive.Root>
    </span>
  );
}

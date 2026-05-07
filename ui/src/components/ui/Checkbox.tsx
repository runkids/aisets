import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const checkboxVariants = cva(
  [
    "grid shrink-0 place-items-center rounded-g-sm border border-g-line-strong bg-g-surface text-transparent transition-[background,border-color,color,box-shadow,transform] duration-[120ms] ease-g",
    "focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]",
    "data-[state=checked]:border-g-accent data-[state=checked]:bg-g-accent data-[state=checked]:text-g-accent-ink",
    "data-[state=indeterminate]:border-g-accent data-[state=indeterminate]:bg-g-accent data-[state=indeterminate]:text-g-accent-ink",
    "[&:active:not(:disabled)]:scale-[0.94] motion-reduce:[&:active:not(:disabled)]:scale-100",
  ],
  {
    variants: {
      size: {
        sm: "size-3.5 [&_svg]:size-2.5",
        md: "size-4 [&_svg]:size-3",
        lg: "size-5 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> &
  VariantProps<typeof checkboxVariants>;

function Checkbox({ asChild, className, size, ...props }: CheckboxProps) {
  const indicator = (
    <CheckboxPrimitive.Indicator className="grid place-items-center">
      <Check strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  );

  if (asChild) {
    return (
      <CheckboxPrimitive.Root asChild {...props}>
        <span className={cn(checkboxVariants({ size }), className)}>
          {indicator}
        </span>
      </CheckboxPrimitive.Root>
    );
  }

  return (
    <CheckboxPrimitive.Root
      className={cn(checkboxVariants({ size }), className)}
      {...props}
    >
      {indicator}
    </CheckboxPrimitive.Root>
  );
}

/* eslint-disable react-refresh/only-export-components */
export { Checkbox, checkboxVariants, type CheckboxProps };
/* eslint-enable react-refresh/only-export-components */

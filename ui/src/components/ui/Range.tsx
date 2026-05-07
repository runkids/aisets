import type { InputHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const rangeVariants = cva(
  "w-full flex-1 rounded-g-sm accent-g-active-bg focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]",
  {
    variants: {
      size: {
        md: "",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

type RangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> &
  VariantProps<typeof rangeVariants>;

function Range({ className, size, ...props }: RangeProps) {
  return (
    <input
      type="range"
      className={cn(rangeVariants({ size }), className)}
      {...props}
    />
  );
}

/* eslint-disable react-refresh/only-export-components */
export { Range, rangeVariants, type RangeProps };
/* eslint-enable react-refresh/only-export-components */

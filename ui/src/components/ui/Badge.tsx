import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-g-pill border border-transparent px-2 font-g-mono text-[10px] font-[510] leading-none tracking-g-mono tabular-nums",
  {
    variants: {
      tone: {
        default: "bg-g-surface-3 text-g-ink-3",
        line: "border-g-line-strong bg-transparent text-g-ink-2",
        green: "bg-g-green-soft text-g-green",
        red: "bg-g-red-soft text-g-red",
        amber: "bg-g-amber-soft text-g-amber",
        blue: "bg-g-blue-soft text-g-blue",
        purple: "bg-g-purple-soft text-g-purple",
        info: "bg-g-info-soft text-g-info",
        accent: "bg-g-accent text-g-accent-ink",
        warning: "bg-g-amber-soft text-g-amber",
        danger: "bg-g-red-soft text-g-red",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ tone, children, className, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants, type BadgeProps };

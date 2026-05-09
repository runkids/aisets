import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const iconWellVariants = cva("grid shrink-0 place-items-center", {
  variants: {
    size: {
      sm: "size-8 rounded-g-sm [&_svg]:size-4",
      md: "size-10 rounded-g-md [&_svg]:size-5",
      lg: "size-12 rounded-g-md [&_svg]:size-6",
    },
    tone: {
      neutral: "bg-g-surface-2 text-g-ink-2 shadow-g-inset",
      accent: "bg-g-accent text-g-accent-ink",
      green: "bg-g-green-soft text-g-green",
      red: "bg-g-red-soft text-g-red",
      amber: "bg-g-amber-soft text-g-amber",
      blue: "bg-g-blue-soft text-g-blue",
      purple: "bg-g-purple-soft text-g-purple",
    },
  },
  defaultVariants: {
    size: "md",
    tone: "neutral",
  },
});

type IconWellProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof iconWellVariants> & {
    children: ReactNode;
  };

export function IconWell({
  size,
  tone,
  children,
  className,
  ...props
}: IconWellProps) {
  return (
    <div className={cn(iconWellVariants({ size, tone }), className)} {...props}>
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { iconWellVariants };

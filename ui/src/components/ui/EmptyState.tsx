import { CircleSlash } from "lucide-react";
import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

const emptyStateVariants = cva("flex flex-col text-g-ink-3", {
  variants: {
    size: {
      sm: "gap-2 px-4 py-8",
      md: "gap-3 px-6 py-16",
      lg: "gap-4 px-6 py-20",
    },
    align: {
      center: "items-center text-center",
      left: "items-start text-left",
    },
  },
  defaultVariants: {
    size: "md",
    align: "center",
  },
});

const emptyIconVariants = cva("grid place-items-center rounded-g-pill", {
  variants: {
    size: {
      sm: "size-10 [&_svg]:size-5",
      md: "size-14 [&_svg]:size-7",
      lg: "size-16 [&_svg]:size-8",
    },
    tone: {
      neutral: "bg-g-surface-2 text-g-ink-3",
    },
  },
  defaultVariants: {
    size: "md",
    tone: "neutral",
  },
});

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md" | "lg";
  align?: "center" | "left";
  tone?: "neutral";
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  size,
  align,
  tone,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ size, align }), className)}>
      <div className={cn(emptyIconVariants({ size, tone }))}>
        {icon ?? <CircleSlash aria-hidden="true" />}
      </div>
      <div className="font-g-display text-[17px] font-[510] tracking-[-0.013em] text-g-ink">
        {title}
      </div>
      {description && (
        <p className="max-w-md text-g-ui text-g-ink-3">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { emptyStateVariants };

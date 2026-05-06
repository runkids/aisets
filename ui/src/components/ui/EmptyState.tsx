import { CircleSlash } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type EmptyStateSize = "sm" | "md" | "lg";
type EmptyStateAlign = "center" | "left";
type EmptyStateTone = "neutral" | "info" | "warning";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: EmptyStateSize;
  align?: EmptyStateAlign;
  tone?: EmptyStateTone;
  className?: string;
};

const emptySizeClassNames: Record<EmptyStateSize, string> = {
  sm: "gap-2 px-4 py-8",
  md: "gap-3 px-6 py-16",
  lg: "gap-4 px-6 py-20",
};

const emptyAlignClassNames: Record<EmptyStateAlign, string> = {
  center: "items-center text-center",
  left: "items-start text-left",
};

const iconSizeClassNames: Record<EmptyStateSize, string> = {
  sm: "size-10 [&_svg]:size-5",
  md: "size-14 [&_svg]:size-7",
  lg: "size-16 [&_svg]:size-8",
};

const iconToneClassNames: Record<EmptyStateTone, string> = {
  neutral: "bg-g-surface-2 text-g-ink-3",
  info: "bg-g-info-soft text-g-info",
  warning: "bg-g-amber-soft text-g-amber",
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  align = "center",
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col text-g-ink-3",
        emptySizeClassNames[size],
        emptyAlignClassNames[align],
        className,
      )}
    >
      <div
        className={cn(
          "grid place-items-center rounded-g-pill",
          iconSizeClassNames[size],
          iconToneClassNames[tone],
        )}
      >
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

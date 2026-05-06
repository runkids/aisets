import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const statCardVariants = cva(
  [
    "overflow-hidden rounded-g-md border border-g-line bg-g-surface px-5 py-[18px] text-left shadow-g-sm",
    "transition-[border-color,box-shadow,transform] duration-[120ms] ease-g",
    "data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:-translate-y-0.5",
    "data-[clickable=true]:hover:border-g-line-strong data-[clickable=true]:hover:shadow-g-md",
    "data-[clickable=true]:focus-visible:outline-none data-[clickable=true]:focus-visible:shadow-g-focus",
    "motion-reduce:data-[clickable=true]:hover:translate-y-0",
  ],
  {
    variants: {
      tone: {
        neutral: "[--stat-tone:var(--g-ink-4)]",
        accent: "[--stat-tone:var(--g-accent)]",
        green: "[--stat-tone:var(--g-green)]",
        red: "[--stat-tone:var(--g-red)]",
        amber: "[--stat-tone:var(--g-amber)]",
        blue: "[--stat-tone:var(--g-blue)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

type StatCardProps = VariantProps<typeof statCardVariants> & {
  label: string;
  value: string | number;
  meta?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function StatCard({
  label,
  value,
  meta,
  icon,
  onClick,
  tone,
  className,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 font-g text-g-chip font-[510] uppercase tracking-[0.08em] text-[var(--stat-tone)]">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-g-display text-4xl font-[590] leading-none tracking-[-0.035em] text-g-ink tabular-nums">
        {value}
      </div>
      {meta && <div className="mt-1.5 text-g-caption text-g-ink-3">{meta}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(statCardVariants({ tone }), className)}
        data-clickable="true"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cn(statCardVariants({ tone }), className)}>{content}</div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { statCardVariants };

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type AiActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  loading?: boolean;
  children: ReactNode;
};

function AiActionButton({
  loading,
  children,
  disabled,
  className,
  type = "button",
  ...props
}: AiActionButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "group relative inline-flex items-center gap-1.5 overflow-hidden rounded-g-md px-3 py-1.5 font-g text-g-caption font-[510]",
        "border border-g-purple/20 bg-g-purple/[0.04] text-g-ink-2",
        "transition-[background,border-color,color,transform] duration-[120ms] ease-g",
        "[&:hover:not(:disabled)]:border-g-purple/35 [&:hover:not(:disabled)]:bg-g-purple/[0.08] [&:hover:not(:disabled)]:text-g-ink",
        "focus-visible:outline-none focus-visible:shadow-g-focus",
        "disabled:cursor-not-allowed disabled:opacity-[0.38]",
        "[&:active:not(:disabled)]:scale-[0.97] [&:active:not(:disabled)]:duration-[100ms] motion-reduce:[&:active:not(:disabled)]:scale-100",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-g-purple/6 to-transparent group-hover:animate-[ai-shimmer_1.2s_ease-in-out] motion-reduce:group-hover:animate-none"
        aria-hidden="true"
      />
      {loading ? (
        <Loader2
          size={14}
          className="relative shrink-0 animate-[icon-spin_900ms_linear_infinite] text-g-purple"
        />
      ) : (
        <Sparkles size={14} className="relative shrink-0 text-g-purple" />
      )}
      <span className="relative">{children}</span>
    </button>
  );
}

export { AiActionButton, type AiActionButtonProps };

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-2.5 rounded-g-lg border p-3 pr-8 text-left shadow-g-pop animate-[slideUp2_200ms_var(--g-ease-out)] font-g text-g-ui",
  {
    variants: {
      tone: {
        info: "border-g-blue/40 bg-[color-mix(in_srgb,var(--g-blue)_6%,var(--g-surface-2))] [--toast-icon:var(--g-blue)]",
        success:
          "border-g-green/40 bg-[color-mix(in_srgb,var(--g-green)_6%,var(--g-surface-2))] [--toast-icon:var(--g-green)]",
        warning:
          "border-g-amber/40 bg-[color-mix(in_srgb,var(--g-amber)_6%,var(--g-surface-2))] [--toast-icon:var(--g-amber)]",
        danger:
          "border-g-red/40 bg-[color-mix(in_srgb,var(--g-red)_6%,var(--g-surface-2))] [--toast-icon:var(--g-red)]",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

type ToastTone = "info" | "success" | "warning" | "danger";

type ToastProps = VariantProps<typeof toastVariants> & {
  tone: ToastTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

const toastIcon: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export function Toast({
  tone,
  title,
  children,
  onDismiss,
  className,
}: ToastProps) {
  const Icon = toastIcon[tone];

  return (
    <div
      className={cn(toastVariants({ tone }), className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="mt-px shrink-0 text-[var(--toast-icon)]">
        <Icon size={18} />
      </span>

      <span className="block min-w-0 flex-1 leading-[1.4]">
        {title && <span className="block font-[590] text-g-ink">{title}</span>}
        <span className={cn("block text-g-ink-2", title && "mt-0.5")}>
          {children}
        </span>
      </span>

      {onDismiss && (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 grid size-6 place-items-center rounded-g-sm text-g-ink-3 transition-colors hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { toastVariants };

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const noticeVariants = cva(
  "flex items-start gap-2.5 rounded-g-md border p-3 font-g text-g-ui",
  {
    variants: {
      tone: {
        info: "border-g-blue-soft bg-g-blue-soft/30 [--notice-icon:var(--g-blue)]",
        success:
          "border-g-green-soft bg-g-green-soft/30 [--notice-icon:var(--g-green)]",
        warning:
          "border-g-amber-soft bg-g-amber-soft/30 [--notice-icon:var(--g-amber)]",
        danger:
          "border-g-red-soft bg-g-red-soft/30 [--notice-icon:var(--g-red)]",
      },
    },
    defaultVariants: {
      tone: "info",
    },
  },
);

type NoticeTone = "info" | "success" | "warning" | "danger";

type NoticeProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noticeVariants> & {
    title?: string;
    children: ReactNode;
    loading?: boolean;
  };

const iconForTone: Record<NoticeTone, ReactNode> = {
  info: <Info size={18} />,
  success: <CheckCircle2 size={18} />,
  warning: <AlertTriangle size={18} />,
  danger: <XCircle size={18} />,
};

export function Notice({
  tone = "info",
  title,
  children,
  loading = false,
  className,
  ...props
}: NoticeProps) {
  return (
    <div
      className={cn(noticeVariants({ tone }), className)}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <div className="mt-px shrink-0 text-[var(--notice-icon)]">
        {loading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          iconForTone[tone!]
        )}
      </div>
      <div className="min-w-0 flex-1">
        {title && <div className="font-[590] text-g-ink">{title}</div>}
        <div className={cn("text-g-ink-3", title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

type NoticeItem = NoticeProps & {
  id: string;
};

export function NoticeStack({
  items,
  className,
}: {
  items: NoticeItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("grid gap-2", className)}>
      {items.map((item) => (
        <Notice
          key={item.id}
          tone={item.tone}
          title={item.title}
          loading={item.loading}
        >
          {item.children}
        </Notice>
      ))}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { noticeVariants };

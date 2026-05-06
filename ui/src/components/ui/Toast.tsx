import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Notice } from "./Notice";

type ToastTone = "info" | "success" | "warning" | "danger";

type ToastProps = {
  tone: ToastTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

export function Toast({
  tone,
  title,
  children,
  onDismiss,
  className,
}: ToastProps) {
  return (
    <button
      type="button"
      className={cn(
        "pointer-events-auto w-full cursor-pointer rounded-g-lg text-left shadow-g-pop animate-[slideUp2_200ms_var(--g-ease-out)] focus-visible:outline-none focus-visible:shadow-g-focus",
        className,
      )}
      onClick={onDismiss}
    >
      <Notice tone={tone} title={title}>
        {children}
      </Notice>
    </button>
  );
}

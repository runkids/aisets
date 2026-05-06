import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

type ModalSize = "sm" | "md" | "lg";
type ModalBodyPadding = "none" | "md";

type ModalProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  bodyPadding?: ModalBodyPadding;
  className?: string;
  bodyClassName?: string;
};

const modalSizeClassNames: Record<ModalSize, string> = {
  sm: "max-w-[520px]",
  md: "max-w-[760px]",
  lg: "max-w-[960px]",
};

const modalBodyPaddingClassNames: Record<ModalBodyPadding, string> = {
  none: "p-0",
  md: "p-4",
};

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  size = "md",
  bodyPadding = "md",
  className,
  bodyClassName,
}: ModalProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[50] grid place-items-center bg-[rgba(8,9,10,0.6)] p-4 backdrop-blur-[4px] animate-[fadeIn_160ms_var(--g-ease)]"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={cn(
          "flex max-h-[min(86vh,760px)] w-full flex-col overflow-hidden rounded-g-lg border border-g-line bg-g-surface-2 shadow-g-pop animate-[slideUp2_200ms_var(--g-ease-out)]",
          modalSizeClassNames[size],
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-g-line bg-g-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-g-display text-xl font-[590] tracking-[-0.022em] text-g-ink">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-g-ui text-g-ink-3">{description}</p>
            )}
          </div>
          <IconButton aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            modalBodyPaddingClassNames[bodyPadding],
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-between gap-3 border-t border-g-line bg-g-surface px-4 py-3">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}

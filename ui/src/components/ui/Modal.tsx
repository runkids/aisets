import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

const modalVariants = cva(
  [
    "relative flex max-h-[min(86vh,760px)] w-full flex-col overflow-hidden",
    "rounded-g-lg border border-g-line bg-g-surface-2 shadow-g-pop",
    "animate-[modalIn_200ms_var(--g-ease-out)]",
  ],
  {
    variants: {
      size: {
        sm: "max-w-[520px]",
        md: "max-w-[760px]",
        lg: "max-w-[960px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

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

const bodyPaddingClasses: Record<ModalBodyPadding, string> = {
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
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] grid place-items-center bg-[rgba(8,9,10,0.6)] p-4 backdrop-blur-[4px] animate-[fadeIn_160ms_var(--g-ease)]" />
        <div className="fixed inset-0 z-[120] grid place-items-center p-4">
          <DialogPrimitive.Content
            className={cn(modalVariants({ size }), className)}
            aria-label={title}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogPrimitive.Title asChild>
              <header className="flex items-start gap-3 border-b border-g-line bg-g-surface px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-g-display text-heading-sm font-[590] tracking-heading-sm text-g-ink">
                    {title}
                  </h2>
                  {description && (
                    <DialogPrimitive.Description className="mt-1 text-g-ui text-g-ink-3">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
                <DialogPrimitive.Close asChild>
                  <IconButton aria-label={t("common.close")}>
                    <X size={18} />
                  </IconButton>
                </DialogPrimitive.Close>
              </header>
            </DialogPrimitive.Title>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-auto",
                bodyPaddingClasses[bodyPadding],
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
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

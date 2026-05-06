import type { ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button } from "./Button";

type ConfirmDialogVariant = "default" | "danger";

type ConfirmDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: ReactNode;
  confirmText: string;
  cancelText: string;
  variant?: ConfirmDialogVariant;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText,
  cancelText,
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(o) => !o && !loading && onCancel()}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[50] flex items-center justify-center bg-[rgba(8,9,10,0.6)] p-4 backdrop-blur-[4px] animate-[fadeIn_160ms_var(--g-ease)]" />
        <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
          <AlertDialogPrimitive.Content
            className="relative flex w-full max-w-[448px] flex-col overflow-hidden rounded-g-lg border border-g-line bg-g-surface-2 shadow-g-pop animate-[modalIn_200ms_var(--g-ease-out)]"
            onEscapeKeyDown={(e) => loading && e.preventDefault()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-g-line px-4 pb-3 pt-4">
              <div>
                <AlertDialogPrimitive.Title className="m-0 font-g-display text-[17px] font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                  {title}
                </AlertDialogPrimitive.Title>
                <AlertDialogPrimitive.Description className="mt-1 text-g-ui font-normal leading-[1.5] tracking-[-0.012em] text-g-ink-3">
                  {message}
                </AlertDialogPrimitive.Description>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-g-line bg-g-surface px-4 py-3">
              <div className="ml-auto flex gap-2">
                <AlertDialogPrimitive.Cancel asChild>
                  <Button
                    variant="secondary"
                    onClick={onCancel}
                    disabled={loading}
                  >
                    {cancelText}
                  </Button>
                </AlertDialogPrimitive.Cancel>
                <AlertDialogPrimitive.Action asChild>
                  <Button
                    variant={variant === "danger" ? "danger" : "primary"}
                    onClick={onConfirm}
                    disabled={loading}
                  >
                    {confirmText}
                  </Button>
                </AlertDialogPrimitive.Action>
              </div>
            </div>
          </AlertDialogPrimitive.Content>
        </div>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

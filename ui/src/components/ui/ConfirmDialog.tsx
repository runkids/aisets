import type { ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button } from "./Button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
} from "./DialogShell";

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
        <AlertDialogPrimitive.Overlay asChild>
          <DialogOverlay />
        </AlertDialogPrimitive.Overlay>
        <DialogViewport>
          <AlertDialogPrimitive.Content
            asChild
            onEscapeKeyDown={(e) => loading && e.preventDefault()}
          >
            <DialogSurface size="sm" className="max-w-[448px]">
              <DialogHeader className="gap-4 px-4 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <AlertDialogPrimitive.Title asChild>
                    <DialogTitle className="text-[17px] leading-[1.3] tracking-[-0.013em]">
                      {title}
                    </DialogTitle>
                  </AlertDialogPrimitive.Title>
                  <AlertDialogPrimitive.Description asChild>
                    <DialogDescription className="tracking-[-0.012em]">
                      {message}
                    </DialogDescription>
                  </AlertDialogPrimitive.Description>
                </div>
              </DialogHeader>
              <DialogFooter>
                <div className="ml-auto flex gap-2">
                  <AlertDialogPrimitive.Cancel asChild>
                    <Button variant="secondary" disabled={loading}>
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
              </DialogFooter>
            </DialogSurface>
          </AlertDialogPrimitive.Content>
        </DialogViewport>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

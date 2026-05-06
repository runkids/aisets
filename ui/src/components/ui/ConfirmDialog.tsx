import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal relative w-full"
        style={{ maxWidth: 448 }}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{message}</p>
          </div>
        </div>
        <div className="modal-foot">
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={loading}>
              {cancelText}
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              onClick={onConfirm}
              disabled={loading}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

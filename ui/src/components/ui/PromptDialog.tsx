import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

type PromptDialogProps = {
  open: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText: string;
  cancelText: string;
  loading?: boolean;
};

type PromptDialogContentProps = Omit<PromptDialogProps, "open"> & {
  defaultValue: string;
  loading: boolean;
};

function PromptDialogContent({
  onConfirm,
  onCancel,
  title,
  label,
  placeholder,
  defaultValue,
  confirmText,
  cancelText,
  loading,
}: PromptDialogContentProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [loading, onCancel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const canSubmit = value.trim().length > 0 && value.trim() !== defaultValue;
  const handleSubmit = () => {
    if (canSubmit) onConfirm(value.trim());
  };

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
      <div className="modal relative w-full" style={{ maxWidth: 448 }}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="modal-body">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            {label && (
              <label className="mb-1.5 block text-g-caption font-[510] text-g-ink-3">
                {label}
              </label>
            )}
            <input
              className="input-shell w-full"
              style={{ height: 36 }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={loading}
              autoFocus
            />
          </form>
        </div>
        <div className="modal-foot">
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={loading}>
              {cancelText}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
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

export function PromptDialog({
  open,
  defaultValue = "",
  loading = false,
  ...props
}: PromptDialogProps) {
  if (!open) return null;
  return (
    <PromptDialogContent
      key={defaultValue}
      defaultValue={defaultValue}
      loading={loading}
      {...props}
    />
  );
}

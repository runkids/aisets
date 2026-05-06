import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
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
}: Omit<PromptDialogProps, "open"> & {
  defaultValue: string;
  loading: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSubmit = value.trim().length > 0 && value.trim() !== defaultValue;
  const handleSubmit = () => {
    if (canSubmit) onConfirm(value.trim());
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(o) => !o && !loading && onCancel()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[50] flex items-center justify-center bg-[rgba(8,9,10,0.6)] p-4 backdrop-blur-[4px] animate-[fadeIn_160ms_var(--g-ease)]" />
        <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
          <DialogPrimitive.Content
            className="relative flex w-full max-w-[448px] flex-col overflow-hidden rounded-g-lg border border-g-line bg-g-surface-2 shadow-g-pop animate-[modalIn_200ms_var(--g-ease-out)]"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            onEscapeKeyDown={(e) => loading && e.preventDefault()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-g-line px-4 pb-3 pt-4">
              <div>
                <DialogPrimitive.Title className="m-0 font-g-display text-[17px] font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                  {title}
                </DialogPrimitive.Title>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
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
                  ref={inputRef}
                  className="inline-flex h-8 w-full min-w-0 items-center gap-2 rounded-g-md border border-g-input-border bg-g-surface px-2.5 text-g-ink transition-[border-color,box-shadow,background] duration-[120ms] ease-g hover:border-g-input-hover hover:bg-g-input-hover-bg focus-within:border-g-input-focus focus-within:bg-g-surface focus-within:shadow-g-input-focus focus-within:outline-none"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={placeholder}
                  disabled={loading}
                />
              </form>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-g-line bg-g-surface px-4 py-3">
              <div className="ml-auto flex gap-2">
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="secondary"
                    onClick={onCancel}
                    disabled={loading}
                  >
                    {cancelText}
                  </Button>
                </DialogPrimitive.Close>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={loading || !canSubmit}
                >
                  {confirmText}
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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

import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "./Button";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
} from "./DialogShell";
import { TextInput } from "./TextInput";

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
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay />
        </DialogPrimitive.Overlay>
        <DialogViewport>
          <DialogPrimitive.Content
            asChild
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            onEscapeKeyDown={(e) => loading && e.preventDefault()}
          >
            <DialogSurface size="sm" className="max-w-[448px]">
              <DialogHeader className="gap-4 px-4 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title asChild>
                    <DialogTitle className="text-[17px] leading-[1.3] tracking-[-0.013em]">
                      {title}
                    </DialogTitle>
                  </DialogPrimitive.Title>
                </div>
              </DialogHeader>
              <DialogBody>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSubmit();
                  }}
                >
                  <TextInput
                    ref={inputRef}
                    label={label}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    disabled={loading}
                  />
                </form>
              </DialogBody>
              <DialogFooter>
                <div className="ml-auto flex gap-2">
                  <DialogPrimitive.Close asChild>
                    <Button variant="secondary" disabled={loading}>
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
              </DialogFooter>
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
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

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
} from "./DialogShell";

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
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay />
        </DialogPrimitive.Overlay>
        <DialogViewport>
          <DialogPrimitive.Content
            asChild
            aria-label={title}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogSurface size={size} className={className}>
              <DialogHeader>
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title asChild>
                    <DialogTitle>{title}</DialogTitle>
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description asChild>
                      <DialogDescription>{description}</DialogDescription>
                    </DialogPrimitive.Description>
                  )}
                  {!description && (
                    <DialogPrimitive.Description asChild>
                      <DialogDescription className="sr-only">
                        {title}
                      </DialogDescription>
                    </DialogPrimitive.Description>
                  )}
                </div>
                <DialogPrimitive.Close asChild>
                  <IconButton aria-label={t("common.close")}>
                    <X size={18} />
                  </IconButton>
                </DialogPrimitive.Close>
              </DialogHeader>
              <DialogBody padding={bodyPadding} className={cn(bodyClassName)}>
                {children}
              </DialogBody>
              {footer && <DialogFooter>{footer}</DialogFooter>}
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const dialogOverlayVariants = cva(
  "fixed inset-0 animate-[fadeIn_160ms_var(--g-ease)]",
  {
    variants: {
      layer: {
        modal: "z-[120] bg-[rgba(8,9,10,0.6)] backdrop-blur-[4px]",
        command: "z-[100] bg-[rgba(8,9,10,0.5)] backdrop-blur-[8px]",
        drawer:
          "z-50 bg-[rgba(8,9,10,0.6)] backdrop-blur-[4px] animate-[fadeIn_180ms_var(--g-ease)]",
      },
    },
    defaultVariants: { layer: "modal" },
  },
);

const dialogViewportVariants = cva("fixed inset-0 grid pointer-events-none", {
  variants: {
    layer: {
      modal: "z-[120] p-4",
      command: "z-[100] pt-[12vh] px-4 pb-4",
    },
    placement: {
      center: "place-items-center",
      top: "place-items-start justify-items-center",
    },
  },
  defaultVariants: { layer: "modal", placement: "center" },
});

const dialogSurfaceVariants = cva(
  [
    "pointer-events-auto relative flex w-full flex-col overflow-hidden",
    "rounded-g-lg border border-g-line-strong bg-g-surface shadow-g-pop",
  ],
  {
    variants: {
      size: {
        sm: "max-w-[520px]",
        md: "max-w-[760px]",
        lg: "max-w-[960px]",
        command: "max-w-[90vw] w-[580px]",
      },
      height: {
        auto: "",
        modal: "max-h-[min(86vh,760px)]",
      },
      motion: {
        modal: "animate-[modalIn_200ms_var(--g-ease-out)]",
        command: "animate-[cmdkIn_200ms_var(--g-ease-out)]",
      },
    },
    defaultVariants: { size: "md", height: "modal", motion: "modal" },
  },
);

const dialogBodyVariants = cva("min-h-0 flex-1 overflow-auto", {
  variants: {
    padding: {
      none: "p-0",
      md: "p-5",
    },
  },
  defaultVariants: { padding: "md" },
});

const DialogOverlay = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof dialogOverlayVariants>
>(function DialogOverlay({ layer, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(dialogOverlayVariants({ layer }), className)}
      {...props}
    />
  );
});

const DialogViewport = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof dialogViewportVariants>
>(function DialogViewport({ layer, placement, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(dialogViewportVariants({ layer, placement }), className)}
      {...props}
    />
  );
});

const DialogSurface = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof dialogSurfaceVariants>
>(function DialogSurface({ size, height, motion, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(dialogSurfaceVariants({ size, height, motion }), className)}
      {...props}
    />
  );
});

const DialogDrawerSurface = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement>
>(function DialogDrawerSurface({ className, ...props }, ref) {
  return (
    <aside
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-[51] flex w-[800px] max-w-[95vw] flex-col overflow-hidden border-l border-g-line bg-g-surface shadow-g-pop animate-[slideInR_240ms_var(--g-ease-out)] max-[600px]:w-screen max-[600px]:max-w-none",
        className,
      )}
      {...props}
    />
  );
});

const DialogHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function DialogHeader({ className, ...props }, ref) {
    return (
      <header
        ref={ref}
        className={cn(
          "flex items-start gap-3 bg-g-surface px-5 pb-2 pt-5",
          className,
        )}
        {...props}
      />
    );
  },
);

const DialogTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <h2
      ref={ref}
      className={cn(
        "m-0 font-g-display text-[18px] font-[590] leading-[1.28] tracking-[-0.016em] text-g-ink",
        className,
      )}
      {...props}
    />
  );
});

const DialogDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("mt-1 text-g-ui leading-[1.5] text-g-ink-3", className)}
      {...props}
    />
  );
});

const DialogBody = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & VariantProps<typeof dialogBodyVariants>
>(function DialogBody({ padding, className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(dialogBodyVariants({ padding }), className)}
      {...props}
    />
  );
});

const DialogFooter = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function DialogFooter({ className, ...props }, ref) {
    return (
      <footer
        ref={ref}
        className={cn(
          "flex items-center justify-end gap-3 bg-g-surface px-5 pb-5 pt-2",
          className,
        )}
        {...props}
      />
    );
  },
);

/* eslint-disable react-refresh/only-export-components */
export {
  DialogBody,
  DialogDescription,
  DialogDrawerSurface,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
  dialogBodyVariants,
  dialogOverlayVariants,
  dialogSurfaceVariants,
  dialogViewportVariants,
};
/* eslint-enable react-refresh/only-export-components */

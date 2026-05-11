import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ─── Button ─────────────────────────────────────────────── */

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-g-md border border-transparent font-g text-g-ui font-[510] tracking-g-ui",
    "transition-[background,border-color,color,box-shadow,filter,transform] duration-[120ms] ease-g",
    "focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]",
    "[&:active:not(:disabled)]:scale-[0.97] [&:active:not(:disabled)]:duration-[100ms] [&:active:not(:disabled)]:ease-g-spring motion-reduce:[&:active:not(:disabled)]:scale-100",
    "[&_svg]:size-3.5 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-g-cta text-g-cta-ink font-[590] [&:hover:not(:disabled)]:bg-g-cta-hover",
        secondary:
          "border-g-line-strong bg-g-surface text-g-ink [&:hover:not(:disabled)]:bg-g-surface-2",
        ghost:
          "bg-transparent text-g-ink-2 [&:hover:not(:disabled)]:bg-g-surface-2 [&:hover:not(:disabled)]:text-g-ink",
        danger:
          "border border-g-red/40 bg-transparent text-g-red [&:hover:not(:disabled)]:bg-g-red [&:hover:not(:disabled)]:text-g-canvas [&:hover:not(:disabled)]:border-g-red transition-[background,color,border-color] duration-150",
        chip: "border-g-line bg-g-surface text-g-ink-2 [&:hover:not(:disabled)]:bg-g-surface-2 data-[active=true]:border-g-active-bg data-[active=true]:bg-g-active-bg/10 data-[active=true]:text-g-active-bg",
      },
      size: {
        sm: "h-g-btn-sm px-2.5 text-g-caption [&_svg]:size-3",
        md: "h-g-btn-md px-3",
        lg: "h-g-btn-lg px-3.5 text-g-body [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  };

function Button({
  variant,
  size,
  leadingIcon,
  trailingIcon,
  children,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}

/* ─── IconButton ─────────────────────────────────────────── */

const iconButtonVariants = cva(
  [
    "relative grid place-items-center rounded-g-md bg-transparent text-g-ink-2 transition-[background,color,filter,transform] duration-[120ms] ease-g before:absolute before:inset-[-6px] before:content-['']",
    "hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]",
    "[&:active:not(:disabled)]:scale-[0.94] motion-reduce:[&:active:not(:disabled)]:scale-100 data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:hover:bg-g-active-bg data-[active=true]:hover:brightness-95",
    "data-[loading=true]:[&_svg]:animate-[icon-spin_900ms_linear_infinite] [&_svg]:size-4",
  ],
  {
    variants: {
      size: {
        sm: "size-g-btn-sm [&_svg]:size-3.5",
        md: "size-g-btn-md",
        lg: "size-g-btn-lg [&_svg]:size-5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof iconButtonVariants> & {
    active?: boolean;
  };

function IconButton({
  size,
  children,
  type = "button",
  active,
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(iconButtonVariants({ size }), className)}
      data-active={active || undefined}
      {...props}
    >
      {children}
    </button>
  );
}

/* eslint-disable react-refresh/only-export-components */
export {
  Button,
  IconButton,
  buttonVariants,
  iconButtonVariants,
  type ButtonProps,
  type IconButtonProps,
};
/* eslint-enable react-refresh/only-export-components */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const labelClassName =
  "font-g text-g-caption font-[510] tracking-[-0.011em] text-g-ink-3";
const iconClassName = "inline-flex shrink-0 text-g-ink-3";
const affixClassName = "shrink-0 text-g-caption text-g-ink-3";
const controlClassName =
  "min-w-0 flex-1 border-0 bg-transparent font-g-mono text-g-ui tracking-g-mono text-g-ink outline-none placeholder:text-g-ink-3 disabled:cursor-not-allowed";

const textInputShellVariants = cva(
  [
    "inline-flex w-full min-w-0 items-center gap-2 rounded-g-md border border-solid px-2.5 text-g-ink",
    "transition-[background,border-color,box-shadow,transform] duration-[120ms] ease-g",
    "focus-within:border-g-accent focus-within:bg-g-surface focus-within:shadow-g-focus focus-within:outline-none",
  ],
  {
    variants: {
      variant: {
        default:
          "border-g-line-strong bg-g-surface hover:border-g-line-strong hover:bg-g-surface-2",
        outline: "border-g-line bg-transparent hover:border-g-line-strong",
        subtle: "border-transparent bg-g-surface-3 hover:border-g-line-strong",
        search:
          "border-g-line-strong bg-g-surface hover:border-g-line-strong hover:bg-g-surface-2",
        command:
          "border-transparent bg-transparent px-0 hover:border-transparent focus-within:border-transparent focus-within:bg-transparent focus-within:shadow-none",
      },
      size: {
        sm: "h-g-btn-sm",
        md: "h-g-btn-md",
      },
      invalid: {
        true: "border-g-red hover:border-g-red focus-within:border-g-red",
      },
      disabled: {
        true: "cursor-not-allowed opacity-[0.38]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      invalid: false,
      disabled: false,
    },
  },
);

const textInputButtonVariants = cva(
  [
    "inline-flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-g-md border border-solid px-2.5 text-left text-g-ink",
    "transition-[background,border-color,box-shadow,transform] duration-[120ms] ease-g",
    "focus-visible:border-g-accent focus-visible:bg-g-surface focus-visible:shadow-g-focus focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-[0.38]",
    "[&:active:not(:disabled)]:scale-[0.99] motion-reduce:[&:active:not(:disabled)]:scale-100",
  ],
  {
    variants: {
      variant: {
        default:
          "border-g-line-strong bg-g-surface hover:border-g-line-strong hover:bg-g-surface-2",
        outline: "border-g-line bg-transparent hover:border-g-line-strong",
        subtle: "border-transparent bg-g-surface-3 hover:border-g-line-strong",
        search:
          "border-g-line-strong bg-g-surface hover:border-g-line-strong hover:bg-g-surface-2",
        command:
          "border-transparent bg-transparent px-0 hover:border-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:shadow-none",
      },
      size: {
        sm: "h-g-btn-sm",
        md: "h-g-btn-md",
      },
    },
    defaultVariants: {
      variant: "search",
      size: "md",
    },
  },
);

type ShellVariants = VariantProps<typeof textInputShellVariants>;
type ButtonVariants = VariantProps<typeof textInputButtonVariants>;

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  ShellVariants & {
    label?: string;
    icon?: ReactNode;
    suffix?: ReactNode;
    inputClassName?: string;
  };

const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    {
      label,
      icon,
      suffix,
      id,
      variant,
      size,
      invalid,
      disabled,
      className,
      inputClassName,
      ...props
    },
    ref,
  ) {
    return (
      <label
        className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}
        htmlFor={id}
      >
        {label && <span className={labelClassName}>{label}</span>}
        <span
          className={textInputShellVariants({
            variant,
            size,
            invalid,
            disabled,
          })}
        >
          {icon && <span className={iconClassName}>{icon}</span>}
          <input
            ref={ref}
            id={id}
            className={cn(controlClassName, inputClassName)}
            aria-invalid={invalid || undefined}
            disabled={disabled || undefined}
            {...props}
          />
          {suffix && <span className={affixClassName}>{suffix}</span>}
        </span>
      </label>
    );
  },
);

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  Omit<ShellVariants, "size"> & {
    label?: string;
    textareaClassName?: string;
  };

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      id,
      variant,
      invalid,
      disabled,
      className,
      textareaClassName,
      ...props
    },
    ref,
  ) {
    return (
      <label
        className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}
        htmlFor={id}
      >
        {label && <span className={labelClassName}>{label}</span>}
        <span
          className={cn(
            textInputShellVariants({
              variant,
              size: "md",
              invalid,
              disabled,
            }),
            "min-h-28 items-start py-2.5",
          )}
        >
          <textarea
            ref={ref}
            id={id}
            className={cn(
              controlClassName,
              "min-h-24 resize-y leading-[1.5]",
              textareaClassName,
            )}
            aria-invalid={invalid || undefined}
            disabled={disabled || undefined}
            {...props}
          />
        </span>
      </label>
    );
  },
);

type TextInputButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value"
> &
  ButtonVariants & {
    icon?: ReactNode;
    suffix?: ReactNode;
    value: ReactNode;
    contentClassName?: string;
  };

function TextInputButton({
  icon,
  suffix,
  value,
  variant,
  size,
  className,
  contentClassName,
  disabled,
  ...props
}: TextInputButtonProps) {
  return (
    <button
      type="button"
      className={cn(textInputButtonVariants({ variant, size }), className)}
      disabled={disabled}
      {...props}
    >
      {icon && <span className={iconClassName}>{icon}</span>}
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-g text-g-ui tracking-g-ui text-g-ink-2",
          contentClassName,
        )}
      >
        {value}
      </span>
      {suffix && <span className={affixClassName}>{suffix}</span>}
    </button>
  );
}

/* eslint-disable react-refresh/only-export-components */
export {
  TextInput,
  TextInputButton,
  Textarea,
  textInputShellVariants,
  textInputButtonVariants,
  type TextInputProps,
  type TextInputButtonProps,
  type TextareaProps,
};
/* eslint-enable react-refresh/only-export-components */

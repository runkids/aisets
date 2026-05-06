import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ─── Shell (shared wrapper) ─────────────────────────────── */

const textInputShellVariants = cva(
  [
    "inline-flex w-full min-w-0 items-center gap-2 rounded-g-md border px-2.5 text-g-ink transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
    "focus-within:border-g-accent focus-within:bg-g-surface focus-within:shadow-g-focus",
  ],
  {
    variants: {
      variant: {
        default:
          "border-g-line-strong bg-g-surface-3 hover:border-g-line-strong",
        outline: "border-g-line bg-transparent hover:border-g-line-strong",
        subtle: "border-transparent bg-g-surface-3 hover:border-g-line-strong",
        search:
          "border-g-line-strong bg-g-surface-3 hover:border-g-line-strong",
      },
      size: {
        sm: "h-g-btn-sm",
        md: "h-g-btn-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

type ShellVariants = VariantProps<typeof textInputShellVariants>;

/* ─── TextInput ──────────────────────────────────────────── */

const inputBaseClassName =
  "min-w-0 flex-1 border-0 bg-transparent font-g-mono text-g-ui tracking-g-mono text-g-ink outline-none placeholder:text-g-ink-3";

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  ShellVariants & {
    label?: string;
    icon?: ReactNode;
    suffix?: ReactNode;
    invalid?: boolean;
    inputClassName?: string;
  };

function TextInput({
  label,
  icon,
  suffix,
  id,
  variant,
  size,
  invalid = false,
  className,
  inputClassName,
  ...props
}: TextInputProps) {
  return (
    <label
      className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}
      htmlFor={id}
    >
      {label && (
        <span className="font-g text-g-caption font-[510] tracking-[-0.011em] text-g-ink-3">
          {label}
        </span>
      )}
      <span
        className={cn(
          textInputShellVariants({ variant, size }),
          invalid && "border-g-red",
        )}
      >
        {icon && (
          <span className="inline-flex shrink-0 text-g-ink-3">{icon}</span>
        )}
        <input
          id={id}
          className={cn(inputBaseClassName, inputClassName)}
          aria-invalid={invalid || undefined}
          {...props}
        />
        {suffix && (
          <span className="shrink-0 text-g-caption text-g-ink-3">{suffix}</span>
        )}
      </span>
    </label>
  );
}

/* ─── TextInputButton ────────────────────────────────────── */

type TextInputButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value"
> &
  ShellVariants & {
    icon?: ReactNode;
    suffix?: ReactNode;
    value: ReactNode;
    contentClassName?: string;
  };

function TextInputButton({
  icon,
  suffix,
  value,
  variant = "search",
  size,
  className,
  contentClassName,
  disabled,
  ...props
}: TextInputButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        textInputShellVariants({ variant, size }),
        "cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-[0.38]",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {icon && (
        <span className="inline-flex shrink-0 text-g-ink-3">{icon}</span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-g text-g-ui tracking-g-ui text-g-ink-2",
          contentClassName,
        )}
      >
        {value}
      </span>
      {suffix && (
        <span className="shrink-0 text-g-caption text-g-ink-3">{suffix}</span>
      )}
    </button>
  );
}

/* eslint-disable react-refresh/only-export-components */
export {
  TextInput,
  TextInputButton,
  textInputShellVariants,
  type TextInputProps,
  type TextInputButtonProps,
};
/* eslint-enable react-refresh/only-export-components */

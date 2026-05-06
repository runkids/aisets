import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type TextInputVariant = "default" | "outline" | "subtle" | "search";
type TextInputSize = "sm" | "md";

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  variant?: TextInputVariant;
  size?: TextInputSize;
  invalid?: boolean;
  inputClassName?: string;
};

type TextInputButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
  icon?: ReactNode;
  suffix?: ReactNode;
  value: ReactNode;
  variant?: TextInputVariant;
  size?: TextInputSize;
  contentClassName?: string;
};

const fieldClassName = "flex min-w-0 flex-1 flex-col gap-1.5";
const labelClassName =
  "font-g text-g-caption font-[510] tracking-[-0.011em] text-g-ink-3";
const shellBaseClassName = cn(
  "inline-flex w-full min-w-0 items-center gap-2 rounded-g-md border px-2.5 text-g-ink transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
  "focus-within:border-g-accent focus-within:bg-g-surface focus-within:shadow-g-focus",
);

const shellVariantClassNames: Record<TextInputVariant, string> = {
  default: "border-g-line-strong bg-g-surface-3 hover:border-g-line-strong",
  outline: "border-g-line bg-transparent hover:border-g-line-strong",
  subtle: "border-transparent bg-g-surface-3 hover:border-g-line-strong",
  search: "border-g-line-strong bg-g-surface-3 hover:border-g-line-strong",
};

const shellSizeClassNames: Record<TextInputSize, string> = {
  sm: "h-g-btn-sm",
  md: "h-g-btn-md",
};

const inputBaseClassName =
  "min-w-0 flex-1 border-0 bg-transparent font-g-mono text-g-ui tracking-g-mono text-g-ink outline-none placeholder:text-g-ink-3";

export function TextInputButton({
  icon,
  suffix,
  value,
  variant = "search",
  size = "md",
  className,
  contentClassName,
  disabled,
  ...props
}: TextInputButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        shellBaseClassName,
        shellVariantClassNames[variant],
        shellSizeClassNames[size],
        "text-input-button",
        `text-input-button--${variant}`,
        `text-input-button--${size}`,
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

export function TextInput({
  label,
  icon,
  suffix,
  id,
  variant = "default",
  size = "md",
  invalid = false,
  className,
  inputClassName,
  ...props
}: TextInputProps) {
  return (
    <label className={cn(fieldClassName, className)} htmlFor={id}>
      {label && <span className={labelClassName}>{label}</span>}
      <span
        className={cn(
          shellBaseClassName,
          shellVariantClassNames[variant],
          shellSizeClassNames[size],
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

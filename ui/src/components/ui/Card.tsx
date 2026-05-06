import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type CardVariant = "default" | "elevated" | "nested";
type CardPadding = "none" | "sm" | "md" | "lg";

type CardProps = HTMLAttributes<HTMLElement> & {
  variant?: CardVariant;
  padding?: CardPadding;
  clickable?: boolean;
};

type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  padding?: CardPadding;
};

const cardBaseClassName =
  "overflow-hidden transition-[border-color,box-shadow,transform] duration-[120ms] ease-g";

const cardVariantClassNames: Record<CardVariant, string> = {
  default:
    "border border-g-line bg-g-surface rounded-g-md shadow-g-sm hover:border-g-line-strong hover:shadow-g-md",
  elevated: "bg-g-surface-2 rounded-g-lg shadow-g-inset",
  nested: "bg-g-canvas rounded-g-lg",
};

const cardPaddingClassNames: Record<CardPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-3",
  lg: "px-4 py-6",
};

export function Card({
  variant = "default",
  padding = "none",
  clickable = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <section
      className={cn(
        cardBaseClassName,
        cardVariantClassNames[variant],
        cardPaddingClassNames[padding],
        clickable && "cursor-pointer",
        className,
      )}
      data-clickable={clickable || undefined}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardBody({
  padding = "none",
  className,
  children,
  ...props
}: CardBodyProps) {
  return (
    <div className={cn(cardPaddingClassNames[padding], className)} {...props}>
      {children}
    </div>
  );
}

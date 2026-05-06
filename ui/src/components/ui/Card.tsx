import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const cardVariants = cva(
  "overflow-hidden transition-[border-color,box-shadow,transform] duration-[120ms] ease-g",
  {
    variants: {
      variant: {
        default:
          "border border-g-line bg-g-surface rounded-g-md shadow-g-sm hover:border-g-line-strong hover:shadow-g-md",
        elevated: "bg-g-surface-2 rounded-g-lg shadow-g-inset",
        nested: "bg-g-canvas rounded-g-lg",
      },
      padding: {
        none: "",
        sm: "p-2",
        md: "p-3",
        lg: "px-4 py-6",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "none",
    },
  },
);

type CardProps = HTMLAttributes<HTMLElement> &
  VariantProps<typeof cardVariants> & {
    clickable?: boolean;
  };

type CardBodyProps = HTMLAttributes<HTMLDivElement> &
  Pick<VariantProps<typeof cardVariants>, "padding">;

export function Card({
  variant,
  padding,
  clickable = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <section
      className={cn(
        cardVariants({ variant, padding }),
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

const cardBodyPadding: Record<string, string> = {
  none: "",
  sm: "p-2",
  md: "p-3",
  lg: "px-4 py-6",
};

export function CardBody({
  padding = "none",
  className,
  children,
  ...props
}: CardBodyProps) {
  return (
    <div
      className={cn(cardBodyPadding[padding ?? "none"], className)}
      {...props}
    >
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { cardVariants };

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const railVariants = cva(
  "flex w-[220px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[var(--g-line)] bg-[var(--g-surface)] px-3 py-4",
  {
    variants: {
      variant: {
        filter: "max-lg:hidden",
        settings: "max-md:w-16 max-md:px-2 max-md:py-3",
      },
    },
    defaultVariants: {
      variant: "filter",
    },
  },
);

const railSectionVariants = cva("flex flex-col gap-1");

const railHeadingVariants = cva(
  "m-0 px-1 pb-1 font-g text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-[var(--g-ink-3)]",
);

const railItemVariants = cva(
  [
    "flex min-h-[30px] w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--g-r-md)] !px-2.5 !py-1.5 text-left font-g text-[13px] leading-[1.4] tracking-[-0.012em]",
    "transition-[background,color,box-shadow] duration-[120ms] ease-[var(--g-ease)]",
    "focus-visible:outline-none focus-visible:shadow-[var(--g-shadow-focus)] disabled:cursor-not-allowed disabled:!opacity-[0.38]",
  ],
  {
    variants: {
      state: {
        active:
          "!bg-[var(--g-active-bg)] font-[var(--g-active-weight)] !text-[var(--g-active-text)] hover:!bg-[var(--g-active-bg)] hover:!text-[var(--g-active-text)]",
        inactive:
          "font-normal !text-[var(--g-ink-2)] hover:!bg-[color-mix(in_srgb,var(--g-surface-2)_54%,transparent)] hover:!text-[var(--g-ink)] hover:shadow-[inset_0_0_0_1px_var(--g-line)]",
      },
      variant: {
        filter: "",
        settings: "max-md:justify-center max-md:!px-2",
      },
    },
    defaultVariants: {
      state: "inactive",
      variant: "filter",
    },
  },
);

const railItemLabelVariants = cva("min-w-0 truncate", {
  variants: {
    variant: {
      filter: "",
      settings: "max-md:hidden",
    },
  },
  defaultVariants: {
    variant: "filter",
  },
});

const railItemCountVariants = cva(
  "shrink-0 font-g-mono text-[11px] tracking-[-0.015em] tabular-nums",
  {
    variants: {
      state: {
        active: "text-current opacity-70",
        inactive: "text-[var(--g-ink-3)]",
      },
    },
    defaultVariants: {
      state: "inactive",
    },
  },
);

const railItemIconVariants = cva(
  "inline-flex shrink-0 text-current opacity-70 [&_svg]:size-[15px]",
);

const railItemContentVariants = cva("flex min-w-0 items-center gap-2");

type RailProps = HTMLAttributes<HTMLElement> &
  VariantProps<typeof railVariants> & {
    as?: "aside" | "nav";
  };

function Rail({
  as: Component = "aside",
  variant,
  className,
  ...props
}: RailProps) {
  return (
    <Component
      className={cn(railVariants({ variant }), className)}
      {...props}
    />
  );
}

type RailSectionProps = HTMLAttributes<HTMLElement> & {
  heading?: ReactNode;
};

function RailSection({
  heading,
  className,
  children,
  ...props
}: RailSectionProps) {
  return (
    <section className={cn(railSectionVariants(), className)} {...props}>
      {heading && <h3 className={railHeadingVariants()}>{heading}</h3>}
      {children}
    </section>
  );
}

type RailItemProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof railItemVariants> & {
    active?: boolean;
    count?: ReactNode;
    icon?: ReactNode;
    label: ReactNode;
  };

function RailItem({
  active,
  count,
  icon,
  label,
  variant,
  className,
  type = "button",
  ...props
}: RailItemProps) {
  const state = active ? "active" : "inactive";

  return (
    <button
      type={type}
      data-state={state}
      aria-pressed={props["aria-pressed"] ?? active}
      className={cn(railItemVariants({ state, variant }), className)}
      {...props}
    >
      {icon ? (
        <span className={railItemContentVariants()}>
          <span className={railItemIconVariants()}>{icon}</span>
          <span className={railItemLabelVariants({ variant })}>{label}</span>
        </span>
      ) : (
        <span className={railItemLabelVariants({ variant })}>{label}</span>
      )}
      {count != null && (
        <span className={railItemCountVariants({ state })}>{count}</span>
      )}
    </button>
  );
}

export {
  Rail,
  RailItem,
  RailSection,
  type RailItemProps,
  type RailProps,
  type RailSectionProps,
};

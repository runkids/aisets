import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  UIEvent,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { activeRailSectionsForScroll } from "./RailState";

const RAIL_HEADING_HEIGHT = 28;

const railVariants = cva(
  "mt-3 mb-3 flex min-h-0 shrink-0 flex-col gap-2 overflow-y-auto rounded-t-[var(--g-r-md)] bg-transparent px-1.5",
  {
    variants: {
      variant: {
        filter: "w-[200px] max-lg:hidden",
        settings: "w-[220px] max-md:w-16 max-md:px-2",
      },
    },
    defaultVariants: {
      variant: "filter",
    },
  },
);

const railSectionVariants = cva(
  "flex flex-col gap-1 overflow-clip rounded-[var(--g-r-md)] border border-[var(--g-line)] bg-[var(--g-surface)] p-1 shadow-[var(--g-shadow-sm)]",
);

const railHeadingVariants = cva(
  "-mx-1 -mt-1 mb-0 flex min-h-[28px] items-center bg-[var(--g-surface)] px-3 py-1.5 font-g text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-[var(--g-ink-3)]",
);

const railStickyHeadingVariants = cva(
  "flex min-h-[28px] items-center border-b border-[var(--g-line)] bg-[var(--g-surface)] px-3 py-1.5 font-g text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-[var(--g-ink-3)] shadow-g-sm last:border-b-0",
);

const railHeadingButtonVariants = cva(
  "block w-full text-left transition-colors duration-[120ms] ease-[var(--g-ease)] hover:text-[var(--g-ink)] focus-visible:outline-none focus-visible:shadow-[var(--g-shadow-focus)]",
);

const railItemVariants = cva(
  [
    "flex min-h-[28px] w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--g-r-md)] !px-2 !py-1.5 text-left font-g text-g-ui leading-[1.4] tracking-g-ui",
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

type RailSectionRegistration = {
  id: string;
  heading: ReactNode;
  element: HTMLElement;
};

type RailContextValue = {
  registerSection: (section: RailSectionRegistration) => () => void;
  scrollToSection: (id: string) => void;
};

const RailContext = createContext<RailContextValue | null>(null);

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sectionTopInRail(rail: HTMLElement, element: HTMLElement) {
  return (
    element.getBoundingClientRect().top -
    rail.getBoundingClientRect().top +
    rail.scrollTop
  );
}

type RailProps = HTMLAttributes<HTMLElement> &
  VariantProps<typeof railVariants> & {
    as?: "aside" | "nav";
  };

function Rail({
  as: Component = "aside",
  variant,
  className,
  children,
  onScroll,
  ...props
}: RailProps) {
  const railRef = useRef<HTMLElement>(null);
  const sectionsRef = useRef<RailSectionRegistration[]>([]);
  const frameRef = useRef<number | null>(null);
  const [activeSections, setActiveSections] = useState<
    RailSectionRegistration[]
  >([]);

  const updateActiveSections = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const sortedSections = [...sectionsRef.current].sort(
      (a, b) =>
        sectionTopInRail(rail, a.element) - sectionTopInRail(rail, b.element),
    );
    const next = activeRailSectionsForScroll(
      sortedSections,
      rail.scrollTop,
      rail.scrollHeight,
      rail.clientHeight,
      (section) => sectionTopInRail(rail, section.element),
    );
    setActiveSections((prev) => {
      const prevIds = prev.map((section) => section.id);
      const nextIds = next.map((section) => section.id);
      if (!sameIds(prevIds, nextIds)) return next;
      return prev.every((section, index) => section === next[index])
        ? prev
        : next;
    });
  }, []);

  const scheduleActiveSectionsUpdate = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateActiveSections();
    });
  }, [updateActiveSections]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const registerSection = useCallback(
    (section: RailSectionRegistration) => {
      sectionsRef.current = [
        ...sectionsRef.current.filter((item) => item.id !== section.id),
        section,
      ];
      scheduleActiveSectionsUpdate();

      return () => {
        sectionsRef.current = sectionsRef.current.filter(
          (item) => item.id !== section.id,
        );
        scheduleActiveSectionsUpdate();
      };
    },
    [scheduleActiveSectionsUpdate],
  );

  const scrollToSection = useCallback((id: string) => {
    const rail = railRef.current;
    if (!rail) return;
    const sortedSections = [...sectionsRef.current].sort(
      (a, b) =>
        sectionTopInRail(rail, a.element) - sectionTopInRail(rail, b.element),
    );
    const sectionIndex = sortedSections.findIndex((item) => item.id === id);
    const section = sortedSections[sectionIndex];
    if (!section) return;
    rail.scrollTo({
      top: Math.max(
        0,
        sectionTopInRail(rail, section.element) -
          sectionIndex * RAIL_HEADING_HEIGHT,
      ),
      behavior: "smooth",
    });
  }, []);

  const contextValue = useMemo(
    () => ({ registerSection, scrollToSection }),
    [registerSection, scrollToSection],
  );

  function handleScroll(event: UIEvent<HTMLElement>) {
    onScroll?.(event);
    updateActiveSections();
  }

  return (
    <RailContext.Provider value={contextValue}>
      <Component
        ref={railRef}
        className={cn(railVariants({ variant }), className)}
        onScroll={handleScroll}
        {...props}
      >
        {activeSections.length > 0 && (
          <div className="pointer-events-none sticky top-0 z-[10] h-0">
            <div className="pointer-events-auto flex flex-col overflow-clip rounded-t-[var(--g-r-md)] shadow-g-sm">
              {activeSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={cn(railStickyHeadingVariants(), "text-left")}
                  onClick={() => scrollToSection(section.id)}
                >
                  {section.heading}
                </button>
              ))}
            </div>
          </div>
        )}
        {children}
      </Component>
    </RailContext.Provider>
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
  const id = useId();
  const railContext = useContext(RailContext);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!heading || !sectionRef.current || !railContext) return;
    return railContext.registerSection({
      id,
      heading,
      element: sectionRef.current,
    });
  }, [heading, id, railContext]);

  function scrollSectionStart() {
    if (railContext) {
      railContext.scrollToSection(id);
      return;
    }
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <section
      ref={sectionRef}
      className={cn(railSectionVariants(), className)}
      {...props}
    >
      {heading && (
        <h3 className={railHeadingVariants()}>
          <button
            type="button"
            className={railHeadingButtonVariants()}
            onClick={scrollSectionStart}
          >
            {heading}
          </button>
        </h3>
      )}
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

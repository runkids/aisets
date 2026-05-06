import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
};

type SelectSize = "sm" | "md";

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  size?: SelectSize;
  className?: string;
};

const triggerSizeClassNames: Record<SelectSize, string> = {
  sm: "h-g-btn-sm text-g-caption",
  md: "h-g-btn-md text-g-ui",
};

export function Select({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !menuRef.current) return;

    const trigger = rootRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 6;
    const pad = 8;

    const style: CSSProperties = { left: 0, right: 0 };

    const spaceBelow = window.innerHeight - trigger.bottom - gap;
    const spaceAbove = trigger.top - gap;

    if (spaceBelow >= menu.height || spaceBelow >= spaceAbove) {
      style.top = `calc(100% + ${gap}px)`;
      style.bottom = "auto";
    } else {
      style.bottom = `calc(100% + ${gap}px)`;
      style.top = "auto";
    }

    if (trigger.right > window.innerWidth - pad) {
      style.right = 0;
      style.left = "auto";
    }
    if (trigger.left < pad) {
      style.left = 0;
      style.right = "auto";
    }

    setMenuStyle(style);
  }, [open]);

  return (
    <div className={cn("relative min-w-[160px]", className)} ref={rootRef}>
      <button
        type="button"
        className={cn(
          "inline-flex w-full items-center gap-2 rounded-g-md bg-g-surface px-2.5 font-g font-[510] tracking-g-ui text-g-ink transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
          "hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus",
          triggerSizeClassNames[size],
        )}
        style={{
          border: "1px solid var(--g-line)",
          boxShadow: "var(--g-shadow-inset)",
          padding: "0 12px",
          height: 34,
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        {selected?.icon}
        <span className="min-w-0 flex-1 truncate text-left">
          {selected?.label ?? value}
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 transition-transform duration-[120ms] ease-g",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul
          className="absolute z-[60] max-h-64 min-w-full overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop"
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-g-md px-2.5 py-2 text-left font-g text-g-ui text-g-ink-2 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:font-[590] data-[active=true]:text-g-active-text"
                data-active={option.value === value || undefined}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && (
                  <Check size={15} className="shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

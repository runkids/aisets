import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";

export type DropdownMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
};

type DropdownMenuProps = {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  align?: "left" | "right";
};

export function DropdownMenu({
  trigger,
  items,
  align = "right",
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: align === "right" ? undefined : rect.left,
      right: align === "right" ? window.innerWidth - rect.right : undefined,
    });
    const dismiss = () => close();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, align, close]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      )
        close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      first?.focus();
    }
  }, [open, pos]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!menuRef.current) return;
    const btns = Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      btns[(idx + 1) % btns.length]?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      btns[(idx - 1 + btns.length) % btns.length]?.focus();
    }
  };

  return (
    <div ref={anchorRef}>
      <div
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {trigger}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onKeyDown}
            className="fixed z-[60] min-w-[180px] overflow-auto rounded-g-md border border-g-line-strong bg-g-surface p-1.5 shadow-g-pop"
            style={{
              top: pos.top,
              left: pos.left,
              right: pos.right,
              maxHeight: 320,
              animation: "modalIn 120ms var(--g-ease-out)",
            }}
          >
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cn(
                  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-g-md px-3 py-2 text-left font-g text-g-body leading-[1.4] font-[510] transition-[background,color,box-shadow] duration-[120ms] ease-g",
                  "focus-visible:outline-none focus-visible:shadow-g-focus",
                  "disabled:cursor-not-allowed disabled:opacity-[0.38]",
                  item.variant === "danger"
                    ? "text-g-red hover:bg-g-red-soft"
                    : "text-g-ink-2 hover:bg-g-surface-3 hover:text-g-ink",
                )}
                onClick={() => {
                  close();
                  item.onClick();
                }}
              >
                {item.icon && (
                  <span className="shrink-0 [&_svg]:size-[15px]">
                    {item.icon}
                  </span>
                )}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

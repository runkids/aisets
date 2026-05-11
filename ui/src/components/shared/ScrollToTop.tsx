import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type Props = {
  scrollerSelector?: string;
  threshold?: number;
};

export function ScrollToTop({
  scrollerSelector = ".content-scroll",
  threshold = 400,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let attempts = 0;
    const findEl = () => {
      const candidates =
        document.querySelectorAll<HTMLElement>(scrollerSelector);
      let el: HTMLElement | null = null;
      for (const c of candidates) {
        if (c.scrollHeight > c.clientHeight) {
          el = c;
          break;
        }
      }
      el ??= candidates[0] ?? null;
      if (el) {
        setScroller(el);
        const onScroll = () => setVisible(el!.scrollTop > threshold);
        el.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        cleanup = () => el?.removeEventListener("scroll", onScroll);
        return;
      }
      if (attempts++ < 10) {
        const id = window.setTimeout(findEl, 200);
        cleanup = () => window.clearTimeout(id);
      }
    };
    findEl();
    return () => cleanup?.();
  }, [scrollerSelector, threshold]);

  function jumpToTop() {
    scroller?.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!visible) return null;
  return (
    <button
      type="button"
      className={cn(
        "fixed bottom-6 right-6 z-50 flex size-10 items-center justify-center rounded-g-md",
        "border border-g-line-strong bg-g-surface text-g-ink-3 shadow-[3px_3px_0_var(--g-line)]",
        "transition-all duration-150 ease-g",
        "hover:bg-g-surface-2 hover:text-g-ink-2 hover:border-g-ink-4",
      )}
      onClick={jumpToTop}
      aria-label={t("action.scrollToTop")}
    >
      <ArrowUp size={18} strokeWidth={2.5} />
    </button>
  );
}

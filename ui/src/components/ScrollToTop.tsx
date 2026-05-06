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
    let el: HTMLElement | null = null;
    let attempts = 0;
    const findEl = () => {
      el = document.querySelector<HTMLElement>(scrollerSelector);
      if (el) {
        setScroller(el);
        const onScroll = () => setVisible(el!.scrollTop > threshold);
        el.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => el?.removeEventListener("scroll", onScroll);
      }
      if (attempts++ < 10) {
        const id = window.setTimeout(findEl, 200);
        return () => window.clearTimeout(id);
      }
      return undefined;
    };
    return findEl();
  }, [scrollerSelector, threshold]);

  function jumpToTop() {
    scroller?.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!visible) return null;
  return (
    <button
      type="button"
      className={cn(
        "fixed bottom-7 right-7 z-50 flex size-10 items-center justify-center rounded-full",
        "border border-g-line-strong bg-g-surface text-g-ink shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
        "transition-all duration-150 ease-g",
        "hover:bg-g-ink hover:text-g-canvas hover:border-g-ink hover:-translate-y-0.5",
      )}
      onClick={jumpToTop}
      aria-label={t("action.scrollToTop")}
    >
      <ArrowUp size={18} />
    </button>
  );
}

import { CircleHelp, ImageDown, Sliders, Terminal, X, Zap } from "lucide-react";
import { Popover } from "radix-ui";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export function OptimizeHelpPopover() {
  const { t } = useTranslation();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="ml-auto inline-flex h-g-btn-md shrink-0 cursor-pointer items-center justify-center rounded-g-sm px-1.5 text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
          aria-label={t("optimize.actionsHelpTitle")}
        >
          <CircleHelp size={15} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className={cn(
            "z-[200] flex max-h-[var(--radix-popper-available-height)] w-[480px] flex-col rounded-g-lg border border-g-line-strong bg-g-canvas shadow-g-pop",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-g-line px-3.5 py-2.5">
            <h3 className="font-g text-g-ui font-[590] text-g-ink">
              {t("optimize.actionsHelpTitle")}
            </h3>
            <Popover.Close asChild>
              <button
                type="button"
                className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-g-sm p-0.5 text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </Popover.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3.5 py-3">
            <dl className="grid gap-2.5">
              {(
                [
                  { icon: <Zap size={13} />, key: "quickOptimize" },
                  { icon: <Sliders size={13} />, key: "estimate" },
                  { icon: <ImageDown size={13} />, key: "optimizeAction" },
                  { icon: <Terminal size={13} />, key: "script" },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-[16px_1fr] items-start gap-x-2.5 gap-y-0.5"
                >
                  <span className="mt-[3px] text-g-ink-4">{item.icon}</span>
                  <dt className="font-g text-g-caption font-[590] text-g-ink">
                    {t(`optimize.${item.key}`)}
                  </dt>
                  <span aria-hidden="true" />
                  <dd className="font-g text-g-caption font-normal leading-relaxed text-g-ink-3">
                    {t(`optimize.help.${item.key}`)}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 border-t border-g-line pt-3">
              <div className="mb-1 font-g-mono text-g-chip font-[510] uppercase tracking-[0.08em] text-g-red">
                {t("optimize.rulesLabel")}
              </div>
              <div className="mb-2 font-g text-g-caption font-[590] text-g-ink">
                {t("optimize.strategyTitle")}
              </div>
              <div className="grid gap-1.5">
                {(
                  [
                    {
                      src: "PNG",
                      cond: "optimize.rule.pngOpaque",
                      target: "AVIF",
                      quality: "q50",
                    },
                    {
                      src: "PNG",
                      cond: "optimize.rule.pngAlpha",
                      target: "WebP",
                      quality: "q80",
                    },
                    {
                      src: "JPG/JPEG",
                      cond: "> 200KB",
                      target: "AVIF",
                      quality: "q50",
                    },
                    {
                      src: "GIF",
                      cond: "optimize.rule.gifAnimated",
                      target: "GIF",
                      quality: "q75",
                    },
                    {
                      src: "WebP",
                      cond: "> 800KB",
                      target: "WebP",
                      quality: "q60",
                    },
                    {
                      src: "SVG",
                      cond: "> 100KB",
                      target: "SVGO",
                      quality: "optimize.rule.minify",
                    },
                    {
                      src: "optimize.rule.oversized",
                      cond: `> ${1200}px`,
                      target: "optimize.rule.resize",
                      quality: "optimize.rule.auto",
                    },
                  ] as const
                ).map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 py-1.5 text-g-caption"
                  >
                    <span className="w-[72px] shrink-0 font-[590] text-g-ink">
                      {rule.src.startsWith("optimize.")
                        ? t(rule.src)
                        : rule.src}
                    </span>
                    <span className="flex-1 text-g-ink-3">
                      {rule.cond.startsWith("optimize.")
                        ? t(rule.cond)
                        : rule.cond}
                    </span>
                    <span className="text-g-ink-4">→</span>
                    <span className="w-[52px] shrink-0 font-[590] text-g-green">
                      {rule.target.startsWith("optimize.")
                        ? t(rule.target)
                        : rule.target}
                    </span>
                    <span className="w-[48px] shrink-0 text-right font-[590] text-g-green">
                      {rule.quality.startsWith("optimize.")
                        ? t(rule.quality)
                        : rule.quality}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

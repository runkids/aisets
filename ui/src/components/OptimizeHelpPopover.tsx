import {
  CircleHelp,
  ImageDown,
  Settings2,
  Sliders,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { defaultOptimizationStrategies } from "./settings/constants";
import { useSettingsQuery } from "../queries";
import type {
  OptimizationStrategy,
  OptimizationStrategyAction,
  OptimizationStrategyMatch,
} from "../types";

function formatSource(
  strategy: OptimizationStrategy,
  t: (key: string) => string,
): string {
  if (
    strategy.action.operation === "resize" &&
    strategy.match.formats.length > 3
  ) {
    return t("optimize.rule.oversized");
  }
  if (strategy.action.operation === "svg-minify") {
    return "SVG";
  }

  const fmts = new Set(strategy.match.formats.map((f) => f.toLowerCase()));
  const parts: string[] = [];
  if (fmts.has("png")) parts.push("PNG");
  if (fmts.has("jpg") || fmts.has("jpeg")) parts.push("JPG/JPEG");
  if (fmts.has("gif")) parts.push("GIF");
  if (fmts.has("webp")) parts.push("WebP");
  if (fmts.has("avif")) parts.push("AVIF");
  if (fmts.has("svg")) parts.push("SVG");
  return parts.join(", ") || strategy.name;
}

function buildCondition(
  match: OptimizationStrategyMatch,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (match.alpha === "opaque") parts.push(t("optimize.rule.pngOpaque"));
  if (match.alpha === "transparent") parts.push(t("optimize.rule.pngAlpha"));
  if (match.animated === "true") parts.push(t("optimize.rule.gifAnimated"));
  if (match.minBytesKB != null) parts.push(`> ${match.minBytesKB}KB`);
  if (match.minWidthPx != null) parts.push(`> ${match.minWidthPx}px`);
  if (match.minHeightPx != null) parts.push(`H>${match.minHeightPx}px`);
  return parts.join(", ") || "—";
}

const FORMAT_DISPLAY: Record<string, string> = {
  webp: "WebP",
  avif: "AVIF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  svg: "SVG",
};

function formatName(fmt?: string): string {
  if (!fmt) return "";
  return FORMAT_DISPLAY[fmt.toLowerCase()] ?? fmt.toUpperCase();
}

function buildTarget(
  action: OptimizationStrategyAction,
  maxDimensionPx: number,
  t: (key: string) => string,
): { format: string; quality: string } {
  switch (action.operation) {
    case "convert":
    case "recompress":
      return {
        format: formatName(action.outputFormat) || "—",
        quality: action.quality != null ? `q${action.quality}` : "—",
      };
    case "resize":
      return {
        format: t("optimize.rule.resize"),
        quality: action.resizeMaxDimensionPx
          ? `${action.resizeMaxDimensionPx}px`
          : `≤${maxDimensionPx}px`,
      };
    case "svg-minify":
      return {
        format: "SVGO",
        quality: t("optimize.rule.minify"),
      };
  }
}

export function OptimizeHelpPopover() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data?.settings;

  const strategies =
    settings?.optimizationStrategies ?? defaultOptimizationStrategies;
  const maxDimensionPx =
    settings?.optimizationThresholds?.maxDimensionPx ?? 2560;

  const enabledStrategies = strategies
    .filter((s) => s.enabled)
    .sort((a, b) => a.priority - b.priority);

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

            {/* ── Dynamic strategies from settings ── */}
            <div className="mt-4 border-t border-g-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-g-mono text-g-chip font-[510] uppercase tracking-[0.08em] text-g-red">
                  {t("optimize.rulesLabel")}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-g-sm px-1.5 py-0.5 font-g text-g-chip tracking-g-ui text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink"
                  onClick={() =>
                    navigate("/settings?section=optimization&expand=strategies")
                  }
                >
                  <Settings2 size={10} />
                  {t("optimize.editRules")}
                </button>
              </div>
              <div className="mb-2 font-g text-g-caption font-[590] text-g-ink">
                {t("optimize.strategyTitle")}
              </div>

              {enabledStrategies.length > 0 ? (
                <div className="grid gap-1.5">
                  {enabledStrategies.map((strategy) => {
                    const source = formatSource(strategy, t);
                    const condition = buildCondition(strategy.match, t);
                    const target = buildTarget(
                      strategy.action,
                      maxDimensionPx,
                      t,
                    );
                    return (
                      <div
                        key={strategy.id}
                        className="flex items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-3 py-1.5 text-g-caption"
                        title={strategy.name}
                      >
                        <span className="w-[72px] shrink-0 font-[590] text-g-ink">
                          {source}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-g-ink-3">
                          {condition}
                        </span>
                        <span className="text-g-ink-4">→</span>
                        <span className="w-[52px] shrink-0 font-[590] text-g-green">
                          {target.format}
                        </span>
                        <span className="w-[52px] shrink-0 text-right font-[590] text-g-green">
                          {target.quality}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="font-g text-g-caption text-g-ink-4">
                  {t("optimize.noStrategies")}
                </p>
              )}

              {strategies.length > enabledStrategies.length && (
                <p className="mt-1.5 font-g text-g-chip text-g-ink-4">
                  {t("optimize.disabledStrategiesNote", {
                    count: strategies.length - enabledStrategies.length,
                  })}
                </p>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

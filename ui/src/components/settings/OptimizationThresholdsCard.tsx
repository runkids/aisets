import { ChevronDown, Gauge } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { errorMessage } from "../../i18n/index";
import type { SettingsDraft } from "./types";
import { Badge, Button, Card, Notice, Range, Switch } from "../ui";
import { FieldRow } from "./FieldRow";

type OptimizationThresholdsCardProps = {
  draft: SettingsDraft;
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationThresholdsCard({
  draft,
  settingsLoading,
  updatePending,
  updateError,
  settingActions,
  onUpdateDraft,
}: OptimizationThresholdsCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const th = draft.optimizationThresholds;
  const fmtKB = (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(0)}MB` : `${v}KB`;

  return (
    <Card
      className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
      padding="none"
    >
      <div
        className={cn(
          "px-6 py-3 md:px-8",
          expanded && "border-b border-g-line",
        )}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <Gauge size={15} className="shrink-0 text-g-ink-3" />
          <span className="min-w-0 flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.thresholdsHeading")}
          </span>
          <ChevronDown
            size={14}
            className={cn(
              "shrink-0 text-g-ink-4 transition-transform duration-200 ease-g",
              expanded && "rotate-180",
            )}
          />
        </button>
        {!expanded && (
          <div className="mt-2 space-y-2">
            <p className="max-w-[56ch] font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
              {t("settings.thresholdsCollapsedDesc", {
                defaultValue:
                  "Control when optimization suggestions trigger. Set file size limits, maximum dimensions, and SVG savings thresholds.",
              })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="default">SVG ≥{th.svgMinSavingsPercent}%</Badge>
              <Badge tone="default">≤{th.maxDimensionPx}px</Badge>
              <Badge tone="default">
                {fmtKB(th.fileSizeWarningKB)}/{fmtKB(th.fileSizeCriticalKB)}
              </Badge>
              <Badge tone={th.pngAlphaCheckEnabled ? "green" : "default"}>
                PNG alpha {th.pngAlphaCheckEnabled ? "✓" : "—"}
              </Badge>
            </div>
          </div>
        )}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-g motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
            <FieldRow
              label={t("settings.svgMinSavings")}
              description={t("settings.svgMinSavingsHint")}
              align="start"
            >
              <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Range
                      min={0}
                      max={50}
                      value={draft.optimizationThresholds.svgMinSavingsPercent}
                      onChange={(e) =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          optimizationThresholds: {
                            ...prev.optimizationThresholds,
                            svgMinSavingsPercent: Number(e.target.value),
                          },
                        }))
                      }
                      disabled={settingsLoading || updatePending}
                    />
                    <div className="flex justify-between px-0.5 font-g text-g-chip tracking-g-ui text-g-ink-4">
                      <span>
                        {t("settings.svgSavingsRangeMin", {
                          defaultValue: "Always flag",
                        })}
                      </span>
                      <span>
                        {t("settings.svgSavingsRangeMax", {
                          defaultValue: "50% savings min",
                        })}
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                    {draft.optimizationThresholds.svgMinSavingsPercent}%
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[0, 5, 10, 20].map((v) => (
                    <Button
                      key={v}
                      variant="chip"
                      size="sm"
                      data-active={
                        draft.optimizationThresholds.svgMinSavingsPercent ===
                          v || undefined
                      }
                      onClick={() =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          optimizationThresholds: {
                            ...prev.optimizationThresholds,
                            svgMinSavingsPercent: v,
                          },
                        }))
                      }
                      disabled={settingsLoading || updatePending}
                      className="flex-1"
                    >
                      {v}%
                    </Button>
                  ))}
                </div>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.maxDimension")}
              description={t("settings.maxDimensionHint")}
              align="start"
            >
              <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
                <div className="flex items-center gap-3">
                  <Range
                    min={800}
                    max={5120}
                    step={64}
                    value={draft.optimizationThresholds.maxDimensionPx}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        optimizationThresholds: {
                          ...prev.optimizationThresholds,
                          maxDimensionPx: Number(e.target.value),
                        },
                      }))
                    }
                    disabled={settingsLoading || updatePending}
                  />
                  <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                    {draft.optimizationThresholds.maxDimensionPx}px
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[1920, 2560, 3840].map((v) => (
                    <Button
                      key={v}
                      variant="chip"
                      size="sm"
                      data-active={
                        draft.optimizationThresholds.maxDimensionPx === v ||
                        undefined
                      }
                      onClick={() =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          optimizationThresholds: {
                            ...prev.optimizationThresholds,
                            maxDimensionPx: v,
                          },
                        }))
                      }
                      disabled={settingsLoading || updatePending}
                      className="flex-1"
                    >
                      {v}px
                    </Button>
                  ))}
                </div>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.fileSizeWarning")}
              description={t("settings.fileSizeWarningHint")}
              align="start"
            >
              <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
                <div className="flex items-center gap-3">
                  <Range
                    min={50}
                    max={2000}
                    step={50}
                    value={draft.optimizationThresholds.fileSizeWarningKB}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        optimizationThresholds: {
                          ...prev.optimizationThresholds,
                          fileSizeWarningKB: Number(e.target.value),
                        },
                      }))
                    }
                    disabled={settingsLoading || updatePending}
                  />
                  <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                    {draft.optimizationThresholds.fileSizeWarningKB}KB
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[100, 200, 500, 1000].map((v) => (
                    <Button
                      key={v}
                      variant="chip"
                      size="sm"
                      data-active={
                        draft.optimizationThresholds.fileSizeWarningKB === v ||
                        undefined
                      }
                      onClick={() =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          optimizationThresholds: {
                            ...prev.optimizationThresholds,
                            fileSizeWarningKB: v,
                          },
                        }))
                      }
                      disabled={settingsLoading || updatePending}
                      className="flex-1"
                    >
                      {v >= 1000 ? `${v / 1000}MB` : `${v}KB`}
                    </Button>
                  ))}
                </div>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.fileSizeCritical")}
              description={t("settings.fileSizeCriticalHint")}
              align="start"
            >
              <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
                <div className="flex items-center gap-3">
                  <Range
                    min={100}
                    max={5000}
                    step={100}
                    value={draft.optimizationThresholds.fileSizeCriticalKB}
                    onChange={(e) =>
                      onUpdateDraft((prev) => ({
                        ...prev,
                        optimizationThresholds: {
                          ...prev.optimizationThresholds,
                          fileSizeCriticalKB: Number(e.target.value),
                        },
                      }))
                    }
                    disabled={settingsLoading || updatePending}
                  />
                  <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                    {draft.optimizationThresholds.fileSizeCriticalKB >= 1000
                      ? `${(draft.optimizationThresholds.fileSizeCriticalKB / 1000).toFixed(1)}MB`
                      : `${draft.optimizationThresholds.fileSizeCriticalKB}KB`}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[200, 500, 1000, 2000].map((v) => (
                    <Button
                      key={v}
                      variant="chip"
                      size="sm"
                      data-active={
                        draft.optimizationThresholds.fileSizeCriticalKB === v ||
                        undefined
                      }
                      onClick={() =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          optimizationThresholds: {
                            ...prev.optimizationThresholds,
                            fileSizeCriticalKB: v,
                          },
                        }))
                      }
                      disabled={settingsLoading || updatePending}
                      className="flex-1"
                    >
                      {v >= 1000 ? `${v / 1000}MB` : `${v}KB`}
                    </Button>
                  ))}
                </div>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.pngAlphaCheck")}
              description={t("settings.pngAlphaCheckHint")}
            >
              <Switch
                checked={draft.optimizationThresholds.pngAlphaCheckEnabled}
                onCheckedChange={(next) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationThresholds: {
                      ...prev.optimizationThresholds,
                      pngAlphaCheckEnabled: next,
                    },
                  }))
                }
                disabled={settingsLoading || updatePending}
                aria-label={t("settings.pngAlphaCheck")}
              />
            </FieldRow>
            {updateError && (
              <Notice tone="danger">{errorMessage(updateError)}</Notice>
            )}
            {settingActions}
          </div>
        </div>
      </div>
    </Card>
  );
}

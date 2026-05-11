import { Gauge } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n";
import type { SettingsDraft } from "./types";
import { Button, Notice, Range, Switch } from "../ui";
import { FieldRow } from "./FieldRow";

type OptimizationQualityContentProps = {
  draft: SettingsDraft;
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationQualityContent({
  draft,
  settingsLoading,
  updatePending,
  updateError,
  settingActions,
  onUpdateDraft,
}: OptimizationQualityContentProps) {
  const { t } = useTranslation();
  const disabled = settingsLoading || updatePending;
  const th = draft.optimizationThresholds;

  return (
    <>
      <div className="divide-y divide-g-line">
        <FieldRow
          label={t("settings.defaultQuality")}
          description={t("settings.defaultQualityHint")}
          align="start"
        >
          <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Range
                  min={0}
                  max={100}
                  value={draft.optimizationDefaultQuality}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationDefaultQuality: Number(event.target.value),
                    }))
                  }
                  aria-label={t("settings.defaultQuality")}
                />
                <div className="flex justify-between px-0.5 font-g text-g-chip tracking-g-ui text-g-ink-4">
                  <span>
                    {t("settings.qualityRangeMin", {
                      defaultValue: "Smaller files",
                    })}
                  </span>
                  <span>
                    {t("settings.qualityRangeMax", {
                      defaultValue: "Best quality",
                    })}
                  </span>
                </div>
              </div>
              <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {draft.optimizationDefaultQuality}
              </span>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  { label: t("settings.qualityLow"), value: 60 },
                  { label: t("settings.qualityStandard"), value: 80 },
                  { label: t("settings.qualityHigh"), value: 95 },
                  { label: t("settings.qualityMax"), value: 100 },
                ] as const
              ).map((preset) => (
                <Button
                  key={preset.value}
                  variant="chip"
                  size="sm"
                  data-active={
                    draft.optimizationDefaultQuality === preset.value ||
                    undefined
                  }
                  disabled={disabled}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationDefaultQuality: preset.value,
                    }))
                  }
                  className="flex-1"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </FieldRow>

        <FieldRow
          label={t("settings.avifSpeed")}
          description={t("settings.avifSpeedHint")}
          align="start"
        >
          <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
            <div className="flex items-center gap-3">
              <Range
                min={1}
                max={10}
                value={draft.optimizationAvifSpeed}
                disabled={disabled}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationAvifSpeed: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.avifSpeed")}
              />
              <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {draft.optimizationAvifSpeed}
              </span>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  { label: t("settings.avifSpeedFast"), value: 10 },
                  { label: t("settings.avifSpeedBalanced"), value: 6 },
                  { label: t("settings.avifSpeedBest"), value: 1 },
                ] as const
              ).map((preset) => (
                <Button
                  key={preset.value}
                  variant="chip"
                  size="sm"
                  data-active={
                    draft.optimizationAvifSpeed === preset.value || undefined
                  }
                  disabled={disabled}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationAvifSpeed: preset.value,
                    }))
                  }
                  className="flex-1"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </FieldRow>

        <FieldRow
          label={t("settings.workers")}
          description={t("settings.workersHint")}
          align="start"
        >
          <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
            <div className="flex items-center gap-3">
              <Range
                min={1}
                max={4}
                value={draft.optimizationWorkers}
                disabled={disabled}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationWorkers: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.workers")}
              />
              <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {draft.optimizationWorkers}
              </span>
            </div>
          </div>
        </FieldRow>

        <FieldRow
          label={t("settings.autoApply")}
          description={t("settings.autoApplyHint")}
        >
          <Switch
            checked={draft.optimizationAutoApply}
            onCheckedChange={(next) =>
              onUpdateDraft((prev) => ({
                ...prev,
                optimizationAutoApply: next,
              }))
            }
            disabled={disabled}
            aria-label={t("settings.autoApply")}
          />
        </FieldRow>
      </div>

      <div className="flex items-center gap-2 pb-1 pt-5">
        <Gauge size={14} className="text-g-ink-4" />
        <span className="font-g text-g-caption font-[590] uppercase tracking-[0.06em] text-g-ink-4">
          {t("settings.thresholdsHeading")}
        </span>
      </div>

      <div className="divide-y divide-g-line">
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
                  value={th.svgMinSavingsPercent}
                  onChange={(e) =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationThresholds: {
                        ...prev.optimizationThresholds,
                        svgMinSavingsPercent: Number(e.target.value),
                      },
                    }))
                  }
                  disabled={disabled}
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
                {th.svgMinSavingsPercent}%
              </span>
            </div>
            <div className="flex gap-1.5">
              {[0, 5, 10, 20].map((v) => (
                <Button
                  key={v}
                  variant="chip"
                  size="sm"
                  data-active={th.svgMinSavingsPercent === v || undefined}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationThresholds: {
                        ...prev.optimizationThresholds,
                        svgMinSavingsPercent: v,
                      },
                    }))
                  }
                  disabled={disabled}
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
                value={th.maxDimensionPx}
                onChange={(e) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationThresholds: {
                      ...prev.optimizationThresholds,
                      maxDimensionPx: Number(e.target.value),
                    },
                  }))
                }
                disabled={disabled}
              />
              <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {th.maxDimensionPx}px
              </span>
            </div>
            <div className="flex gap-1.5">
              {[1920, 2560, 3840].map((v) => (
                <Button
                  key={v}
                  variant="chip"
                  size="sm"
                  data-active={th.maxDimensionPx === v || undefined}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationThresholds: {
                        ...prev.optimizationThresholds,
                        maxDimensionPx: v,
                      },
                    }))
                  }
                  disabled={disabled}
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
                value={th.fileSizeWarningKB}
                onChange={(e) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationThresholds: {
                      ...prev.optimizationThresholds,
                      fileSizeWarningKB: Number(e.target.value),
                    },
                  }))
                }
                disabled={disabled}
              />
              <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {th.fileSizeWarningKB}KB
              </span>
            </div>
            <div className="flex gap-1.5">
              {[100, 200, 500, 1000].map((v) => (
                <Button
                  key={v}
                  variant="chip"
                  size="sm"
                  data-active={th.fileSizeWarningKB === v || undefined}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationThresholds: {
                        ...prev.optimizationThresholds,
                        fileSizeWarningKB: v,
                      },
                    }))
                  }
                  disabled={disabled}
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
                value={th.fileSizeCriticalKB}
                onChange={(e) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    optimizationThresholds: {
                      ...prev.optimizationThresholds,
                      fileSizeCriticalKB: Number(e.target.value),
                    },
                  }))
                }
                disabled={disabled}
              />
              <span className="inline-flex h-g-btn-sm min-w-[52px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                {th.fileSizeCriticalKB >= 1000
                  ? `${(th.fileSizeCriticalKB / 1000).toFixed(1)}MB`
                  : `${th.fileSizeCriticalKB}KB`}
              </span>
            </div>
            <div className="flex gap-1.5">
              {[200, 500, 1000, 2000].map((v) => (
                <Button
                  key={v}
                  variant="chip"
                  size="sm"
                  data-active={th.fileSizeCriticalKB === v || undefined}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationThresholds: {
                        ...prev.optimizationThresholds,
                        fileSizeCriticalKB: v,
                      },
                    }))
                  }
                  disabled={disabled}
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
            checked={th.pngAlphaCheckEnabled}
            onCheckedChange={(next) =>
              onUpdateDraft((prev) => ({
                ...prev,
                optimizationThresholds: {
                  ...prev.optimizationThresholds,
                  pngAlphaCheckEnabled: next,
                },
              }))
            }
            disabled={disabled}
            aria-label={t("settings.pngAlphaCheck")}
          />
        </FieldRow>

        {updateError && (
          <Notice tone="danger">{errorMessage(updateError)}</Notice>
        )}
        {settingActions}
      </div>
    </>
  );
}

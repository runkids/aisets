import { Sliders } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n/index";
import type { SettingsDraft } from "./types";
import { FieldRow } from "./FieldRow";
import { sectionIcon } from "./helpers";
import { Button, Card, Notice, Range, Switch } from "../ui";

type OptimizationSectionProps = {
  draft: SettingsDraft;
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationSection({
  draft,
  settingsLoading,
  updatePending,
  updateError,
  settingActions,
  onUpdateDraft,
}: OptimizationSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <span className="shrink-0 text-g-ink-3">
            {sectionIcon("optimization")}
          </span>
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.optimization")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow
            label={t("settings.defaultQuality")}
            description={t("settings.defaultQualityHint")}
            icon={<Sliders size={15} />}
            align="start"
          >
            <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
              <div className="flex items-center gap-3">
                <Range
                  min={0}
                  max={100}
                  value={draft.optimizationDefaultQuality}
                  disabled={settingsLoading || updatePending}
                  onChange={(event) =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationDefaultQuality: Number(event.target.value),
                    }))
                  }
                  aria-label={t("settings.defaultQuality")}
                />
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
                    disabled={settingsLoading || updatePending}
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
            label={t("settings.autoApply")}
            description={t("settings.autoApplyHint")}
            icon={<Sliders size={15} />}
          >
            <Switch
              checked={draft.optimizationAutoApply}
              onCheckedChange={(next) =>
                onUpdateDraft((prev) => ({
                  ...prev,
                  optimizationAutoApply: next,
                }))
              }
              disabled={settingsLoading || updatePending}
              aria-label={t("settings.autoApply")}
            />
          </FieldRow>
          {updateError && (
            <Notice tone="danger">{errorMessage(updateError)}</Notice>
          )}
          {settingActions}
        </div>
      </Card>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <Sliders size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.thresholdsHeading")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow
            label={t("settings.svgMinSavings")}
            description={t("settings.svgMinSavingsHint")}
            align="start"
          >
            <div className="flex w-full flex-col gap-3 min-[1200px]:w-[320px]">
              <div className="flex items-center gap-3">
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
                      draft.optimizationThresholds.svgMinSavingsPercent === v ||
                      undefined
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
      </Card>
    </>
  );
}

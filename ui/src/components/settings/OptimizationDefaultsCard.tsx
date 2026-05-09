import { Sliders } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n/index";
import type { SettingsDraft } from "./types";
import { Button, Card, Notice, Range } from "../ui";
import { FieldRow } from "./FieldRow";
import { sectionIcon } from "./helpers";

type OptimizationDefaultsCardProps = {
  draft: SettingsDraft;
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationDefaultsCard({
  draft,
  settingsLoading,
  updatePending,
  updateError,
  settingActions,
  onUpdateDraft,
}: OptimizationDefaultsCardProps) {
  const { t } = useTranslation();

  return (
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
              <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        {updateError && (
          <Notice tone="danger">{errorMessage(updateError)}</Notice>
        )}
        {settingActions}
      </div>
    </Card>
  );
}

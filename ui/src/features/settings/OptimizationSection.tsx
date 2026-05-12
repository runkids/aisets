import { Info, ListChecks, SlidersHorizontal, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationToolRuntime } from "@/types";
import type { SettingsDraft } from "./types";
import { Card, IconButton, Tabs } from "@/components/ui";
import { sectionIcon } from "./helpers";
import { OptimizationHelpModal } from "./OptimizationHelpModal";
import { OptimizationQualityContent } from "./OptimizationDefaultsCard";
import { OptimizationStrategiesContent } from "./OptimizationStrategiesCard";
import { OptimizationToolsContent } from "./OptimizationExternalToolsCard";
import { validateStrategy } from "./optimizationStrategyValidation";

type OptTab = "quality" | "rules" | "tools";

type OptimizationSectionProps = {
  draft: SettingsDraft;
  toolRuntime?: OptimizationToolRuntime[];
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  expandStrategies?: boolean;
  expandTools?: boolean;
  settingActions: (extraDisabled?: boolean) => ReactNode;
  onSave?: () => void;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onToggleTool?: (toolId: string, enabled: boolean) => void;
  onRefreshTools?: () => void;
};

export function OptimizationSection({
  draft,
  toolRuntime = [],
  settingsLoading,
  updatePending,
  updateError,
  expandStrategies,
  expandTools,
  settingActions,
  onSave,
  onUpdateDraft,
  onToggleTool,
  onRefreshTools,
}: OptimizationSectionProps) {
  const { t } = useTranslation();
  const disabled = settingsLoading || updatePending;
  const initialTab: OptTab = expandStrategies
    ? "rules"
    : expandTools
      ? "tools"
      : "quality";
  const [optTab, setOptTab] = useState<OptTab>(initialTab);
  const [helpOpen, setHelpOpen] = useState(false);

  const strategyErrors = new Map(
    draft.optimizationStrategies.map((strategy) => [
      strategy.id,
      validateStrategy(strategy, t),
    ]),
  );
  const hasStrategyErrors = Array.from(strategyErrors.values()).some(
    (errors) => Object.keys(errors).length > 0,
  );

  const helpKind =
    optTab === "rules"
      ? ("strategies" as const)
      : optTab === "tools"
        ? ("tools" as const)
        : null;

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-3 border-b border-g-line px-6 py-2.5 md:px-8">
          <span className="shrink-0 text-g-ink-3">
            {sectionIcon("optimization")}
          </span>
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.optimization")}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Tabs
              value={optTab}
              items={[
                {
                  value: "quality" as const,
                  label: t("settings.optTabQuality"),
                  icon: <SlidersHorizontal />,
                },
                {
                  value: "rules" as const,
                  label: t("settings.optTabRules"),
                  icon: <ListChecks />,
                },
                {
                  value: "tools" as const,
                  label: t("settings.optTabTools"),
                  icon: <Wrench />,
                },
              ]}
              onChange={setOptTab}
              ariaLabel="Optimization settings tab"
              variant="segment"
              size="sm"
            />
            {helpKind && (
              <IconButton
                size="sm"
                aria-label={t(
                  optTab === "rules"
                    ? "settings.optimizationStrategiesHelp"
                    : "settings.externalToolsHelp",
                )}
                onClick={() => setHelpOpen(true)}
              >
                <Info size={15} />
              </IconButton>
            )}
          </div>
        </div>

        <div className="px-6 py-2 md:px-8 md:py-3">
          {optTab === "quality" && (
            <OptimizationQualityContent
              draft={draft}
              settingsLoading={settingsLoading}
              updatePending={updatePending}
              updateError={updateError}
              settingActions={settingActions(hasStrategyErrors)}
              onUpdateDraft={onUpdateDraft}
            />
          )}
          {optTab === "rules" && (
            <OptimizationStrategiesContent
              draft={draft}
              disabled={disabled}
              hasStrategyErrors={hasStrategyErrors}
              strategyErrors={strategyErrors}
              onSave={onSave}
              saveDisabled={hasStrategyErrors}
              onUpdateDraft={onUpdateDraft}
            />
          )}
          {optTab === "tools" && (
            <OptimizationToolsContent
              draft={draft}
              toolRuntime={toolRuntime}
              disabled={disabled}
              onUpdateDraft={onUpdateDraft}
              onToggleTool={onToggleTool}
              onRefreshTools={onRefreshTools}
            />
          )}
        </div>
      </Card>

      {helpOpen && helpKind && (
        <OptimizationHelpModal
          kind={helpKind}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  );
}

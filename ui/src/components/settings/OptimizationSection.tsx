import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationToolRuntime } from "../../types";
import type { SettingsDraft } from "./types";
import { OptimizationDefaultsCard } from "./OptimizationDefaultsCard";
import { OptimizationExternalToolsCard } from "./OptimizationExternalToolsCard";
import { OptimizationStrategiesCard } from "./OptimizationStrategiesCard";
import { validateStrategy } from "./optimizationStrategyValidation";

type OptimizationSectionProps = {
  draft: SettingsDraft;
  toolRuntime?: OptimizationToolRuntime[];
  settingsLoading: boolean;
  updatePending: boolean;
  updateError: Error | null;
  expandStrategies?: boolean;
  expandTools?: boolean;
  settingActions: (extraDisabled?: boolean) => ReactNode;
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
  onUpdateDraft,
  onToggleTool,
  onRefreshTools,
}: OptimizationSectionProps) {
  const { t } = useTranslation();
  const disabled = settingsLoading || updatePending;
  const strategyErrors = new Map(
    draft.optimizationStrategies.map((strategy) => [
      strategy.id,
      validateStrategy(strategy, t),
    ]),
  );
  const hasStrategyErrors = Array.from(strategyErrors.values()).some(
    (errors) => Object.keys(errors).length > 0,
  );

  return (
    <>
      <OptimizationDefaultsCard
        draft={draft}
        settingsLoading={settingsLoading}
        updatePending={updatePending}
        updateError={updateError}
        settingActions={settingActions(hasStrategyErrors)}
        onUpdateDraft={onUpdateDraft}
      />
      <OptimizationStrategiesCard
        draft={draft}
        disabled={disabled}
        hasStrategyErrors={hasStrategyErrors}
        strategyErrors={strategyErrors}
        initialExpanded={expandStrategies}
        onUpdateDraft={onUpdateDraft}
      />
      <OptimizationExternalToolsCard
        draft={draft}
        toolRuntime={toolRuntime}
        disabled={disabled}
        initialExpanded={expandTools}
        onUpdateDraft={onUpdateDraft}
        onToggleTool={onToggleTool}
        onRefreshTools={onRefreshTools}
      />
    </>
  );
}

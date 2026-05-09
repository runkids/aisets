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
  settingActions: (extraDisabled?: boolean) => ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onRefreshTools?: () => void;
};

export function OptimizationSection({
  draft,
  toolRuntime = [],
  settingsLoading,
  updatePending,
  updateError,
  settingActions,
  onUpdateDraft,
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
        onUpdateDraft={onUpdateDraft}
      />
      <OptimizationExternalToolsCard
        draft={draft}
        toolRuntime={toolRuntime}
        disabled={disabled}
        onUpdateDraft={onUpdateDraft}
        onRefreshTools={onRefreshTools}
      />
    </>
  );
}

import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationStrategy } from "@/types";
import type { SettingsDraft } from "./types";
import { Button, Modal, Notice } from "@/components/ui";
import { defaultOptimizationStrategies } from "./constants";
import { OptimizationStrategyRow } from "./OptimizationStrategyRow";
import type { StrategyFieldErrors } from "./optimizationStrategyValidation";

type OptimizationStrategiesContentProps = {
  draft: SettingsDraft;
  disabled: boolean;
  hasStrategyErrors: boolean;
  strategyErrors: Map<string, StrategyFieldErrors>;
  onSave?: () => void;
  saveDisabled?: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationStrategiesContent({
  draft,
  disabled,
  hasStrategyErrors,
  strategyErrors,
  onSave,
  saveDisabled,
  onUpdateDraft,
}: OptimizationStrategiesContentProps) {
  const { t } = useTranslation();
  const [strategyPendingDelete, setStrategyPendingDelete] =
    useState<OptimizationStrategy | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  function updateStrategy(
    id: string,
    updater: (strategy: OptimizationStrategy) => OptimizationStrategy,
  ) {
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationStrategies: prev.optimizationStrategies.map((strategy) =>
        strategy.id === id ? updater(strategy) : strategy,
      ),
    }));
  }

  function addStrategy() {
    const id = `custom-${Date.now().toString(36)}`;
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationStrategies: [
        ...prev.optimizationStrategies,
        {
          id,
          name: "Custom strategy",
          enabled: true,
          priority:
            Math.max(0, ...prev.optimizationStrategies.map((s) => s.priority)) +
            10,
          match: { formats: ["png"], alpha: "any", animated: "any" },
          action: { operation: "convert", outputFormat: "webp", quality: 80 },
        },
      ],
    }));
  }

  function removeStrategy(id: string) {
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationStrategies: prev.optimizationStrategies.filter(
        (strategy) => strategy.id !== id,
      ),
    }));
  }

  function confirmRemoveStrategy() {
    if (!strategyPendingDelete) return;
    removeStrategy(strategyPendingDelete.id);
    setStrategyPendingDelete(null);
  }

  function resetStrategies() {
    setResetConfirmOpen(false);
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationStrategies: defaultOptimizationStrategies,
    }));
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
          {t("settings.strategiesInlineHelp", {
            defaultValue:
              "Each strategy is a rule: images matching the conditions are processed by the action. Lower priority values are checked first — the first match wins.",
          })}
        </p>
        {hasStrategyErrors && (
          <Notice tone="warning" title={t("settings.strategyValidationTitle")}>
            {t("settings.strategyValidationHint")}
          </Notice>
        )}
        {draft.optimizationStrategies.map((strategy) => (
          <OptimizationStrategyRow
            key={strategy.id}
            strategy={strategy}
            disabled={disabled}
            errors={strategyErrors.get(strategy.id) ?? {}}
            onChange={(updater) => updateStrategy(strategy.id, updater)}
            onDelete={() => setStrategyPendingDelete(strategy)}
          />
        ))}
        <div className="flex gap-2 border-t border-g-line py-4">
          <Button
            size="md"
            variant="primary"
            leadingIcon={<Plus size={14} />}
            disabled={disabled}
            onClick={addStrategy}
          >
            {t("settings.addStrategy")}
          </Button>
          {onSave && (
            <Button
              size="md"
              variant="primary"
              disabled={disabled || saveDisabled}
              onClick={onSave}
            >
              {t("settings.save")}
            </Button>
          )}
          <Button
            size="md"
            variant="ghost"
            disabled={disabled}
            onClick={() => setResetConfirmOpen(true)}
          >
            {t("settings.resetDefaults")}
          </Button>
        </div>
      </div>

      {strategyPendingDelete && (
        <Modal
          title={t("settings.removeStrategyConfirmTitle")}
          description={t("settings.removeStrategyConfirmDesc")}
          size="sm"
          onClose={() => setStrategyPendingDelete(null)}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setStrategyPendingDelete(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={confirmRemoveStrategy}>
                {t("action.delete")}
              </Button>
            </>
          }
        >
          <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
            {t("settings.removeStrategyConfirmBody")}{" "}
            <span className="font-[590] text-g-ink">
              {strategyPendingDelete.name}
            </span>
          </p>
        </Modal>
      )}
      {resetConfirmOpen && (
        <Modal
          title={t("settings.resetStrategiesConfirmTitle")}
          description={t("settings.resetStrategiesConfirmDesc")}
          size="sm"
          onClose={() => setResetConfirmOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setResetConfirmOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={resetStrategies}>
                {t("settings.reset")}
              </Button>
            </>
          }
        >
          <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
            {t("settings.resetStrategiesConfirmBody")}
          </p>
        </Modal>
      )}
    </>
  );
}

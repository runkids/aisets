import { ChevronDown, Info, ListChecks, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import type { OptimizationStrategy } from "../../types";
import type { SettingsDraft } from "./types";
import { Badge, Button, Card, IconButton, Modal, Notice } from "../ui";
import { defaultOptimizationStrategies } from "./constants";
import { OptimizationHelpModal } from "./OptimizationHelpModal";
import { OptimizationStrategyRow } from "./OptimizationStrategyRow";
import type { StrategyFieldErrors } from "./optimizationStrategyValidation";

type OptimizationStrategiesCardProps = {
  draft: SettingsDraft;
  disabled: boolean;
  hasStrategyErrors: boolean;
  strategyErrors: Map<string, StrategyFieldErrors>;
  initialExpanded?: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

export function OptimizationStrategiesCard({
  draft,
  disabled,
  hasStrategyErrors,
  strategyErrors,
  initialExpanded = false,
  onSave,
  saveDisabled,
  onUpdateDraft,
}: OptimizationStrategiesCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initialExpanded);
  const [helpOpen, setHelpOpen] = useState(false);
  const [strategyPendingDelete, setStrategyPendingDelete] =
    useState<OptimizationStrategy | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && initialExpanded) {
        requestAnimationFrame(() =>
          node.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    },
    [initialExpanded],
  );

  const enabledCount = draft.optimizationStrategies.filter(
    (s) => s.enabled,
  ).length;
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
      <div ref={scrollRef} />
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
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
            >
              <ListChecks size={15} className="shrink-0 text-g-ink-3" />
              <span className="min-w-0 flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                {t("settings.optimizationStrategiesHeading")}
              </span>
              <ChevronDown
                size={14}
                className={cn(
                  "shrink-0 text-g-ink-4 transition-transform duration-200 ease-g",
                  expanded && "rotate-180",
                )}
              />
            </button>
            <IconButton
              size="sm"
              aria-label={t("settings.optimizationStrategiesHelp")}
              onClick={() => setHelpOpen(true)}
            >
              <Info size={15} />
            </IconButton>
          </div>
          {!expanded && (
            <div className="mt-2 space-y-2">
              <p className="max-w-[56ch] font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.strategiesCollapsedDesc", {
                  defaultValue:
                    "Rules that decide how each image format is converted, recompressed, or resized. Strategies are checked by priority — the first match applies.",
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="default">
                  {t("settings.strategiesBadgeTotal", {
                    defaultValue: "{{count}} strategies",
                    count: draft.optimizationStrategies.length,
                  })}
                </Badge>
                <Badge tone={enabledCount > 0 ? "green" : "default"}>
                  {t("settings.strategiesBadgeEnabled", {
                    defaultValue: "{{count}} enabled",
                    count: enabledCount,
                  })}
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
            <div className="flex flex-col gap-3 px-6 py-3 md:px-8">
              <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.strategiesInlineHelp", {
                  defaultValue:
                    "Each strategy is a rule: images matching the conditions are processed by the action. Lower priority values are checked first — the first match wins.",
                })}
              </p>
              {hasStrategyErrors && (
                <Notice
                  tone="warning"
                  title={t("settings.strategyValidationTitle")}
                >
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
          </div>
        </div>
      </Card>
      {helpOpen && (
        <OptimizationHelpModal
          kind="strategies"
          onClose={() => setHelpOpen(false)}
        />
      )}
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

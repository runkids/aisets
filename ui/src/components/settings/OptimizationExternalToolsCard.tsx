import { ChevronDown, Info, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import type { OptimizationToolRuntime } from "../../types";
import type { SettingsDraft } from "./types";
import { Badge, Button, Card, IconButton, Modal, Switch } from "../ui";
import { FieldRow } from "./FieldRow";
import { defaultOptimizationExternalTools } from "./constants";
import { OptimizationHelpModal } from "./OptimizationHelpModal";

type OptimizationExternalToolsCardProps = {
  draft: SettingsDraft;
  toolRuntime: OptimizationToolRuntime[];
  disabled: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onRefreshTools?: () => void;
};

export function OptimizationExternalToolsCard({
  draft,
  toolRuntime,
  disabled,
  onUpdateDraft,
  onRefreshTools,
}: OptimizationExternalToolsCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const runtimeByID = new Map(toolRuntime.map((tool) => [tool.id, tool]));

  const detectedCount = toolRuntime.filter((rt) => rt.detected).length;
  const enabledToolCount = draft.optimizationExternalTools.filter(
    (t) => t.enabled,
  ).length;
  function resetTools() {
    setResetConfirmOpen(false);
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationExternalTools: defaultOptimizationExternalTools,
    }));
  }

  return (
    <>
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
              <Wrench size={15} className="shrink-0 text-g-ink-3" />
              <span className="min-w-0 flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                {t("settings.externalToolsHeading")}
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
              aria-label={t("settings.externalToolsHelp")}
              onClick={() => setHelpOpen(true)}
            >
              <Info size={15} />
            </IconButton>
          </div>
          {!expanded && (
            <div className="mt-2 space-y-2">
              <p className="max-w-[56ch] font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.externalToolsCollapsedDesc", {
                  defaultValue:
                    "Optional CLI tools that supplement the built-in optimizer. Detected tools must be explicitly enabled before use.",
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={detectedCount > 0 ? "green" : "default"}>
                  {t("settings.toolsBadgeDetected", {
                    defaultValue: "{{count}}/{{total}} detected",
                    count: detectedCount,
                    total: toolRuntime.length,
                  })}
                </Badge>
                <Badge tone={enabledToolCount > 0 ? "green" : "default"}>
                  {t("settings.toolsBadgeEnabled", {
                    defaultValue: "{{count}} enabled",
                    count: enabledToolCount,
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
            <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
              {draft.optimizationExternalTools.map((tool) => {
                const runtime = runtimeByID.get(tool.id);
                const purpose = t(`settings.toolPurpose.${tool.id}`, {
                  defaultValue: "",
                });
                const desc = [
                  purpose,
                  runtime?.path || t("settings.toolNotDetected"),
                ]
                  .filter(Boolean)
                  .join(" — ");
                return (
                  <FieldRow key={tool.id} label={tool.id} description={desc}>
                    <div className="flex items-center gap-2">
                      <Badge tone={runtime?.detected ? "green" : "default"}>
                        {runtime?.detected
                          ? t("settings.toolDetected")
                          : t("settings.toolMissing")}
                      </Badge>
                      <Switch
                        checked={tool.enabled}
                        disabled={disabled || !runtime?.detected}
                        aria-label={tool.id}
                        onCheckedChange={(next) =>
                          onUpdateDraft((prev) => ({
                            ...prev,
                            optimizationExternalTools:
                              prev.optimizationExternalTools.map((item) =>
                                item.id === tool.id
                                  ? { ...item, enabled: next }
                                  : item,
                              ),
                          }))
                        }
                      />
                    </div>
                  </FieldRow>
                );
              })}
              <div className="flex gap-2 py-4">
                <Button
                  size="md"
                  variant="primary"
                  disabled={disabled}
                  onClick={onRefreshTools}
                >
                  {t("settings.refreshTools")}
                </Button>
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
          kind="tools"
          onClose={() => setHelpOpen(false)}
        />
      )}
      {resetConfirmOpen && (
        <Modal
          title={t("settings.resetExternalToolsConfirmTitle")}
          description={t("settings.resetExternalToolsConfirmDesc")}
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
              <Button variant="danger" onClick={resetTools}>
                {t("settings.reset")}
              </Button>
            </>
          }
        >
          <p className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
            {t("settings.resetExternalToolsConfirmBody")}
          </p>
        </Modal>
      )}
    </>
  );
}

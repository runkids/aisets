import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationToolRuntime } from "../../types";
import type { SettingsDraft } from "./types";
import { Badge, Button, Modal, Switch } from "../ui";
import { FieldRow } from "./FieldRow";
import { defaultOptimizationExternalTools } from "./constants";

type OptimizationToolsContentProps = {
  draft: SettingsDraft;
  toolRuntime: OptimizationToolRuntime[];
  disabled: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onToggleTool?: (toolId: string, enabled: boolean) => void;
  onRefreshTools?: () => void;
};

export function OptimizationToolsContent({
  draft,
  toolRuntime,
  disabled,
  onUpdateDraft,
  onToggleTool,
  onRefreshTools,
}: OptimizationToolsContentProps) {
  const { t } = useTranslation();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const runtimeByID = new Map(toolRuntime.map((tool) => [tool.id, tool]));

  function resetTools() {
    setResetConfirmOpen(false);
    onUpdateDraft((prev) => ({
      ...prev,
      optimizationExternalTools: defaultOptimizationExternalTools,
    }));
  }

  return (
    <>
      <div className="divide-y divide-g-line">
        {draft.optimizationExternalTools.map((tool) => {
          const runtime = runtimeByID.get(tool.id);
          const purpose = t(`settings.toolPurpose.${tool.id}`, {
            defaultValue: "",
          });
          const desc = [purpose, runtime?.path || t("settings.toolNotDetected")]
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
                  onCheckedChange={(next) => {
                    onUpdateDraft((prev) => ({
                      ...prev,
                      optimizationExternalTools:
                        prev.optimizationExternalTools.map((item) =>
                          item.id === tool.id
                            ? { ...item, enabled: next }
                            : item,
                        ),
                    }));
                    onToggleTool?.(tool.id, next);
                  }}
                />
              </div>
            </FieldRow>
          );
        })}
        <div className="flex gap-2 border-t border-g-line pt-4">
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

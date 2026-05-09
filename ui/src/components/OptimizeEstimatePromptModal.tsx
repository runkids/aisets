import { LoaderCircle, Sliders } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Modal, Notice } from "./ui";

type Props = {
  ids: string[];
  working: "estimate" | "preview" | "apply" | "script" | null;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
};

export function OptimizeEstimatePromptModal({
  ids,
  working,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      title={t("optimize.estimatePromptTitle")}
      description={t("optimize.estimatePromptSubtitle", {
        count: ids.length,
        defaultValue: "{{count}} assets need estimation before preview",
      })}
      size="sm"
      onClose={() => {
        if (working == null) onClose();
      }}
      footer={
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={working != null}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(ids)}
            disabled={working != null}
            leadingIcon={
              working === "estimate" || working === "preview" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Sliders size={14} />
              )
            }
          >
            {working === "estimate"
              ? t("optimize.estimating")
              : working === "preview"
                ? t("optimize.optimizing")
                : t("optimize.estimateThenPreview")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="inline-flex items-center gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-4 py-2.5">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-g-ink font-g-mono text-[10px] font-[600] text-g-canvas">
            1
          </span>
          <span className="text-g-body font-[590] text-g-ink">
            {t("optimize.estimate")}
          </span>
          <span className="text-g-ink-4">→</span>
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-g-ink font-g-mono text-[10px] font-[600] text-g-canvas">
            2
          </span>
          <span className="text-g-body font-[590] text-g-ink">
            {t("optimize.preview")}
          </span>
        </div>

        <Notice tone="info">
          {t("optimize.estimatePromptInfo", {
            count: ids.length,
            defaultValue:
              "We'll estimate {{count}} assets first, then continue to preview automatically. Selection is locked during this process.",
          })}
        </Notice>
      </div>
    </Modal>
  );
}

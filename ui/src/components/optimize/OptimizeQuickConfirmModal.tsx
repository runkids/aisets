import { Zap } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../ui";
import type { AssetItem } from "../../types";
import type { OptimizationOperation } from "./optimizeTypes";
import { operationFor, operationLabels } from "./optimizeTypes";
import { Badge, Button, Modal, Notice } from "../ui";

type Props = {
  ids: string[];
  itemsById: Map<string, AssetItem>;
  estimatedOperationsByAsset: Map<string, OptimizationOperation>;
  replaceOriginal: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
};

export function OptimizeQuickConfirmModal({
  ids,
  itemsById,
  estimatedOperationsByAsset,
  replaceOriginal,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const operationLabel = (id: string) =>
    t(`optimize.operationLabel.${id}`, {
      defaultValue: operationLabels[id] ?? id,
    });

  const stats = useMemo(() => {
    const qBefore = ids.reduce(
      (s, id) => s + (itemsById.get(id)?.bytes ?? 0),
      0,
    );
    const qOps = ids
      .map((id) => estimatedOperationsByAsset.get(id))
      .filter(Boolean) as OptimizationOperation[];
    const qHasEstimate = qOps.length > 0;
    const qAfter = qHasEstimate
      ? qOps.reduce((s, o) => s + o.estimatedBytes, 0)
      : 0;
    const qSavings = qHasEstimate ? qBefore - qAfter : 0;
    const qPct =
      qHasEstimate && qBefore > 0 ? Math.round((qSavings / qBefore) * 100) : 0;
    const opCounts = new Map<string, number>();
    for (const id of ids) {
      const o = estimatedOperationsByAsset.get(id);
      const it = itemsById.get(id);
      const opKey = (o?.operation ?? (it ? operationFor(it) : "")) || "unknown";
      opCounts.set(opKey, (opCounts.get(opKey) ?? 0) + 1);
    }
    return { qBefore, qHasEstimate, qAfter, qSavings, qPct, opCounts };
  }, [ids, itemsById, estimatedOperationsByAsset]);

  return (
    <Modal
      title={t("optimize.quickOptimizeTitle")}
      description={t("optimize.quickOptimizeSubtitle", {
        count: ids.length,
        defaultValue:
          "{{count}} assets · estimate, preview, then apply in one flow",
      })}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="hidden text-g-caption text-g-ink-4 sm:block">
            {t("optimize.keyboardHint", {
              defaultValue: "⌘ Enter to confirm · Esc to cancel",
            })}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              leadingIcon={<Zap size={14} />}
              onClick={() => onConfirm(ids)}
            >
              {t("optimize.quickOptimizeConfirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-5 rounded-g-md border border-g-line bg-g-surface-2 px-5 py-4">
          <div>
            <div className="font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
              {t("optimize.before", { defaultValue: "Before" })}
            </div>
            <div className="mt-1.5 font-g-mono text-[26px] font-[590] leading-none tracking-[-0.02em] text-g-ink">
              {formatBytes(stats.qBefore)}
            </div>
          </div>
          <div className="grid size-8 place-items-center rounded-full bg-g-surface-3 text-g-ink-3">
            <span className="text-[13px]">→</span>
          </div>
          <div>
            <div className="font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
              {t("optimize.afterEstimated", {
                defaultValue: "After (estimated)",
              })}
            </div>
            {stats.qHasEstimate ? (
              <>
                <div className="mt-1.5 font-g-mono text-[26px] font-[590] leading-none tracking-[-0.02em] text-g-ink">
                  {formatBytes(stats.qAfter)}
                </div>
                {stats.qSavings > 0 && (
                  <div className="mt-1.5 font-g-mono text-g-ui font-[510] text-g-green">
                    −{formatBytes(stats.qSavings)} ({stats.qPct}%)
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1.5 text-g-body leading-snug text-g-ink-3">
                {t("optimize.afterNeedsEstimate", {
                  defaultValue: "Run estimate first to see projected size",
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-6">
          <div>
            <div className="mb-2 font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
              {t("optimize.operations", { defaultValue: "Operations" })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...stats.opCounts.entries()].map(([opKey, count]) => (
                <Badge key={opKey} tone="line">
                  {operationLabel(opKey)}{" "}
                  <span className="ml-1 font-g-mono text-g-ink-4">{count}</span>
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
              {t("optimize.whatRuns", { defaultValue: "What runs" })}
            </div>
            <div className="space-y-2">
              {[
                {
                  step: 1,
                  title: t("optimize.estimate"),
                  desc: t("optimize.quickStep1"),
                },
                {
                  step: 2,
                  title: t("optimize.preview"),
                  desc: t("optimize.quickStep2"),
                },
                {
                  step: 3,
                  title: t("optimize.applyStep", { defaultValue: "Apply" }),
                  desc: t("optimize.quickStep3"),
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex items-start gap-2.5">
                  <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-g-ink font-g-mono text-[10px] font-[600] text-g-canvas">
                    {step}
                  </span>
                  <div className="min-w-0">
                    <div className="text-g-body font-[590] text-g-ink">
                      {title}
                    </div>
                    <div className="text-g-caption text-g-ink-3">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {replaceOriginal && (
          <Notice tone="warning">
            <div className="font-[590]">
              {t("optimize.replaceMode", { defaultValue: "Replace mode" })}
            </div>
            <div className="mt-0.5">{t("optimize.quickRiskReplace")}</div>
          </Notice>
        )}
      </div>
    </Modal>
  );
}

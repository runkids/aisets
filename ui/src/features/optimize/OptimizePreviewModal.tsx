import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fileName, formatBytes } from "@/ui";
import type { AssetItem } from "@/types";
import type { OptimizationOperation, PreviewBatch } from "./optimizeTypes";
import { formatBadgeBg, operationLabels } from "./optimizeTypes";
import { AssetThumbnail, Badge, Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";

type Props = {
  preview: PreviewBatch;
  itemsById: Map<string, AssetItem>;
  replaceOriginal: boolean;
  working: string | null;
  onClose: () => void;
  onApply: () => void;
};

export function OptimizePreviewModal({
  preview,
  itemsById,
  replaceOriginal,
  working,
  onClose,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const previewChanges = preview.preview.changes ?? [];
  const operations: OptimizationOperation[] =
    preview.preview.payload?.optimization?.operations ?? [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectedOp = operations[selectedIndex];
  const selectedItem = selectedOp
    ? itemsById.get(selectedOp.assetId)
    : undefined;

  const totalSavings = operations.reduce((s, op) => s + op.savingsBytes, 0);
  const totalBytes = operations.reduce((s, op) => s + op.currentBytes, 0);
  const totalPct =
    totalBytes > 0 ? Math.round((totalSavings / totalBytes) * 100) : 0;
  const applyCount = operations.filter((op) => op.canApply).length;

  return (
    <Modal
      title={t("optimize.previewTitle")}
      description={`${operations.length} ${t("asset.assets", { count: operations.length })} · ${t("optimize.previewSaves", { savings: formatBytes(totalSavings), pct: totalPct, defaultValue: "saves {{savings}} ({{pct}}%)" })}`}
      onClose={onClose}
      size="lg"
      className="max-w-[1200px] h-[min(86vh,760px)]"
      bodyPadding="none"
      bodyClassName="overflow-hidden flex flex-col"
      footer={
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={onApply}
            disabled={!preview.preview.canApply || working === "apply"}
            leadingIcon={
              working === "apply" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )
            }
          >
            {working === "apply"
              ? t("action.applying")
              : t("optimize.applyTo", {
                  count: applyCount,
                  defaultValue: "Apply to {{count}}",
                })}
          </Button>
        </div>
      }
    >
      {/* Tags bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-g-line px-5 py-2">
        {replaceOriginal && (
          <Badge tone="red">
            {t("optimize.replaceOriginals", {
              defaultValue: "Replace originals",
            })}
          </Badge>
        )}
        {previewChanges.length > 0 && (
          <Badge tone="line">
            {t("optimize.refsUpdatedBadge", {
              count: previewChanges.length,
              defaultValue: "{{count}} refs updated",
            })}
          </Badge>
        )}
        <span className="text-g-caption text-g-ink-3">
          {replaceOriginal
            ? t("optimize.overwrittenInPlace", {
                defaultValue: "Originals overwritten in place",
              })
            : t("optimize.safeVariantModeDesc")}
        </span>
      </div>

      {/* Split layout */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="w-[280px] shrink-0 overflow-y-auto border-r border-g-line">
          {operations.map((op, idx) => {
            const item = itemsById.get(op.assetId);
            const isActive = idx === selectedIndex;
            const ext = op.repoPath.split(".").pop()?.toLowerCase() ?? "";
            return (
              <button
                key={`${op.assetId}-${op.operation}`}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-g-line px-3 py-2.5 text-left transition-colors duration-100",
                  isActive
                    ? "bg-g-surface-2 shadow-[inset_3px_0_0_var(--g-accent)]"
                    : "hover:bg-g-surface-2",
                )}
                onClick={() => setSelectedIndex(idx)}
              >
                <div className="relative shrink-0">
                  <AssetThumbnail
                    src={item?.thumbnailUrl || item?.url || ""}
                    size="sm"
                    className="size-10 rounded-g-sm"
                  />
                  <span
                    className={cn(
                      "absolute bottom-0 left-0 rounded-[2px] px-0.5 py-px text-[8px] font-[600] uppercase leading-[1.1] text-white",
                      formatBadgeBg[ext] ?? "bg-g-ink-4",
                    )}
                  >
                    {ext.toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-g-mono text-g-ui font-medium text-g-ink">
                    {fileName(op.repoPath)}
                  </div>
                  <div className="font-g-mono text-g-chip">
                    {op.savingsBytes > 0 && op.currentBytes > 0 ? (
                      <span className="text-g-green">
                        −{Math.round((op.savingsBytes / op.currentBytes) * 100)}
                        % {formatBytes(op.savingsBytes)}
                      </span>
                    ) : (
                      <span className="text-g-ink-4">
                        {t("optimize.noEffectiveSavings")}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {selectedOp && (
            <div className="space-y-5">
              {/* File name + path */}
              <div>
                <h3 className="font-g-display text-[16px] font-[590] text-g-ink">
                  {fileName(selectedOp.repoPath)}
                </h3>
                <div className="mt-0.5 font-g-mono text-g-caption text-g-ink-4">
                  {selectedItem?.projectName
                    ? `${selectedItem.projectName} / ${selectedOp.repoPath}`
                    : selectedOp.repoPath}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-g-md border border-g-line bg-g-line">
                <div className="bg-g-surface-2 p-4">
                  <div className="font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
                    {t("optimize.original", { defaultValue: "Original" })}
                  </div>
                  <div className="mt-1 font-g-mono text-[20px] font-[590] text-g-ink">
                    {formatBytes(selectedOp.currentBytes)}
                  </div>
                </div>
                <div className="bg-g-surface-2 p-4">
                  <div className="font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
                    {t("optimize.estimated", { defaultValue: "Estimated" })}
                  </div>
                  <div className="mt-1 font-g-mono text-[20px] font-[590] text-g-ink">
                    {formatBytes(selectedOp.estimatedBytes)}
                  </div>
                </div>
                <div className="bg-g-surface-2 p-4">
                  <div className="font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
                    {t("optimize.statSavings")}
                  </div>
                  <div className="mt-1 font-g-mono text-[20px] font-[590] text-g-green">
                    −{formatBytes(selectedOp.savingsBytes)}
                  </div>
                  {selectedOp.currentBytes > 0 && (
                    <div className="font-g-mono text-g-caption text-g-green">
                      {Math.round(
                        (selectedOp.savingsBytes / selectedOp.currentBytes) *
                          100,
                      )}
                      %
                    </div>
                  )}
                </div>
              </div>

              {/* Before / After comparison */}
              <div className="grid grid-cols-2 gap-3">
                {/* Before card */}
                <div className="overflow-hidden rounded-g-md border border-g-line">
                  <div className="flex items-center justify-between bg-g-surface-3 px-3 py-2">
                    <span className="font-g-mono text-g-chip uppercase tracking-[0.06em] text-g-ink-3">
                      {t("optimize.before", { defaultValue: "Before" })}
                    </span>
                    <span className="font-g-mono text-g-ui text-g-ink">
                      {formatBytes(selectedOp.currentBytes)}
                    </span>
                  </div>
                  <div className="grid aspect-video place-items-center bg-g-surface-2">
                    <AssetThumbnail
                      src={
                        selectedItem?.thumbnailUrl || selectedItem?.url || ""
                      }
                      size="fill"
                      className="h-full w-full rounded-none border-0"
                    />
                  </div>
                  <div className="bg-g-surface-3 px-3 py-1.5">
                    <span className="font-g-mono text-g-chip text-g-ink-4">
                      {selectedOp.repoPath.split(".").pop()?.toUpperCase()}{" "}
                      {selectedItem?.image.width}×{selectedItem?.image.height}
                    </span>
                  </div>
                </div>

                {/* After card */}
                <div className="overflow-hidden rounded-g-md border border-g-line">
                  <div className="flex items-center justify-between bg-g-ink px-3 py-2">
                    <span className="font-g-mono text-g-chip uppercase tracking-[0.06em] text-g-canvas">
                      {t("optimize.after", { defaultValue: "After" })}
                    </span>
                    <span className="font-g-mono text-g-ui text-g-canvas">
                      {formatBytes(selectedOp.estimatedBytes)}
                    </span>
                  </div>
                  <div className="grid aspect-video place-items-center bg-g-surface-2">
                    <AssetThumbnail
                      src={
                        selectedItem?.thumbnailUrl || selectedItem?.url || ""
                      }
                      size="fill"
                      className="h-full w-full rounded-none border-0"
                    />
                  </div>
                  <div className="bg-g-ink px-3 py-1.5">
                    <span className="font-g-mono text-g-chip text-g-canvas/60">
                      {operationLabels[selectedOp.operation]?.toUpperCase() ??
                        selectedOp.operation.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Operation details table */}
              <div>
                <div className="mb-2 font-g-mono text-g-chip uppercase tracking-[0.08em] text-g-ink-4">
                  {t("optimize.operation")}
                </div>
                <div className="overflow-hidden rounded-g-md border border-g-line">
                  {[
                    {
                      label: t("optimize.pipeline", {
                        defaultValue: "Pipeline",
                      }),
                      value: selectedOp.operation,
                    },
                    {
                      label: t("optimize.source", { defaultValue: "Source" }),
                      value: `${selectedOp.repoPath.split(".").pop()?.toUpperCase()} · ${selectedItem?.image.width}×${selectedItem?.image.height} · ${formatBytes(selectedOp.currentBytes)}`,
                    },
                    {
                      label: t("optimize.target", { defaultValue: "Target" }),
                      value: `${(selectedOp.outputFormat || selectedOp.repoPath.split(".").pop() || "").toUpperCase()} · ${selectedItem?.image.width}×${selectedItem?.image.height} · ${formatBytes(selectedOp.estimatedBytes)}`,
                    },
                    ...(selectedOp.referenceEditCount
                      ? [
                          {
                            label: t("optimize.references", {
                              defaultValue: "References",
                            }),
                            value: t("optimize.referencesWillUpdate", {
                              count: selectedOp.referenceEditCount,
                              defaultValue:
                                "{{count}} reference · will be updated",
                            }),
                          },
                        ]
                      : []),
                  ].map((row, i) => (
                    <div
                      key={row.label}
                      className={cn(
                        "grid grid-cols-[120px_1fr] border-g-line",
                        i > 0 && "border-t",
                      )}
                    >
                      <div className="px-3 py-2.5 font-g-mono text-g-chip uppercase tracking-[0.06em] text-g-ink-4">
                        {row.label}
                      </div>
                      <div className="px-3 py-2.5 font-g-mono text-g-ui text-g-ink">
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Blocked warning */}
              {!selectedOp.canApply && selectedOp.blockedReason && (
                <Notice tone="warning">
                  {t(`optimize.blockedReason.${selectedOp.reasonCode}`, {
                    defaultValue: selectedOp.blockedReason,
                    tool: selectedOp.tool,
                  })}
                </Notice>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

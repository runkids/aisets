import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../ui";
import type { OptimizationOperation, PreviewBatch } from "./optimizeTypes";
import { AssetThumbnail, Badge, Button, Modal, Notice, Tooltip } from "./ui";

type Props = {
  preview: PreviewBatch;
  itemsById: Map<string, { thumbnailUrl?: string; url?: string }>;
  replaceOriginal: boolean;
  updateReferences: boolean;
  working: string | null;
  onClose: () => void;
  onApply: () => void;
};

export function OptimizePreviewModal({
  preview,
  itemsById,
  replaceOriginal,
  updateReferences,
  working,
  onClose,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const previewChanges = preview.preview.changes ?? [];
  const previewDeletes = preview.preview.deletes ?? [];
  const operations: OptimizationOperation[] =
    preview.preview.payload?.optimization?.operations ?? [];
  const blockedReasonLabel = (op: OptimizationOperation) =>
    t(`optimize.blockedReason.${op.reasonCode}`, {
      defaultValue: op.blockedReason || t("optimize.blocked"),
      tool: op.tool,
    });

  return (
    <Modal
      title={t("optimize.previewTitle")}
      onClose={onClose}
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
              ) : undefined
            }
          >
            {working === "apply"
              ? t("action.applying")
              : t("optimize.applyOptimization")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Notice
          tone={
            preview.preview.canApply && preview.preview.blockers.length === 0
              ? "success"
              : "warning"
          }
        >
          {preview.preview.canApply
            ? preview.preview.blockers.length > 0
              ? t("optimize.partialApplyDesc", {
                  count: preview.preview.blockers.length,
                })
              : t("preview.canApplyDesc")
            : t("preview.blockedDesc")}
        </Notice>
        <div className="grid gap-2 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-g-caption text-g-ink-3 sm:grid-cols-3">
          <div>
            <div className="font-[590] text-g-ink">
              {replaceOriginal
                ? t("optimize.replaceMode")
                : t("optimize.safeVariantMode")}
            </div>
            <div>
              {replaceOriginal
                ? t("optimize.replaceModeDesc")
                : t("optimize.safeVariantModeDesc")}
            </div>
          </div>
          <div>
            <div className="font-[590] text-g-ink">
              {t("optimize.referenceChanges", {
                count: previewChanges.length,
              })}
            </div>
            <div>
              {updateReferences && replaceOriginal
                ? t("optimize.referenceChangesDesc")
                : t("optimize.referenceChangesOffDesc")}
            </div>
          </div>
          <div>
            <div className="font-[590] text-g-ink">
              {t("optimize.deleteOriginals", {
                count: previewDeletes.length,
              })}
            </div>
            <div>{t("optimize.deleteOriginalsDesc")}</div>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-g-md border border-g-line">
          {operations.map((op) => (
            <div
              key={`${op.assetId}-${op.operation}`}
              className="grid grid-cols-[48px_minmax(0,1fr)_150px_120px] items-center gap-3 border-b border-g-line px-3 py-2 last:border-b-0"
            >
              <AssetThumbnail
                src={
                  itemsById.get(op.assetId)?.thumbnailUrl ||
                  itemsById.get(op.assetId)?.url ||
                  ""
                }
                size="md"
                className="size-12 rounded-g-md"
              />
              <div className="min-w-0">
                <Tooltip
                  label={op.repoPath}
                  placement="top"
                  contentClassName="max-w-[420px] whitespace-normal break-words"
                >
                  <span className="block truncate font-g-mono text-g-body text-g-ink">
                    {op.repoPath}
                  </span>
                </Tooltip>
                <Tooltip
                  label={op.targetPath}
                  placement="top"
                  contentClassName="max-w-[420px] whitespace-normal break-words"
                >
                  <span className="block truncate text-g-caption text-g-ink-4">
                    {op.targetPath}
                  </span>
                </Tooltip>
                {!op.canApply && op.blockedReason && (
                  <Tooltip
                    label={blockedReasonLabel(op)}
                    placement="top"
                    contentClassName="max-w-[420px] whitespace-normal break-words"
                  >
                    <span className="mt-1 block truncate text-g-caption text-g-amber">
                      {blockedReasonLabel(op)}
                    </span>
                  </Tooltip>
                )}
                {op.referenceEditCount ? (
                  <span className="mt-1 block text-g-caption text-g-ink-3">
                    {t("optimize.referenceEditCount", {
                      count: op.referenceEditCount,
                    })}
                  </span>
                ) : null}
              </div>
              <div>
                <div className="font-g-mono text-g-ui text-g-ink">
                  {formatBytes(op.currentBytes)} →{" "}
                  {formatBytes(op.estimatedBytes)}
                </div>
                {op.savingsBytes > 0 && op.currentBytes > 0 && (
                  <span className="font-g-mono text-g-chip text-g-green">
                    −{Math.round((op.savingsBytes / op.currentBytes) * 100)}%
                  </span>
                )}
              </div>
              <Badge tone={op.canApply ? "green" : "amber"}>
                {op.canApply ? t("optimize.ready") : t("optimize.blocked")}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

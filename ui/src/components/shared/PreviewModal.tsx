import { useTranslation } from "react-i18next";
import type { ActionPreview } from "../../types";
import { Button, Modal } from "../ui";

type Props = {
  preview: ActionPreview;
  working: boolean;
  onCancel: () => void;
  onApply: () => void;
};

export function PreviewModal({ preview, working, onCancel, onApply }: Props) {
  const { t } = useTranslation();
  const changes = preview.changes ?? [];
  const deletes = preview.deletes ?? [];
  const blockers = preview.blockers ?? [];

  return (
    <Modal
      title={t(`preview.type.${preview.type}`, {
        defaultValue: `${preview.type} preview`,
      })}
      description={
        preview.canApply ? t("preview.canApplyDesc") : t("preview.blockedDesc")
      }
      onClose={onCancel}
      footer={
        <>
          <div className="text-g-body text-g-ink-4">
            {t("preview.footerSummary", {
              changes: changes.length,
              deletes: deletes.length,
              defaultValue: "{{changes}} changes · {{deletes}} deletes",
            })}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!preview.canApply || working}
              onClick={onApply}
            >
              {t("preview.apply")}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-2 font-g-mono text-g-caption break-all">
        {changes.map((change) => (
          <div key={`${change.file}:${change.line}:${change.oldSpecifier}`}>
            <code>
              {change.file}:{change.line}
            </code>{" "}
            {change.oldSpecifier} → {change.newSpecifier}
          </div>
        ))}
        {deletes.map((path) => (
          <div key={path}>
            {t("preview.deleteLabel", { defaultValue: "Delete" })}{" "}
            <code>{path}</code>
          </div>
        ))}
        {blockers.map((blocker) => (
          <div
            className="text-g-red"
            key={`${blocker.file}:${blocker.line}:${blocker.code}`}
          >
            <code>
              {blocker.file}:{blocker.line}
            </code>{" "}
            {blocker.reason}
          </div>
        ))}
        {changes.length === 0 &&
          deletes.length === 0 &&
          blockers.length === 0 && (
            <div className="text-g-ink-4">{t("preview.noChanges")}</div>
          )}
      </div>
    </Modal>
  );
}

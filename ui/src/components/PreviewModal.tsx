import { useTranslation } from "react-i18next";
import type { ActionPreview } from "../types";
import { Button, Modal } from "./ui";

type Props = {
  preview: ActionPreview;
  working: boolean;
  onCancel: () => void;
  onApply: () => void;
};

export function PreviewModal({ preview, working, onCancel, onApply }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      title={`${preview.type} preview`}
      description={
        preview.canApply ? t("preview.canApplyDesc") : t("preview.blockedDesc")
      }
      onClose={onCancel}
      footer={
        <>
          <div className="text-sm text-(--g-ink-4)">
            {preview.changes.length} changes · {preview.deletes.length} deletes
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
      <div className="preview-list">
        {preview.changes.map((change) => (
          <div key={`${change.file}:${change.line}:${change.oldSpecifier}`}>
            <code>
              {change.file}:{change.line}
            </code>{" "}
            {change.oldSpecifier} → {change.newSpecifier}
          </div>
        ))}
        {preview.deletes.map((path) => (
          <div key={path}>
            Delete <code>{path}</code>
          </div>
        ))}
        {preview.blockers.map((blocker) => (
          <div
            className="preview-blocker"
            key={`${blocker.file}:${blocker.line}:${blocker.code}`}
          >
            <code>
              {blocker.file}:{blocker.line}
            </code>{" "}
            {blocker.reason}
          </div>
        ))}
        {preview.changes.length === 0 &&
          preview.deletes.length === 0 &&
          preview.blockers.length === 0 && (
            <div className="text-(--g-ink-4)">{t("preview.noChanges")}</div>
          )}
      </div>
    </Modal>
  );
}

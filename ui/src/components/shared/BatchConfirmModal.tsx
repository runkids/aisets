import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";

type Props = {
  count: number;
  sizeLabel: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BatchConfirmModal({
  count,
  sizeLabel,
  working,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("action.batchDeleteConfirmTitle", { count })}
      onClose={onCancel}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-g-md px-3 text-[13px] font-[510] text-g-ink-2 hover:bg-g-surface-2"
            onClick={onCancel}
            disabled={working}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-g-md bg-g-red px-3 text-[13px] font-[510] text-g-canvas hover:brightness-[1.08] disabled:opacity-50"
            onClick={onConfirm}
            disabled={working}
          >
            {t("action.deleteSelected")}
          </button>
        </div>
      }
    >
      <p className="text-[13px] text-g-ink-2">
        {t("action.batchDeleteConfirmBody", { count, size: sizeLabel })}
      </p>
    </Modal>
  );
}

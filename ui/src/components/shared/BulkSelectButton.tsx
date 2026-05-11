import { CheckSquare } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useBulkEscape } from "../../hooks/useBulkEscape";
import { Button } from "../ui";

type BulkSelectButtonProps = {
  bulkMode: boolean;
  allSelected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onCancel: () => void;
  locked?: boolean;
  className?: string;
};

export function BulkSelectButton({
  bulkMode,
  allSelected,
  disabled,
  onToggle,
  onCancel,
  locked,
  className,
}: BulkSelectButtonProps) {
  const { t } = useTranslation();

  const cancel = useCallback(() => onCancel(), [onCancel]);
  useBulkEscape(bulkMode, cancel, locked);

  return (
    <Button
      variant={bulkMode ? "primary" : "secondary"}
      size="md"
      leadingIcon={<CheckSquare size={14} />}
      trailingIcon={
        bulkMode ? (
          <kbd className="inline-flex items-center rounded-[3px] border border-white/20 px-1 font-g-mono text-[9px] leading-[1.1] font-[510] opacity-70">
            esc
          </kbd>
        ) : undefined
      }
      onClick={onToggle}
      disabled={disabled}
      className={className}
    >
      {!bulkMode
        ? t("toolbar.bulkSelect")
        : allSelected
          ? t("common.cancel")
          : t("action.selectAll")}
    </Button>
  );
}

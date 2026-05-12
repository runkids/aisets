import { CheckSquare } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBulkEscape } from "../../hooks/useBulkEscape";
import { Button, Keycap } from "../ui";

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

  useEffect(() => {
    if (disabled || locked) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!event.ctrlKey || event.metaKey || event.altKey) return;
      const normalizedKey =
        typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (event.code !== "KeyQ" && normalizedKey !== "q") return;

      const target =
        event.target instanceof Element ? event.target : document.activeElement;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("[role='dialog']"))
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onToggle();
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [disabled, locked, onToggle]);

  return (
    <Button
      variant={bulkMode ? "primary" : "secondary"}
      size="md"
      leadingIcon={<CheckSquare size={14} />}
      trailingIcon={
        <span className="inline-flex items-center gap-1">
          <Keycap
            size="sm"
            surface={bulkMode ? "default" : "strong"}
            className={
              bulkMode
                ? "border-white/20 bg-white/10 text-white/80"
                : undefined
            }
          >
            Ctrl Q
          </Keycap>
          {bulkMode ? (
            <Keycap
              size="sm"
              surface="default"
              className="border-white/20 bg-white/10 text-white/80"
            >
              Esc
            </Keycap>
          ) : null}
        </span>
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

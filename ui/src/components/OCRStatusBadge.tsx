import { CircleAlert, CircleMinus, Clock, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { ocrStatusLabel } from "../ocrStatus";
import { Badge, Tooltip } from "./ui";

export function OCRStatusBadge({ item }: { item: AssetItem }) {
  const { t } = useTranslation();
  const label = ocrStatusLabel(t, item);
  if (!item.ocr || !label) return null;
  const tone =
    item.ocr.status === "ready"
      ? item.ocr.emptyText
        ? "amber"
        : "green"
      : item.ocr.status === "failed"
        ? "red"
        : item.ocr.status === "skipped"
          ? "line"
          : "blue";
  const Icon =
    item.ocr.status === "ready"
      ? item.ocr.emptyText
        ? CircleMinus
        : FileText
      : item.ocr.status === "failed"
        ? CircleAlert
        : item.ocr.status === "skipped"
          ? CircleMinus
          : Clock;

  return (
    <Tooltip label={label} placement="top">
      <span className="inline-flex">
        <Badge tone={tone}>
          <Icon size={10} />
          {t("ocr.badge.short")}
        </Badge>
      </span>
    </Tooltip>
  );
}

import { CircleAlert, CircleMinus, Clock, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { ocrStatusLabel } from "../ocrStatus";
import { Badge, Tooltip } from "./ui";

export function OCRStatusBadge({ item }: { item: AssetItem }) {
  const { t } = useTranslation();
  const label = ocrStatusLabel(t, item);
  if (!item.ocr || item.ocr.status !== "ready" || !label) return null;

  const isVLM = item.ocr.engineName === "vlm";
  const readyTone = isVLM ? "purple" : "green";
  const tone =
    item.ocr.status === "ready"
      ? item.ocr.emptyText
        ? "amber"
        : readyTone
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
  const badgeText = isVLM ? t("ocr.badge.shortAI") : t("ocr.badge.short");

  return (
    <Tooltip label={label} placement="top">
      <span className="inline-flex">
        <Badge tone={tone}>
          <Icon size={10} />
          {badgeText}
        </Badge>
      </span>
    </Tooltip>
  );
}

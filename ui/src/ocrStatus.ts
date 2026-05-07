import type { TFunction } from "i18next";
import type { AssetItem } from "./types";

export function ocrStatusLabel(t: TFunction, item: AssetItem): string {
  if (!item.ocr) return "";
  if (item.ocr.status === "ready" && item.ocr.emptyText) {
    return t("ocr.badge.empty");
  }
  if (item.ocr.status === "ready") return t("ocr.badge.ready");
  if (item.ocr.status === "pending") return t("ocr.badge.pending");
  if (item.ocr.status === "failed") return t("ocr.badge.failed");
  if (item.ocr.status === "skipped") return t("ocr.badge.skipped");
  return "";
}

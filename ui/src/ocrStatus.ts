import type { TFunction } from "i18next";
import type { AssetItem } from "./types";

export function ocrStatusLabel(t: TFunction, item: AssetItem): string {
  if (!item.ocr) return "";
  const prefix = item.ocr.engineName === "vlm" ? "ocr.badge.ai." : "ocr.badge.";
  if (item.ocr.status === "ready" && item.ocr.emptyText) {
    return t(`${prefix}empty`);
  }
  if (item.ocr.status === "ready") return t(`${prefix}ready`);
  if (item.ocr.status === "pending") return t(`${prefix}pending`);
  if (item.ocr.status === "failed") return t(`${prefix}failed`);
  if (item.ocr.status === "skipped") return t(`${prefix}skipped`);
  return "";
}

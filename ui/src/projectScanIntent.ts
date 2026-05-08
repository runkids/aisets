import type { TFunction } from "i18next";
import type {
  AssetItem,
  DetectionSuggestedScanIntent,
  ProjectScanIntent,
} from "./types";

export const projectScanIntents: ProjectScanIntent[] = [
  "code",
  "assetPack",
  "library",
  "mixed",
];

export function normalizeProjectScanIntent(
  intent?: DetectionSuggestedScanIntent,
): ProjectScanIntent {
  if (intent === "code" || intent === "assetPack" || intent === "library") {
    return intent;
  }
  return "mixed";
}

export function projectScanIntentLabel(
  t: TFunction,
  intent?: ProjectScanIntent,
) {
  return t(`projectIntent.${intent || "code"}.label`);
}

export function projectScanIntentDescription(
  t: TFunction,
  intent?: ProjectScanIntent,
) {
  return t(`projectIntent.${intent || "code"}.description`);
}

export function usageClassification(item: AssetItem) {
  if (item.usageClassification) return item.usageClassification;
  return item.usedBy.length > 0 ? "referenced" : "unused";
}

export function canDeleteUnused(item: AssetItem) {
  if (item.deleteUnusedAllowed != null) return item.deleteUnusedAllowed;
  return usageClassification(item) === "unused";
}

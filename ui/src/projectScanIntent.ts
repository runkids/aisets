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

export function intentSelectOptions(t: TFunction) {
  return projectScanIntents.map((intent) => ({
    value: intent,
    label: projectScanIntentLabel(t, intent),
    description: projectScanIntentDescription(t, intent),
  }));
}

export function usageClassification(item: AssetItem) {
  if (item.usageClassification) return item.usageClassification;
  return item.usedBy.length > 0 ? "referenced" : "notApplicable";
}

export function canDeleteUnused(item: AssetItem) {
  return (
    item.deleteUnusedAllowed === true && usageClassification(item) === "unused"
  );
}

export function notApplicableUsageLabel(
  t: TFunction,
  item: AssetItem,
  options: { short?: boolean } = {},
) {
  if (item.scanIntent === "assetPack") {
    return projectScanIntentLabel(t, "assetPack");
  }
  return t(
    options.short
      ? "browse.flagUsageNotCheckedShort"
      : "browse.flagUsageNotChecked",
  );
}

import type { useTranslation } from "react-i18next";
import type {
  CustomAssetFilter,
  CustomAssetFilterClause,
  CustomAssetFilterField,
  CustomAssetFilterGroup,
  CustomAssetFilterOperator,
  OCRRunCounts,
  SettingsInfo,
  SettingsUpdate,
} from "../../types";
import {
  customFilterOperatorsByField,
  defaultOCRLanguages,
  defaultOptimizationExternalTools,
  defaultOptimizationStrategies,
  defaultSettings,
  emptyExcludePatternsByIntent,
  projectScanIntentValues,
  sectionMeta,
} from "./constants";
import type { Section, SettingsDraft } from "./types";

export function defaultClauseValue(
  field: CustomAssetFilterField,
  operator: CustomAssetFilterOperator,
) {
  if (field === "path" && operator === "regex") return ".*";
  if (field === "path" && operator === "suffix") return ".png";
  if (field === "path") return "/";
  if (field === "folder" && operator === "suffix") return "icons";
  if (field === "folder" && operator === "regex") return "assets/.+";
  if (field === "folder") return "src";
  if (field === "extension" && operator === "oneOf") return ".png,.jpg,.webp";
  if (field === "extension") return ".png";
  if (field === "project" && operator === "oneOf") return "Project A,Project B";
  if (field === "project") return "Project";
  if (field === "bytes") return "0";
  if (field === "status") return "unused";
  if (field === "ocrText" && operator === "regex") return "SALE|活動";
  if (field === "ocrText") return "SALE";
  if (field === "ocrLanguage" && operator === "oneOf") return "eng,chi_tra";
  if (field === "ocrLanguage") return "eng";
  if (field === "ocrScript" && operator === "oneOf") return "latin,han";
  if (field === "ocrScript") return "han";
  if (field === "ocrConfidence") return "0.6";
  if (field === "ocrStatus") return "ready";
  return "true";
}

export function defaultClause(
  field: CustomAssetFilterField = "path",
): CustomAssetFilterClause {
  const operator = customFilterOperatorsByField[field][0];
  return {
    field,
    operator,
    value: defaultClauseValue(field, operator),
  };
}

export function defaultGroup(): CustomAssetFilterGroup {
  return { clauses: [defaultClause()] };
}

export function createCustomFilter(name: string): CustomAssetFilter {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now().toString(36);
  return {
    id: `custom-${random}`,
    name,
    enabled: false,
    groups: [defaultGroup()],
  };
}

export function clauseValueOptions(field: CustomAssetFilterField) {
  if (field === "status") return ["unused", "referenced"];
  if (
    field === "duplicate" ||
    field === "nearDuplicate" ||
    field === "optimizable"
  )
    return ["true", "false"];
  if (field === "ocrStatus") return ["pending", "ready", "failed", "skipped"];
  return null;
}

export function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export function draftFromSettings(settings?: SettingsInfo): SettingsDraft {
  const excludePatternsByIntent =
    settings?.excludePatternsByIntent ??
    defaultSettings.excludePatternsByIntent ??
    emptyExcludePatternsByIntent;
  return {
    workspaceName:
      settings?.workspaceName ?? defaultSettings.workspaceName ?? "",
    defaultProjectRoot:
      settings?.defaultProjectRoot ?? defaultSettings.defaultProjectRoot ?? "",
    autoScanOnOpen: settings?.autoScanOnOpen ?? false,
    scanOnOpen: settings?.scanOnOpen ?? false,
    scanProfile: settings?.scanProfile ?? defaultSettings.scanProfile ?? "full",
    scanAnalyses: settings?.scanAnalyses ??
      defaultSettings.scanAnalyses ?? {
        references: true,
        nearDuplicates: true,
        optimization: true,
      },
    ocrEnabled: settings?.ocrEnabled ?? false,
    ocrLanguages: settings?.ocrLanguages ?? defaultOCRLanguages,
    ocrMaxPixels: settings?.ocrMaxPixels ?? 2_000_000,
    ocrBatchSize: settings?.ocrBatchSize ?? 25,
    ocrConcurrency: settings?.ocrConcurrency ?? 1,
    ocrFuzzySearch: settings?.ocrFuzzySearch ?? true,
    llmProvider: settings?.llmProvider ?? "",
    llmEndpoint: settings?.llmEndpoint ?? "http://localhost:11434",
    llmVisionModel: settings?.llmVisionModel ?? "",
    llmEmbedModel: settings?.llmEmbedModel ?? "",
    excludePatternsText: (settings?.excludePatterns ?? []).join("\n"),
    excludePatternsByIntentText: Object.fromEntries(
      projectScanIntentValues.map((intent) => [
        intent,
        (excludePatternsByIntent[intent] ?? []).join("\n"),
      ]),
    ) as SettingsDraft["excludePatternsByIntentText"],
    optimizationDefaultQuality: settings?.optimizationDefaultQuality ?? 80,
    optimizationWorkers: settings?.optimizationWorkers ?? 1,
    optimizationAvifSpeed: settings?.optimizationAvifSpeed ?? 6,
    optimizationAutoApply: settings?.optimizationAutoApply ?? false,
    optimizationThresholds:
      settings?.optimizationThresholds ??
      defaultSettings.optimizationThresholds!,
    optimizationExternalTools:
      settings?.optimizationExternalTools ?? defaultOptimizationExternalTools,
    optimizationStrategies:
      settings?.optimizationStrategies ?? defaultOptimizationStrategies,
    customAssetFilters: settings?.customAssetFilters ?? [],
  };
}

export function updateFromDraft(draft: SettingsDraft): SettingsUpdate {
  const splitPatterns = (value: string) =>
    value
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  return {
    workspaceName: draft.workspaceName,
    defaultProjectRoot: draft.defaultProjectRoot,
    autoScanOnOpen: draft.autoScanOnOpen,
    scanOnOpen: draft.scanOnOpen,
    scanProfile: draft.scanProfile,
    scanAnalyses: draft.scanAnalyses,
    ocrEnabled: draft.ocrEnabled,
    ocrLanguages: draft.ocrLanguages,
    ocrMaxPixels: draft.ocrMaxPixels,
    ocrBatchSize: draft.ocrBatchSize,
    ocrConcurrency: draft.ocrConcurrency,
    ocrFuzzySearch: draft.ocrFuzzySearch,
    llmProvider: draft.llmProvider,
    llmEndpoint: draft.llmEndpoint,
    llmVisionModel: draft.llmVisionModel,
    llmEmbedModel: draft.llmEmbedModel,
    excludePatterns: splitPatterns(draft.excludePatternsText),
    excludePatternsByIntent: Object.fromEntries(
      projectScanIntentValues.map((intent) => [
        intent,
        splitPatterns(draft.excludePatternsByIntentText[intent] ?? ""),
      ]),
    ) as SettingsUpdate["excludePatternsByIntent"],
    optimizationDefaultQuality: draft.optimizationDefaultQuality,
    optimizationWorkers: draft.optimizationWorkers,
    optimizationAvifSpeed: draft.optimizationAvifSpeed,
    optimizationAutoApply: draft.optimizationAutoApply,
    optimizationThresholds: draft.optimizationThresholds,
    optimizationExternalTools: draft.optimizationExternalTools,
    optimizationStrategies: draft.optimizationStrategies,
    customAssetFilters: draft.customAssetFilters,
  };
}

export function resetSectionDraft(
  current: SettingsDraft,
  section: Section | "catalogScanning" | "ocr",
): SettingsDraft {
  const defaults = draftFromSettings();
  switch (section) {
    case "workspace":
      return {
        ...current,
        workspaceName: defaults.workspaceName,
        defaultProjectRoot: defaults.defaultProjectRoot,
      };
    case "scanning":
    case "catalogScanning":
      return {
        ...current,
        autoScanOnOpen: defaults.autoScanOnOpen,
        scanOnOpen: defaults.scanOnOpen,
        scanProfile: defaults.scanProfile,
        scanAnalyses: defaults.scanAnalyses,
        excludePatternsText: defaults.excludePatternsText,
        excludePatternsByIntentText: defaults.excludePatternsByIntentText,
      };
    case "ocr":
      return {
        ...current,
        ocrEnabled: defaults.ocrEnabled,
        ocrLanguages: defaults.ocrLanguages,
        ocrMaxPixels: defaults.ocrMaxPixels,
        ocrBatchSize: defaults.ocrBatchSize,
        ocrConcurrency: defaults.ocrConcurrency,
        ocrFuzzySearch: defaults.ocrFuzzySearch,
      };
    case "ai":
      return {
        ...current,
        llmProvider: defaults.llmProvider,
        llmEndpoint: defaults.llmEndpoint,
        llmVisionModel: defaults.llmVisionModel,
        llmEmbedModel: defaults.llmEmbedModel,
      };
    case "customFilters":
      return {
        ...current,
        customAssetFilters: defaults.customAssetFilters,
      };
    case "optimization":
      return {
        ...current,
        optimizationDefaultQuality: defaults.optimizationDefaultQuality,
        optimizationWorkers: defaults.optimizationWorkers,
        optimizationAvifSpeed: defaults.optimizationAvifSpeed,
        optimizationAutoApply: defaults.optimizationAutoApply,
        optimizationThresholds: defaults.optimizationThresholds,
        optimizationExternalTools: defaults.optimizationExternalTools,
        optimizationStrategies: defaults.optimizationStrategies,
      };
    default:
      return defaults;
  }
}

export function ocrLanguageLabel(
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const key = `settings.ocrLanguageLabels.${language}`;
  const label = t(key);
  return label === key ? language : label;
}

export function ocrProgressLabel(
  counts: OCRRunCounts,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const skipReasons = counts.skipReasons ?? {};
  const [topSkipReason, topSkipCount] =
    Object.entries(skipReasons).sort((a, b) => b[1] - a[1])[0] ?? [];
  const skipReasonLabel = topSkipReason
    ? t(`settings.ocrSkipReason.${topSkipReason}`, {
        defaultValue: topSkipReason,
      })
    : "";
  const key = topSkipReason
    ? "settings.ocrProgressWithSkipReason"
    : "settings.ocrProgress";
  return t(key, {
    processed: counts.processed,
    ready: counts.ready,
    failed: counts.failed,
    skipped: counts.skipped,
    cacheHit: counts.cacheHit,
    skipReason: skipReasonLabel,
    skipReasonCount: topSkipCount ?? 0,
  });
}

export function sectionIcon(id: Section) {
  return sectionMeta.find((section) => section.id === id)?.icon;
}

export const workspaceIconMaxBytes = 512 * 1024;
export const workspaceIconAccept = "image/png,image/jpeg,image/gif,image/webp";

export function readWorkspaceIcon(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

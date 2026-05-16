import type { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type {
  CustomAssetFilter,
  CustomAssetFilterClause,
  CustomAssetFilterField,
  CustomAssetFilterGroup,
  CustomAssetFilterOperator,
  CustomLintRuleClause,
  CustomLintRuleField,
  CustomLintRuleGroup,
  CustomLintRuleOperator,
  CustomLintRuleSetting,
  LintRuleSettings,
  LintRuleSeverity,
  OCRRunCounts,
  SettingsInfo,
  SettingsUpdate,
} from "@/types";
import {
  customFilterOperatorsByField,
  customLintRuleFields,
  customLintRuleOperatorsByField,
  defaultOCRLanguages,
  defaultOptimizationExternalTools,
  defaultOptimizationStrategies,
  defaultSettings,
  defaultLintRules,
  emptyExcludePatternsByIntent,
  lintSeverities,
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
  if (field === "ocrText" && operator === "regex") return "SALE|EVENT";
  if (field === "ocrText") return "SALE";
  if (field === "ocrLanguage" && operator === "oneOf") return "eng,chi_tra";
  if (field === "ocrLanguage") return "eng";
  if (field === "ocrScript" && operator === "oneOf") return "latin,han";
  if (field === "ocrScript") return "han";
  if (field === "ocrConfidence") return "0.6";
  if (field === "ocrStatus") return "ready";
  if (field === "ocrSource") return "vlm";
  if (field === "aiCategory") return "icon";
  if (field === "aiTag" && operator === "oneOf") return "dark-mode,mobile,hero";
  if (field === "aiTag") return "dark-mode";
  if (field === "aiDescription" && operator === "regex") return "login|auth";
  if (field === "aiDescription" && operator === "oneOf")
    return "elephant,dog,dogs,cat,cats";
  if (field === "aiDescription") return "dashboard";
  if (field === "aiStatus") return "ready";
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

export function defaultLintRuleClauseValue(
  field: CustomLintRuleField,
  operator: CustomLintRuleOperator,
) {
  if (field === "path" && operator === "regex") return ".*";
  if (field === "path") return "assets";
  if (field === "folder") return "icons";
  if (field === "extension" && operator === "oneOf") return ".png,.jpg,.webp";
  if (field === "extension") return ".png";
  if (field === "project") return "Project";
  if (field === "bytes") return "102400";
  if (field === "width" || field === "height") return "1024";
  if (field === "megapixels") return "1";
  if (field === "referenceKind") return "string";
  if (field === "specifier") return "?raw";
  if (field === "snippetRegex") return "hero|banner";
  if (field === "snippet") return "hero";
  return "true";
}

export function defaultLintRuleClause(
  field: CustomLintRuleField = "path",
): CustomLintRuleClause {
  const operator = customLintRuleOperatorsByField[field][0];
  return {
    field,
    operator,
    value: defaultLintRuleClauseValue(field, operator),
  };
}

export function defaultLintRuleGroup(): CustomLintRuleGroup {
  return { clauses: [defaultLintRuleClause()] };
}

export function createCustomLintRule(name: string): CustomLintRuleSetting {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now().toString(36);
  return {
    id: `custom-${random}`,
    name,
    enabled: false,
    severity: "warning",
    message: "Custom lint rule matched this image.",
    suggestion: "Review this image against your team asset rules.",
    groups: [defaultLintRuleGroup()],
  };
}

export function createCustomLintRuleFromPreset(
  preset: Omit<CustomLintRuleSetting, "id" | "enabled">,
): CustomLintRuleSetting {
  return {
    ...createCustomLintRule(preset.name),
    ...preset,
    enabled: true,
  };
}

export function lintRulesExportPayload(lintRules: LintRuleSettings) {
  return {
    kind: "aisets-lint-rules",
    version: 1,
    exportedAt: new Date().toISOString(),
    lintRules,
  };
}

export function parseLintRulesImportPayload(value: unknown): LintRuleSettings {
  const candidate =
    isRecord(value) && isRecord(value.lintRules) ? value.lintRules : value;
  if (!isRecord(candidate)) {
    throw new Error("Invalid lint rules payload");
  }
  const importedBuiltinRules = Array.isArray(candidate.builtinRules)
    ? candidate.builtinRules
        .map((rule) => parseBuiltinLintRule(rule))
        .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))
    : [];
  const builtinRulesById = new Map(
    importedBuiltinRules.map((rule) => [rule.id, rule]),
  );
  const builtinRules = defaultLintRules.builtinRules.map((rule) => ({
    ...rule,
    ...builtinRulesById.get(rule.id),
    thresholdKB:
      rule.thresholdKB === undefined
        ? undefined
        : (builtinRulesById.get(rule.id)?.thresholdKB ?? rule.thresholdKB),
  }));
  const customRules = Array.isArray(candidate.customRules)
    ? candidate.customRules
        .map((rule) => parseCustomLintRule(rule))
        .filter((rule): rule is CustomLintRuleSetting => Boolean(rule))
    : [];
  return {
    builtinRules,
    customRules,
  };
}

function parseBuiltinLintRule(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const defaultRule = defaultLintRules.builtinRules.find(
    (rule) => rule.id === value.id,
  );
  if (!defaultRule) return null;
  const thresholdKB = numberValue(value.thresholdKB);
  return {
    id: value.id,
    enabled: booleanValue(value.enabled, defaultRule.enabled),
    severity: lintSeverityValue(value.severity, defaultRule.severity),
    ...(defaultRule.thresholdKB === undefined || thresholdKB === undefined
      ? {}
      : { thresholdKB: Math.max(1, Math.round(thresholdKB)) }),
  };
}

function parseCustomLintRule(value: unknown): CustomLintRuleSetting | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name, "");
  if (!name.trim()) return null;
  const id = stringValue(value.id, "");
  const groups = Array.isArray(value.groups)
    ? value.groups
        .map((group) => parseCustomLintRuleGroup(group))
        .filter((group): group is CustomLintRuleGroup => Boolean(group))
    : [];
  const base = createCustomLintRule(name);
  return {
    ...base,
    id: id.trim() || base.id,
    name,
    enabled: booleanValue(value.enabled, true),
    severity: lintSeverityValue(value.severity, "warning"),
    message: stringValue(value.message, "Custom lint rule matched this image."),
    suggestion: stringValue(
      value.suggestion,
      "Review this image against your team asset rules.",
    ),
    groups: groups.length > 0 ? groups : [defaultLintRuleGroup()],
  };
}

function parseCustomLintRuleGroup(value: unknown): CustomLintRuleGroup | null {
  if (!isRecord(value) || !Array.isArray(value.clauses)) return null;
  const clauses = value.clauses
    .map((clause) => parseCustomLintRuleClause(clause))
    .filter((clause): clause is CustomLintRuleClause => Boolean(clause));
  return clauses.length > 0 ? { clauses } : null;
}

function parseCustomLintRuleClause(
  value: unknown,
): CustomLintRuleClause | null {
  if (!isRecord(value) || typeof value.field !== "string") return null;
  if (!customLintRuleFields.includes(value.field as CustomLintRuleField)) {
    return null;
  }
  const field = value.field as CustomLintRuleField;
  const allowedOperators = customLintRuleOperatorsByField[field];
  const operator = allowedOperators.includes(
    value.operator as CustomLintRuleOperator,
  )
    ? (value.operator as CustomLintRuleOperator)
    : allowedOperators[0];
  return {
    field,
    operator,
    value: stringValue(
      value.value,
      defaultLintRuleClauseValue(field, operator),
    ),
  };
}

function lintSeverityValue(
  value: unknown,
  fallback: LintRuleSeverity,
): LintRuleSeverity {
  return lintSeverities.includes(value as LintRuleSeverity)
    ? (value as LintRuleSeverity)
    : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function operatorDescription(
  field: CustomAssetFilterField,
  operator: string,
  t: (key: string) => string,
): string | undefined {
  const key = `settings.customFilterOperatorDesc.${field}.${operator}`;
  const val = t(key);
  return val === key ? undefined : val;
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
  if (field === "ocrSource") return ["any", "local", "vlm"];
  if (field === "aiStatus")
    return ["pending", "ready", "failed", "skipped", "none"];
  return null;
}

export function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function withCurrentLocaleDefault(
  saved: string[] | undefined | null,
): string[] {
  if (saved && saved.length > 0) return saved;
  const lang = i18n.language || "en";
  if (lang === "en") return ["en"];
  return ["en", lang];
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
    llmEnabled: settings?.llmEnabled ?? false,
    llmProvider: settings?.llmProvider ?? "",
    llmEndpoint: settings?.llmEndpoint ?? "http://localhost:11434",
    llmApiKey: settings?.llmApiKey ?? "",
    llmVisionModel: settings?.llmVisionModel ?? "",
    llmEmbedModel: settings?.llmEmbedModel ?? "",
    llmTagPrompt: settings?.llmTagPrompt ?? "",
    llmOcrPrompt: settings?.llmOcrPrompt ?? "",
    llmPrecheckPrompt: settings?.llmPrecheckPrompt ?? "",
    llmAutoLocale: settings?.llmAutoLocale ?? false,
    llmTranslationLocales: withCurrentLocaleDefault(
      settings?.llmTranslationLocales,
    ),
    llmConcurrency: settings?.llmConcurrency ?? 1,
    llmTimeout: settings?.llmTimeout ?? defaultSettings.llmTimeout ?? 30,
    agentEnabled: settings?.agentEnabled ?? false,
    agentAdapter: settings?.agentAdapter ?? "auto",
    agentModel: settings?.agentModel ?? "",
    vlmBackend: settings?.vlmBackend ?? "",
    vlmBackendTag: settings?.vlmBackendTag ?? "",
    vlmBackendOcr: settings?.vlmBackendOcr ?? "",
    vlmBackendOptimize: settings?.vlmBackendOptimize ?? "",
    vlmBackendDuplicate: settings?.vlmBackendDuplicate ?? "",
    vlmBackendPrecheck: settings?.vlmBackendPrecheck ?? "",
    vlmBackendTranslate: settings?.vlmBackendTranslate ?? "",
    vlmBackendCanvas: settings?.vlmBackendCanvas ?? "",
    aiNickname: settings?.aiNickname ?? "",
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
    lintRules: settings?.lintRules ?? defaultLintRules,
    embedSearchThreshold: settings?.embedSearchThreshold ?? 0.4,
    embedImageSearchThreshold: settings?.embedImageSearchThreshold ?? 0.24,
    embedImageDynamicEnabled: settings?.embedImageDynamicEnabled ?? true,
    embedImageDynamicMargin: settings?.embedImageDynamicMargin ?? 0.05,
    embedSearchLimit: settings?.embedSearchLimit ?? 20,
    embedSearchType: settings?.embedSearchType ?? "hybrid",
    embedInputFields: settings?.embedInputFields ?? [
      "category",
      "tags",
      "description",
    ],
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
    llmEnabled: draft.llmEnabled,
    llmProvider: draft.llmProvider,
    llmEndpoint: draft.llmEndpoint,
    llmApiKey: draft.llmApiKey,
    llmVisionModel: draft.llmVisionModel,
    llmEmbedModel: draft.llmEmbedModel,
    llmTagPrompt: draft.llmTagPrompt,
    llmOcrPrompt: draft.llmOcrPrompt,
    llmPrecheckPrompt: draft.llmPrecheckPrompt,
    llmAutoLocale: draft.llmAutoLocale,
    llmTranslationLocales: draft.llmTranslationLocales,
    llmConcurrency: draft.llmConcurrency,
    llmTimeout: draft.llmTimeout,
    agentEnabled: draft.agentEnabled,
    agentAdapter: draft.agentAdapter,
    agentModel: draft.agentModel,
    vlmBackend: draft.vlmBackend,
    vlmBackendTag: draft.vlmBackendTag,
    vlmBackendOcr: draft.vlmBackendOcr,
    vlmBackendOptimize: draft.vlmBackendOptimize,
    vlmBackendDuplicate: draft.vlmBackendDuplicate,
    vlmBackendPrecheck: draft.vlmBackendPrecheck,
    vlmBackendTranslate: draft.vlmBackendTranslate,
    vlmBackendCanvas: draft.vlmBackendCanvas,
    aiNickname: draft.aiNickname,
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
    lintRules: draft.lintRules,
    embedSearchThreshold: draft.embedSearchThreshold,
    embedImageSearchThreshold: draft.embedImageSearchThreshold,
    embedImageDynamicEnabled: draft.embedImageDynamicEnabled,
    embedImageDynamicMargin: draft.embedImageDynamicMargin,
    embedSearchLimit: draft.embedSearchLimit,
    embedSearchType: draft.embedSearchType,
    embedInputFields: draft.embedInputFields,
  };
}

export function changedUpdateFromDraft(
  draft: SettingsDraft,
  settings?: SettingsInfo,
): SettingsUpdate {
  const next = updateFromDraft(draft);
  if (!settings) return next;

  const current = updateFromDraft(draftFromSettings(settings));
  const changed: Partial<Record<keyof SettingsUpdate, unknown>> = {};
  for (const key of Object.keys(next) as (keyof SettingsUpdate)[]) {
    if (!settingsUpdateValuesEqual(next[key], current[key])) {
      changed[key] = next[key];
    }
  }
  return changed as SettingsUpdate;
}

function settingsUpdateValuesEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
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
        llmTagPrompt: defaults.llmTagPrompt,
        llmOcrPrompt: defaults.llmOcrPrompt,
        llmPrecheckPrompt: defaults.llmPrecheckPrompt,
        llmAutoLocale: defaults.llmAutoLocale,
        llmConcurrency: defaults.llmConcurrency,
        llmTimeout: defaults.llmTimeout,
        agentEnabled: defaults.agentEnabled,
        agentAdapter: defaults.agentAdapter,
        agentModel: defaults.agentModel,
        vlmBackend: defaults.vlmBackend,
        vlmBackendTag: defaults.vlmBackendTag,
        vlmBackendOcr: defaults.vlmBackendOcr,
        vlmBackendOptimize: defaults.vlmBackendOptimize,
        vlmBackendDuplicate: defaults.vlmBackendDuplicate,
        vlmBackendPrecheck: defaults.vlmBackendPrecheck,
        vlmBackendTranslate: defaults.vlmBackendTranslate,
        vlmBackendCanvas: defaults.vlmBackendCanvas,
        aiNickname: defaults.aiNickname,
      };
    case "customFilters":
      return {
        ...current,
        customAssetFilters: defaults.customAssetFilters,
      };
    case "lintRules":
      return {
        ...current,
        lintRules: defaults.lintRules,
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
    dedup: counts.dedup,
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

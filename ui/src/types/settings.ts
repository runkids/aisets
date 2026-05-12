import type { CustomAssetFilter } from "./customFilters";
import type { ExcludePatternsByIntent, Project, Workspace } from "./project";
import type { ScanAnalyses, ScanProfile } from "./scan";

export type AppSettings = {
  workspaceName: string;
  activeWorkspaceId: string;
  defaultProjectRoot: string;
  autoScanOnOpen: boolean;
  scanOnOpen: boolean;
  scanProfile: ScanProfile;
  scanAnalyses: ScanAnalyses;
  ocrEnabled: boolean;
  ocrLanguages: string[];
  ocrMaxPixels: number;
  ocrBatchSize: number;
  ocrConcurrency: number;
  ocrFuzzySearch: boolean;
  excludePatterns: string[];
  excludePatternsByIntent: ExcludePatternsByIntent;
  optimizationDefaultQuality: number;
  optimizationWorkers: number;
  optimizationAvifSpeed: number;
  optimizationAutoApply: boolean;
  optimizationThresholds: OptimizationThresholds;
  optimizationExternalTools: OptimizationExternalTool[];
  optimizationStrategies: OptimizationStrategy[];
  customAssetFilters: CustomAssetFilter[];
  lintRules: LintRuleSettings;
  preferredEditor: string;
  llmEnabled: boolean;
  llmProvider: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmVisionModel: string;
  llmEmbedModel: string;
  llmTagPrompt: string;
  llmOcrPrompt: string;
  llmPrecheckPrompt: string;
  llmSystemPromptEnabled: boolean;
  llmAutoLocale: boolean;
  llmTranslationLocales: string[];
  llmConcurrency: number;
  llmTimeout: number;
  agentEnabled: boolean;
  agentAdapter: string;
  agentModel: string;
  vlmBackend: string;
  vlmBackendTag: string;
  vlmBackendOcr: string;
  vlmBackendOptimize: string;
  vlmBackendDuplicate: string;
  vlmBackendPrecheck: string;
  vlmBackendTranslate: string;
  embedSearchThreshold: number;
  embedSearchLimit: number;
  embedSearchType: string;
  embedInputFields: string[];
};

export type SettingsInfo = AppSettings & {
  workspaces: Workspace[];
  projects: Project[];
  databasePath: string;
  dataDir: string;
  cacheDir: string;
  ocrRuntime: OCRRuntime;
  optimizationToolRuntime: OptimizationToolRuntime[];
  optimizationStrategyHash: string;
  llmRuntime: LLMRuntime;
  agentRuntime: AgentRuntime;
};

export type OCRRuntime = {
  availableLanguages: Array<{
    language: string;
    installed: boolean;
    sizeBytes: number;
    path?: string;
  }>;
  installed: boolean;
  dataDir: string;
  platform: string;
  engineName: string;
  engineVersion: string;
  engineAvailable: boolean;
  engineError?: string;
};

export type OptimizationThresholds = {
  svgMinSavingsPercent: number;
  maxDimensionPx: number;
  fileSizeWarningKB: number;
  fileSizeCriticalKB: number;
  pngAlphaCheckEnabled: boolean;
};

export type OptimizationExternalTool = {
  id: string;
  enabled: boolean;
};

export type OptimizationToolRuntime = {
  id: string;
  detected: boolean;
  path?: string;
  enabled: boolean;
  operations: string[];
};

export type LLMModel = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type LLMRuntime = {
  provider: string;
  endpoint: string;
  connected: boolean;
  error?: string;
  models: LLMModel[];
  visionModel: string;
  embedModel: string;
};

export type AgentAdapterInfo = {
  id: string;
  name: string;
  version: string;
  path: string;
};

export type AgentRuntime = {
  adapters: AgentAdapterInfo[];
  active: string;
  available: boolean;
};

export type OptimizationStrategy = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: OptimizationStrategyMatch;
  action: OptimizationStrategyAction;
};

export type OptimizationStrategyMatch = {
  formats: string[];
  alpha: "any" | "transparent" | "opaque";
  animated: "any" | "true" | "false";
  aiCategories?: string[];
  minBytesKB?: number;
  minWidthPx?: number;
  minHeightPx?: number;
};

export type OptimizationStrategyAction = {
  operation: "convert" | "recompress" | "resize" | "svg-minify";
  outputFormat?: string;
  quality?: number;
  avifSpeed?: number;
  resizeMaxDimensionPx?: number;
  preserveAnimation?: boolean;
};

export type LintRuleSeverity = "critical" | "warning" | "info" | "advisory";

export type BuiltinLintRuleSetting = {
  id: string;
  enabled: boolean;
  severity: LintRuleSeverity;
  thresholdKB?: number;
};

export type CustomLintRuleField =
  | "path"
  | "folder"
  | "extension"
  | "project"
  | "bytes"
  | "width"
  | "height"
  | "megapixels"
  | "animated"
  | "alpha"
  | "duplicate"
  | "nearDuplicate"
  | "optimizable"
  | "exifGps"
  | "referenceKind"
  | "specifier"
  | "snippet"
  | "snippetRegex"
  | "hasLoading"
  | "hasFetchPriority"
  | "hasWidth"
  | "hasHeight"
  | "hasSrcset"
  | "altEmpty";

export type CustomLintRuleOperator =
  | "contains"
  | "regex"
  | "prefix"
  | "suffix"
  | "equals"
  | "oneOf"
  | "gte"
  | "lte"
  | "is";

export type CustomLintRuleClause = {
  field: CustomLintRuleField;
  operator: CustomLintRuleOperator;
  value: string;
};

export type CustomLintRuleGroup = {
  clauses: CustomLintRuleClause[];
};

export type CustomLintRuleSetting = {
  id: string;
  name: string;
  enabled: boolean;
  severity: LintRuleSeverity;
  message: string;
  suggestion: string;
  groups: CustomLintRuleGroup[];
};

export type LintRuleSettings = {
  builtinRules: BuiltinLintRuleSetting[];
  customRules: CustomLintRuleSetting[];
};

export type SettingsUpdate = Partial<AppSettings>;

export type VersionCheck = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  devMode: boolean;
  upgradeCommand: string;
};

export type UpdateAppResult = {
  currentVersion: string;
  latestVersion?: string;
  updated: boolean;
  dryRun: boolean;
  devMode: boolean;
  message: string;
};

export type ExportData = {
  version: number;
  exportedAt: string;
  workspaces?: Workspace[];
  projects: Project[];
  settings?: AppSettings;
};

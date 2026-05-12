export type Workspace = {
  id: string;
  name: string;
  iconImage?: string;
  projectCount: number;
};

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  iconImage?: string;
  scanIntent?: ProjectScanIntent;
  createdAt?: string;
};

export type ProjectScanIntent = "code" | "assetPack" | "library" | "mixed";

export type ExcludePatternsByIntent = Record<ProjectScanIntent, string[]>;

export type DetectionSuggestedScanIntent = ProjectScanIntent | "unknown";

export type ReferenceCoverage = "supported" | "partial" | "notApplicable";

export type ProjectScanIntentDetection = {
  suggestedScanIntent: DetectionSuggestedScanIntent;
  confidence: "low" | "medium" | "high";
  referenceCoverage: ReferenceCoverage;
  evidence: string[];
  counts: {
    assetFiles: number;
    codeFiles: number;
    manifestFiles: number;
    docFiles: number;
    totalFiles: number;
    sampledFiles: number;
    sampleLimited: boolean;
  };
};

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

export type ScanProfile = "fast" | "full" | "custom";

export type AnalysisState = "computed" | "notComputed";

export type ScanAnalyses = {
  references: boolean;
  nearDuplicates: boolean;
  optimization: boolean;
};

export type CustomAssetFilterField =
  | "path"
  | "folder"
  | "extension"
  | "project"
  | "bytes"
  | "status"
  | "duplicate"
  | "nearDuplicate"
  | "optimizable"
  | "ocrText"
  | "ocrLanguage"
  | "ocrScript"
  | "ocrConfidence"
  | "ocrStatus"
  | "ocrSource"
  | "aiCategory"
  | "aiTag"
  | "aiDescription"
  | "aiStatus"
  | "aiContainsFace"
  | "aiSceneType";

export type CustomAssetFilterOperator =
  | "contains"
  | "regex"
  | "prefix"
  | "suffix"
  | "equals"
  | "oneOf"
  | "gte"
  | "lte"
  | "is";

export type CustomAssetFilterClause = {
  field: CustomAssetFilterField;
  operator: CustomAssetFilterOperator;
  value: string;
};

export type CustomAssetFilterGroup = {
  clauses: CustomAssetFilterClause[];
};

export type CustomAssetFilter = {
  id: string;
  name: string;
  enabled: boolean;
  groups: CustomAssetFilterGroup[];
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

export type AssetReference = {
  file: string;
  line: number;
  specifier: string;
  kind: string;
  snippet?: string;
};

export type AssetItem = {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  localPath: string;
  ext: string;
  bytes: number;
  modifiedUnix: number;
  contentHash: string;
  hashAlgorithm: string;
  image: {
    format: string;
    width: number;
    height: number;
    animated: boolean;
    alpha: boolean;
    pages: number;
    errorCode?: string;
    error?: string;
  };
  dHash?: string;
  dHashFlipped?: string;
  url: string;
  thumbnailUrl: string;
  usedBy: string[];
  references: AssetReference[];
  duplicateGroupId: string | null;
  duplicates: string[];
  similar: string[];
  preferredDuplicatePath: string | null;
  optimizationRecommendations: Array<{
    category: string;
    reasonCode: string;
    reason: string;
    severity: "critical" | "warning" | "info";
    suggestionCode: string;
    suggestion: string;
    operation?: string;
    estimatedBytes?: number;
    savingsBytes?: number;
    hasExistingVariant?: boolean;
    variantBytes?: number;
  }>;
  ocr?: {
    status: "pending" | "ready" | "failed" | "skipped";
    engineName?: string;
    engineVersion?: string;
    providerName?: string;
    modelName?: string;
    text?: string;
    normalizedText?: string;
    textStatus?: "available" | "empty";
    emptyText?: boolean;
    languages?: string[];
    scripts?: string[];
    confidence?: number;
    errorCode?: string;
    errorMessage?: string;
    durationMs?: number;
    mode?: string;
    attempts?: number;
    updatedAt?: string;
  };
  aiTag?: {
    status: "pending" | "ready" | "failed" | "skipped";
    category?: string;
    categoryI18n?: Record<string, string>;
    tags?: string[];
    tagsI18n?: Record<string, string[]>;
    description?: string;
    descriptionI18n?: Record<string, string>;
    languages?: string[];
    containsFace?: boolean;
    sceneType?: string;
    estimatedLocation?: string;
    locationConfidence?: string;
    providerName?: string;
    modelName?: string;
    errorCode?: string;
    errorMessage?: string;
    durationMs?: number;
    updatedAt?: string;
  };
  scanIntent?: ProjectScanIntent;
  usageClassification?:
    | "referenced"
    | "unused"
    | "possiblyUnused"
    | "notApplicable";
  deleteUnusedAllowed?: boolean;
  lintApplicability?: "applicable" | "advisory" | "notApplicable";
  optimizeApplicability?: "applicable" | "advisory" | "notApplicable";
  exif?: EXIFData;
};

export type EXIFData = {
  hasExif: boolean;
  gpsLatitude?: number;
  gpsLongitude?: number;
  cameraMake?: string;
  cameraModel?: string;
  dateTimeOriginal?: string;
  orientation?: number;
  dpiX?: number;
  dpiY?: number;
};

export type OptimizationRecommendation =
  AssetItem["optimizationRecommendations"][number];

export type OCRResult = NonNullable<AssetItem["ocr"]>;

export type SimilarFile = {
  id: string;
  path: string;
  similarity: number;
  mirrored: boolean;
  thumbnailUrl: string;
  bytes: number;
  width: number;
  height: number;
  ext: string;
  contentHash: string;
};

export type DuplicateGroup = {
  id: string;
  contentHash: string;
  hashAlgorithm: string;
  paths: string[];
  preferredPath: string;
  members?: AssetItem[];
};

export type NearDuplicate = {
  id: string;
  leftId: string;
  rightId: string;
  leftPath: string;
  rightPath: string;
  distance: number;
  flipped: boolean;
  leftItem?: AssetItem;
  rightItem?: AssetItem;
};

export type LintFinding = {
  ruleId: string;
  severity: "critical" | "warning" | "info";
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggestion: string;
  assetId?: string;
};

export type Catalog = {
  scanId?: number;
  startedAt?: string;
  generatedAt: string;
  projects: Project[];
  projectStats: Array<{
    projectId: string;
    totalFiles: number;
    totalBytes: number;
    unusedFiles: number;
    possiblyUnusedFiles?: number;
    usageNotApplicableFiles?: number;
    referencedFiles?: number;
    duplicateFiles: number;
    duplicateGroups: number;
    optimizableFiles: number;
    lintFindings: number;
  }>;
  items: AssetItem[];
  duplicateGroups: DuplicateGroup[];
  nearDuplicates: NearDuplicate[];
  lintFindings: LintFinding[];
  stats: {
    totalFiles: number;
    duplicateGroups: number;
    duplicateFiles: number;
    unusedFiles: number;
    possiblyUnusedFiles?: number;
    usageNotApplicableFiles?: number;
    referencedFiles?: number;
    nearDuplicates: number;
    lintFindings: number;
    cacheHits: number;
  };
  analysis: {
    references: AnalysisState;
    nearDuplicates: AnalysisState;
    optimization: AnalysisState;
  };
};

export type CatalogSummary = Pick<
  Catalog,
  | "scanId"
  | "startedAt"
  | "generatedAt"
  | "projects"
  | "projectStats"
  | "stats"
  | "analysis"
>;

export type CatalogItemsPage = {
  items: AssetItem[];
  total: number;
  nextCursor?: string;
  facets: {
    projects: Array<{ id: string; count: number }>;
    projectTotal: number;
    extensions: Array<{ id: string; count: number }>;
    extensionTotal: number;
    optimizationCategories: Array<{ id: string; count: number }>;
    optimizationSeverities: Array<{ id: string; count: number }>;
    operations: Array<{ id: string; count: number }>;
    optimizationTotal: number;
    optimizationPendingTotal: number;
    optimizationDoneTotal: number;
    customFilters: Array<{
      id: string;
      label: string;
      count: number;
      usesOCR: boolean;
      usesAI: boolean;
    }>;
    customFilterTotal: number;
    aiCategories: Array<{ id: string; count: number }>;
    aiCategoryTranslations?: Record<string, string>;
    aiCategoryTotal: number;
    ocrReadyCount: number;
    vlmOcrReadyCount: number;
    aiTagReadyCount: number;
    exifHasGps: number;
    exifHasCamera: number;
  };
};

export type CatalogDuplicatesPage = {
  groups: DuplicateGroup[];
  pairs: NearDuplicate[];
  total: number;
  totalFiles: number;
  nextCursor?: string;
  facets: {
    projects: Array<{ id: string; count: number }>;
    projectTotal: number;
    extensions: Array<{ id: string; count: number }>;
    extensionTotal: number;
  };
};

export type CatalogLintPage = {
  items: LintFinding[];
  total: number;
  nextCursor?: string;
  facets: {
    projects: Array<{ id: string; count: number }>;
    projectTotal: number;
    severities: Array<{ id: string; count: number }>;
    rules: Array<{ id: string; count: number }>;
  };
};

export type CatalogFolderNode = {
  id: string;
  name: string;
  path: string;
  count: number;
  hasChildren: boolean;
};

export type CatalogFoldersPage = {
  folders: CatalogFolderNode[];
  total: number;
};

export type CatalogItemDetail = {
  item: AssetItem;
  references: AssetReference[];
  duplicates: AssetItem[];
  similar: NearDuplicate[];
  similarItems: AssetItem[];
  optimization: OptimizationRecommendation[];
  ocr?: OCRResult;
};

export type ScanProgressPhase =
  | "collecting"
  | "metadata"
  | "references"
  | "duplicates"
  | "nearDuplicates"
  | "lint"
  | "persisting";

export type ScanEvent =
  | { type: "start" }
  | {
      type: "progress";
      phase: ScanProgressPhase;
      current?: number;
      total?: number;
      message?: string;
      state?: AnalysisState;
      reason?: "" | "skippedByUser" | "skippedByThreshold" | "notApplicable";
    }
  | {
      type: "done";
      scanId?: number;
      stats?: Catalog["stats"];
      analysis?: Catalog["analysis"];
    }
  | { type: "error"; error?: APIErrorBody["error"] };

export type ScanSummary = {
  id: number;
  startedAt: string;
  completedAt?: string;
  status: string;
  profile: ScanProfile;
  projectCount: number;
  totalFiles: number;
  duplicateGroups: number;
  duplicateFiles: number;
  unusedFiles: number;
  nearDuplicates: number;
  cacheHits: number;
  analysis: Catalog["analysis"];
};

export type ScanDiffSummary = {
  added: number;
  removed: number;
  modified: number;
  referenceChanged: number;
  becameUnused: number;
  noLongerUnused: number;
  totalByteDelta: number;
  optimizationSavingsDelta: number;
  duplicateGroupsDelta: number;
  nearDuplicatesDelta: number;
};

export type ScanAssetDiff = {
  projectId: string;
  projectName: string;
  repoPath: string;
  ext: string;
  beforeBytes?: number;
  afterBytes?: number;
  beforeHash?: string;
  afterHash?: string;
  beforeUsedCount?: number;
  afterUsedCount?: number;
};

export type UnusedTransition = {
  projectId: string;
  projectName: string;
  repoPath: string;
  ext: string;
  direction: "becameUnused" | "noLongerUnused";
  beforeUsedCount: number;
  afterUsedCount: number;
};

export type ScanDiff = {
  base: ScanSummary;
  target: ScanSummary;
  summary: ScanDiffSummary;
  added: ScanAssetDiff[];
  removed: ScanAssetDiff[];
  modified: ScanAssetDiff[];
  referenceChanges: ScanAssetDiff[];
  unusedTransitions: UnusedTransition[];
};

export type OCRRunCounts = {
  queued: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  cacheHit: number;
  dedup: number;
  skipReasons?: Record<string, number>;
};

export type OCRRunEvent =
  | { type: "start"; counts: OCRRunCounts }
  | {
      type: "progress";
      assetId: string;
      repoPath: string;
      status: string;
      counts: OCRRunCounts;
    }
  | { type: "done"; counts: OCRRunCounts; hasMore?: boolean }
  | { type: "error"; error?: APIErrorBody["error"]; counts?: OCRRunCounts };

export type AITagRunCounts = {
  queued: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  cacheHit: number;
  dedup: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type AITagRunEvent =
  | {
      type: "start";
      counts: AITagRunCounts;
      providerName?: string;
      modelName?: string;
    }
  | {
      type: "progress";
      assetId: string;
      repoPath: string;
      status: string;
      counts: AITagRunCounts;
      errorMessage?: string;
    }
  | {
      type: "done";
      counts: AITagRunCounts;
      firstError?: string;
      providerName?: string;
      modelName?: string;
    }
  | { type: "error"; error?: APIErrorBody["error"]; counts?: AITagRunCounts };

export type VLMOcrRunCounts = {
  queued: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  cacheHit: number;
  dedup: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type VLMOcrRunEvent =
  | {
      type: "start";
      counts: VLMOcrRunCounts;
      providerName?: string;
      modelName?: string;
    }
  | {
      type: "progress";
      assetId: string;
      repoPath: string;
      status: string;
      counts: VLMOcrRunCounts;
      errorMessage?: string;
    }
  | {
      type: "done";
      counts: VLMOcrRunCounts;
      firstError?: string;
      providerName?: string;
      modelName?: string;
    }
  | { type: "error"; error?: APIErrorBody["error"]; counts?: VLMOcrRunCounts };

export type EmbedRunCounts = {
  queued: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  cacheHit: number;
};

export type EmbedRunEvent =
  | {
      type: "start";
      counts: EmbedRunCounts;
      providerName?: string;
      modelName?: string;
    }
  | {
      type: "progress";
      assetId: string;
      repoPath: string;
      embedType: string;
      status: string;
      counts: EmbedRunCounts;
      errorMessage?: string;
    }
  | {
      type: "done";
      counts: EmbedRunCounts;
      firstError?: string;
      providerName?: string;
      modelName?: string;
    }
  | { type: "phase"; phase: string; total?: number }
  | { type: "translating"; translated?: number; total: number; locale?: string }
  | { type: "error"; error?: APIErrorBody["error"]; counts?: EmbedRunCounts };

export type SemanticSearchResult = {
  assetId: string;
  projectId: string;
  repoPath: string;
  similarity: number;
  thumbnailUrl: string;
};

export type SemanticSearchResponse = {
  results: SemanticSearchResult[];
  queryDurationMs: number;
  totalEmbeddings: number;
};

export type EmbedStats = {
  textCount: number;
  imageCount: number;
  providerName?: string;
  modelName?: string;
  dimensions?: number;
};

export type EmbedRepairCounts = {
  invalidAiTags: number;
  clearedI18nEntries: number;
  deletedStaleTextEmbeddings: number;
  skippedRows: number;
};

export type EmbedRepairResponse = {
  dryRun: boolean;
  apply: boolean;
  counts: EmbedRepairCounts;
};

export type ActionPreview = {
  id: string;
  type: string;
  projectId: string;
  changes: Array<{
    file: string;
    line: number;
    oldSpecifier: string;
    newSpecifier: string;
  }>;
  deletes: string[];
  blockers: Array<{ file: string; line: number; code: string; reason: string }>;
  canApply: boolean;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type APIErrorBody = {
  error: {
    code: string;
    message: string;
    params?: Record<string, unknown>;
  };
};

export type DirectoryListing = {
  path: string;
  parent: string;
  directories: Array<{ name: string; path: string }>;
};

export type BatchResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: string[];
  appliedAt: string;
};

export type RenameRules = {
  lowercase?: boolean;
  replaceChars?: Record<string, string>;
  prefix?: string;
  suffix?: string;
  customBaseNames?: Record<string, string>;
};

export type PromptPresetType =
  | "system"
  | "tag"
  | "ocr"
  | "optimize"
  | "duplicate"
  | "precheck";
export type PromptVariableType = "tags" | "text" | "select";

export type PromptVariable = {
  type: PromptVariableType;
  values: string[];
};

export type PromptPresetContent = {
  template: string;
  variables: Record<string, PromptVariable>;
};

export type PromptPreset = {
  id: string;
  type: PromptPresetType;
  name: string;
  content: PromptPresetContent;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

// --- Tag Management ---

export type TagItem = {
  tag: string;
  count: number;
  categories: string[];
  projects: string[];
};

export type TagListResponse = {
  tags: TagItem[];
  total: number;
  totalTaggedAssets: number;
  topCategory: string;
  translations?: Record<string, string>;
  categoryTranslations?: Record<string, string>;
};

export type AICategoryItem = {
  category: string;
  assetCount: number;
  tagCount: number;
  projectCount: number;
  topTags: string[];
};

export type AICategoryListResponse = {
  categories: AICategoryItem[];
  total: number;
  totalCategorizedAssets: number;
  translations?: Record<string, string>;
  tagTranslations?: Record<string, string>;
};

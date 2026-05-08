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
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
  optimizationThresholds: OptimizationThresholds;
  customAssetFilters: CustomAssetFilter[];
  preferredEditor: string;
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
  | "ocrStatus";

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
  }>;
  ocr?: {
    status: "pending" | "ready" | "failed" | "skipped";
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
  scanIntent?: ProjectScanIntent;
  usageClassification?:
    | "referenced"
    | "unused"
    | "possiblyUnused"
    | "notApplicable";
  deleteUnusedAllowed?: boolean;
  lintApplicability?: "applicable" | "advisory" | "notApplicable";
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
};

export type NearDuplicate = {
  id: string;
  leftId: string;
  rightId: string;
  leftPath: string;
  rightPath: string;
  distance: number;
  flipped: boolean;
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
  "scanId" | "generatedAt" | "projects" | "projectStats" | "stats" | "analysis"
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
    customFilters: Array<{
      id: string;
      label: string;
      count: number;
      usesOCR: boolean;
    }>;
    customFilterTotal: number;
  };
};

export type CatalogDuplicatesPage = {
  groups: DuplicateGroup[];
  pairs: NearDuplicate[];
  total: number;
  nextCursor?: string;
};

export type CatalogLintPage = {
  items: LintFinding[];
  total: number;
  nextCursor?: string;
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
    }
  | {
      type: "done";
      scanId?: number;
      stats?: Catalog["stats"];
      analysis?: Catalog["analysis"];
    }
  | { type: "error"; error?: APIErrorBody["error"] };

export type OCRRunCounts = {
  queued: number;
  processed: number;
  ready: number;
  failed: number;
  skipped: number;
  cacheHit: number;
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
};

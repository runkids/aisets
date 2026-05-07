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
  createdAt?: string;
};

export type AppSettings = {
  workspaceName: string;
  activeWorkspaceId: string;
  defaultProjectRoot: string;
  autoScanOnOpen: boolean;
  scanOnOpen: boolean;
  ocrEnabled: boolean;
  ocrLanguages: string[];
  ocrMaxPixels: number;
  ocrBatchSize: number;
  ocrConcurrency: number;
  excludePatterns: string[];
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
  customAssetFilters: CustomAssetFilter[];
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

export type SettingsUpdate = Partial<AppSettings>;

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
};

export type AssetItem = {
  id: string;
  projectId: string;
  projectName: string;
  repoPath: string;
  localPath: string;
  ext: string;
  bytes: number;
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
  generatedAt: string;
  projects: Project[];
  items: AssetItem[];
  duplicateGroups: DuplicateGroup[];
  nearDuplicates: NearDuplicate[];
  lintFindings: LintFinding[];
  stats: {
    totalFiles: number;
    duplicateGroups: number;
    duplicateFiles: number;
    unusedFiles: number;
    nearDuplicates: number;
    lintFindings: number;
    cacheHits: number;
  };
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
    }
  | { type: "done"; scanId?: number; stats?: Catalog["stats"] }
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

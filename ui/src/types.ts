export type Project = {
  id: string;
  name: string;
  path: string;
};

export type AppSettings = {
  workspaceName: string;
  defaultProjectRoot: string;
  autoScanOnOpen: boolean;
  scanOnOpen: boolean;
  excludePatterns: string[];
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
};

export type SettingsInfo = AppSettings & {
  databasePath: string;
  configDir: string;
  dataDir: string;
  cacheDir: string;
};

export type SettingsUpdate = Partial<AppSettings>;

export type ExportData = {
  version: number;
  exportedAt: string;
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

import type { Project, ProjectScanIntent } from "./project";
import type { AnalysisState } from "./scan";

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
  favorite?: boolean;
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
  severity: "critical" | "warning" | "info" | "advisory";
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
    favoriteFiles?: number;
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
    favoriteFiles?: number;
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
    favoriteCount: number;
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

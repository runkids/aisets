import type { APIErrorBody } from "./actions";
import type { AssetItem } from "./catalog";

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
  matchType?: string;
  matchReasons?: Array<{
    kind: string;
    label: string;
    value?: string;
    score?: number;
  }>;
  item?: AssetItem;
};

export type SemanticSearchResponse = {
  results: SemanticSearchResult[];
  queryDurationMs: number;
  totalEmbeddings: number;
  query?: string;
  translatedQuery?: string;
  thresholds?: {
    text: number;
    image: number;
    imageDynamicEnabled: boolean;
    imageDynamicMargin: number;
  };
};

export type EmbeddingCalibrationLabel = {
  id: number;
  query: string;
  searchType: "text" | "image" | "hybrid";
  assetId: string;
  projectId: string;
  repoPath: string;
  contentHash: string;
  label: "match" | "reject";
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingCalibrationMetric = {
  threshold: number;
  margin?: number;
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
};

export type EmbeddingCalibrationAnalysis = {
  labels: number;
  scored: number;
  skipped: number;
  textRecommendation: EmbeddingCalibrationMetric;
  imageRecommendation: EmbeddingCalibrationMetric;
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

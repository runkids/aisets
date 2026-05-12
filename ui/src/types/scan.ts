import type { APIErrorBody } from "./actions";
import type { Catalog } from "./catalog";

export type ScanProfile = "fast" | "full" | "custom";

export type AnalysisState = "computed" | "notComputed";

export type ScanAnalyses = {
  references: boolean;
  nearDuplicates: boolean;
  optimization: boolean;
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

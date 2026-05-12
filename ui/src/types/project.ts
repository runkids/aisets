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

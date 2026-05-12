import type {
  CatalogDuplicatesParams,
  CatalogFoldersParams,
  CatalogItemsParams,
  CatalogLintParams,
} from "@/api";

export const catalogQueryKey = ["catalog"] as const;
export const scansQueryKey = ["scans"] as const;
export const settingsQueryKey = ["settings"] as const;
export const versionQueryKey = ["version"] as const;
export const embedStatsQueryKey = ["embed-stats"] as const;
export const embedRepairCheckQueryKey = ["embed-repair-check"] as const;

export const catalogKeys = {
  all: catalogQueryKey,
  summary: (workspaceId?: string) =>
    [...catalogQueryKey, "summary", workspaceId ?? "default"] as const,
  items: (scanId: number | undefined, params: CatalogItemsParams) =>
    [
      ...catalogQueryKey,
      "items",
      scanId ?? 0,
      normalizeCatalogItemsParams(params),
    ] as const,
  duplicates: (scanId: number | undefined, params: CatalogDuplicatesParams) =>
    [
      ...catalogQueryKey,
      "duplicates",
      scanId ?? 0,
      normalizeCatalogDuplicatesParams(params),
    ] as const,
  lint: (scanId: number | undefined, params: CatalogLintParams) =>
    [
      ...catalogQueryKey,
      "lint",
      scanId ?? 0,
      normalizeCatalogLintParams(params),
    ] as const,
  folders: (scanId: number | undefined, params: CatalogFoldersParams) =>
    [
      ...catalogQueryKey,
      "folders",
      scanId ?? 0,
      normalizeCatalogFoldersParams(params),
    ] as const,
  item: (scanId: number | undefined, assetId: string) =>
    [...catalogQueryKey, "item", scanId ?? 0, assetId] as const,
};

export const scanKeys = {
  all: scansQueryKey,
  list: () => [...scansQueryKey, "list"] as const,
  diff: (baseId: number | undefined, targetId: number | undefined) =>
    [...scansQueryKey, "diff", baseId ?? 0, targetId ?? 0] as const,
};

function normalizeCatalogItemsParams(params: CatalogItemsParams) {
  return {
    assetId: params.assetId ?? "",
    projectId: params.projectId ?? "",
    projectName: params.projectName ?? "",
    ext: params.ext ?? "",
    folder: params.folder ?? "",
    q: params.q ?? "",
    status: params.status ?? "",
    sort: params.sort ?? "",
    customFilter: params.customFilter ?? "",
    optimizationCategory: params.optimizationCategory ?? "",
    optimizationSeverity: params.optimizationSeverity ?? "",
    operation: params.operation ?? "",
    aiCategory: params.aiCategory ?? "",
    aiOcrStatus: params.aiOcrStatus ?? "",
    hasGPS: params.hasGPS ?? "",
    favorite: params.favorite ?? "",
    limit: params.limit ?? 100,
  };
}

function normalizeCatalogDuplicatesParams(params: CatalogDuplicatesParams) {
  return {
    kind: params.kind ?? "exact",
    projectName: params.projectName ?? "",
    ext: params.ext ?? "",
    limit: params.limit ?? 100,
  };
}

function normalizeCatalogLintParams(params: CatalogLintParams) {
  return {
    projectId: params.projectId ?? "",
    projectName: params.projectName ?? "",
    severity: params.severity ?? "",
    ruleId: params.ruleId ?? "",
    q: params.q ?? "",
    limit: params.limit ?? 100,
  };
}

function normalizeCatalogFoldersParams(params: CatalogFoldersParams) {
  return {
    projectId: params.projectId ?? "",
    projectName: params.projectName ?? "",
    ext: params.ext ?? "",
    folder: params.folder ?? "",
    q: params.q ?? "",
    status: params.status ?? "",
    customFilter: params.customFilter ?? "",
    favorite: params.favorite ?? "",
  };
}

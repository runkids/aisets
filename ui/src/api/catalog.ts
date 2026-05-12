import type {
  AssetItem,
  CatalogDuplicatesPage,
  CatalogFoldersPage,
  CatalogItemDetail,
  CatalogItemsPage,
  CatalogLintPage,
  CatalogSummary,
} from "@/types";
import i18n from "@/i18n";
import { queryString, request } from "./client";

export function getCatalog(options?: { signal?: AbortSignal }) {
  return request<CatalogSummary>("/api/catalog", { signal: options?.signal });
}

export type CatalogItemsParams = {
  scanId?: number;
  assetId?: string;
  projectId?: string;
  projectName?: string;
  ext?: string;
  folder?: string;
  q?: string;
  status?: string;
  sort?: string;
  customFilter?: string;
  optimizationCategory?: string;
  optimizationSeverity?: string;
  operation?: string;
  aiCategory?: string;
  aiOcrStatus?: string;
  hasGPS?: string;
  favorite?: string;
  limit?: number;
  cursor?: string | null;
};

export type CatalogDuplicatesParams = {
  scanId?: number;
  kind?: "exact" | "near";
  projectName?: string;
  ext?: string;
  limit?: number;
  cursor?: string | null;
};

export type CatalogLintParams = {
  scanId?: number;
  projectId?: string;
  projectName?: string;
  severity?: string;
  ruleId?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
};

export function getCatalogItems(
  params: CatalogItemsParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogItemsPage>(
    `/api/catalog/items${queryString({
      lang: i18n.language,
      scanId: params.scanId,
      assetId: params.assetId,
      projectId: params.projectId,
      projectName: params.projectName,
      ext: params.ext,
      folder: params.folder,
      q: params.q,
      status: params.status,
      sort: params.sort,
      customFilter: params.customFilter,
      optimizationCategory: params.optimizationCategory,
      optimizationSeverity: params.optimizationSeverity,
      operation: params.operation,
      aiCategory: params.aiCategory,
      aiOcrStatus: params.aiOcrStatus,
      hasGPS: params.hasGPS,
      favorite: params.favorite,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export function getCatalogDuplicates(
  params: CatalogDuplicatesParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogDuplicatesPage>(
    `/api/catalog/duplicates${queryString({
      scanId: params.scanId,
      kind: params.kind,
      projectName: params.projectName,
      ext: params.ext,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export function getCatalogLint(
  params: CatalogLintParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogLintPage>(
    `/api/catalog/lint${queryString({
      scanId: params.scanId,
      projectId: params.projectId,
      projectName: params.projectName,
      severity: params.severity,
      ruleId: params.ruleId,
      q: params.q,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
    { signal: options?.signal },
  );
}

export type CatalogFoldersParams = {
  scanId?: number;
  projectId?: string;
  projectName?: string;
  ext?: string;
  folder?: string;
  q?: string;
  status?: string;
  customFilter?: string;
  favorite?: string;
};

export function getCatalogFolders(
  params: CatalogFoldersParams,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogFoldersPage>(
    `/api/catalog/folders${queryString({
      lang: i18n.language,
      scanId: params.scanId,
      projectId: params.projectId,
      projectName: params.projectName,
      ext: params.ext,
      folder: params.folder,
      q: params.q,
      status: params.status,
      customFilter: params.customFilter,
      favorite: params.favorite,
    })}`,
    { signal: options?.signal },
  );
}

export function setCatalogItemFavorite(
  assetId: string,
  favorite: boolean,
  scanId?: number,
) {
  return request<{ item: AssetItem }>(
    `/api/catalog/items/${encodeURIComponent(assetId)}/favorite${queryString({
      scanId,
    })}`,
    { method: favorite ? "POST" : "DELETE" },
  );
}

export function setCatalogItemsFavorite(
  assetIds: string[],
  favorite: boolean,
  scanId?: number,
) {
  return request<{ items: AssetItem[] }>("/api/catalog/favorites", {
    method: "POST",
    body: JSON.stringify({ scanId, assetIds, favorite }),
  });
}

export function getCatalogItemDetail(
  scanId: number | undefined,
  assetId: string,
  options?: { signal?: AbortSignal },
) {
  return request<CatalogItemDetail>(
    `/api/catalog/items/${assetId}${queryString({
      lang: i18n.language,
      scanId,
    })}`,
    { signal: options?.signal },
  );
}

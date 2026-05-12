import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  getCatalog,
  getCatalogDuplicates,
  getCatalogFolders,
  getCatalogItemDetail,
  getCatalogItems,
  getCatalogLint,
  getScanDiff,
  getScans,
  listDirectories,
} from "@/api";
import type {
  CatalogDuplicatesParams,
  CatalogFoldersParams,
  CatalogItemsParams,
  CatalogLintParams,
} from "@/api";
import { catalogKeys, scanKeys } from "./queryKeys";

export function directoryListingQueryOptions(path: string, enabled: boolean) {
  return {
    queryKey: ["directories", path] as const,
    queryFn: () => listDirectories(path),
    enabled,
    retry: false,
  };
}

export function useDirectoryListingQuery(path: string, enabled: boolean) {
  return useQuery(directoryListingQueryOptions(path, enabled));
}

export function useCatalogSummaryQuery(workspaceId?: string) {
  return useQuery({
    queryKey: catalogKeys.summary(workspaceId),
    queryFn: ({ signal }) => getCatalog({ signal }),
    staleTime: 30_000,
  });
}

export const useCatalogQuery = useCatalogSummaryQuery;

export function useScansQuery() {
  return useQuery({
    queryKey: scanKeys.list(),
    queryFn: ({ signal }) => getScans({ signal }),
  });
}

export function useScanDiffQuery(
  baseId: number | undefined,
  targetId: number | undefined,
) {
  return useQuery({
    queryKey: scanKeys.diff(baseId, targetId),
    queryFn: ({ signal }) => getScanDiff(baseId!, targetId!, { signal }),
    enabled: baseId != null && targetId != null && baseId !== targetId,
  });
}

export function useCatalogItemsInfiniteQuery(
  scanId: number | undefined,
  params: CatalogItemsParams,
  enabled = true,
  maxPages = 8,
) {
  return useInfiniteQuery({
    queryKey: catalogKeys.items(scanId, params),
    queryFn: ({ pageParam, signal }) =>
      getCatalogItems(
        { ...params, scanId, cursor: pageParam, limit: params.limit ?? 100 },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor || undefined,
    ...(maxPages > 0 ? { maxPages } : {}),
    enabled: enabled && scanId != null,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCatalogLintInfiniteQuery(
  scanId: number | undefined,
  params: CatalogLintParams,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: catalogKeys.lint(scanId, params),
    queryFn: ({ pageParam, signal }) =>
      getCatalogLint(
        { ...params, scanId, cursor: pageParam, limit: params.limit ?? 100 },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: enabled && scanId != null,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCatalogDuplicatesInfiniteQuery(
  scanId: number | undefined,
  params: CatalogDuplicatesParams,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: catalogKeys.duplicates(scanId, params),
    queryFn: ({ pageParam, signal }) =>
      getCatalogDuplicates(
        { ...params, scanId, cursor: pageParam, limit: params.limit ?? 100 },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: enabled && scanId != null,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCatalogItemDetailQuery(
  scanId: number | undefined,
  assetId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: catalogKeys.item(scanId, assetId),
    queryFn: ({ signal }) => getCatalogItemDetail(scanId, assetId, { signal }),
    enabled: enabled && scanId != null && assetId !== "",
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}

export function useCatalogFoldersQuery(
  scanId: number | undefined,
  params: CatalogFoldersParams,
  enabled = true,
) {
  return useQuery({
    queryKey: catalogKeys.folders(scanId, params),
    queryFn: ({ signal }) =>
      getCatalogFolders({ ...params, scanId }, { signal }),
    enabled: enabled && scanId != null,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  addProject,
  addWorkspace,
  applyPreview,
  batchApply,
  batchDelete,
  batchCopy,
  batchMergePreview,
  batchMovePreview,
  batchRenamePreview,
  checkLLMHealth,
  clearAITagCache,
  clearEmbeddings,
  clearOCRCache,
  detectAgentCLIs,
  clearScanHistory,
  deleteUnusedPreview,
  fetchLLMModels,
  fetchScanStatus,
  getCatalog,
  getCatalogDuplicates,
  getCatalogFolders,
  getCatalogItemDetail,
  getCatalogItems,
  getCatalogLint,
  getScanDiff,
  getScans,
  getSettings,
  getVersionCheck,
  importSettings,
  installOCR,
  listDirectories,
  removeOCR,
  removeProject,
  removeWorkspace,
  repairEmbeddings,
  renamePreview,
  renameProject,
  renameWorkspace,
  resetDatabase,
  runAITagging,
  runOCR,
  runVLMOcr,
  scanCatalog,
  switchWorkspace,
  updateApp,
  updateSettings,
  listPromptPresets,
  createPromptPreset,
  updatePromptPreset,
  deletePromptPreset,
  setPromptPresetDefault,
  setCatalogItemFavorite,
  setCatalogItemsFavorite,
} from "./api";
import type {
  CatalogDuplicatesParams,
  CatalogFoldersParams,
  CatalogItemsParams,
  CatalogLintParams,
} from "./api";
import type {
  AITagRunEvent,
  ExportData,
  AssetItem,
  CatalogItemDetail,
  CatalogItemsPage,
  CatalogSummary,
  OCRRunEvent,
  VLMOcrRunEvent,
  ProjectScanIntent,
  PromptPresetType,
  RenameRules,
  ScanAnalyses,
  ScanEvent,
  ScanProfile,
  SemanticSearchResponse,
  SettingsUpdate,
} from "./types";

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

type ScanMutationInput = {
  profile?: ScanProfile;
  analyses?: Partial<ScanAnalyses>;
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

type FavoriteOptimisticChange = {
  ids: Set<string>;
  favorite: boolean;
};

type FavoriteOptimisticSnapshot = {
  catalog: Array<[QueryKey, unknown]>;
  semantic: Array<[QueryKey, unknown]>;
};

function favoriteDelta(item: AssetItem, change: FavoriteOptimisticChange) {
  if (!change.ids.has(item.id)) return 0;
  const current = Boolean(item.favorite);
  if (current === change.favorite) return 0;
  return change.favorite ? 1 : -1;
}

function updateAssetFavorite<T extends AssetItem>(
  item: T,
  change: FavoriteOptimisticChange,
): T {
  if (!change.ids.has(item.id)) return item;
  if (Boolean(item.favorite) === change.favorite) return item;
  return { ...item, favorite: change.favorite };
}

function updateAssetListFavorite<T extends AssetItem>(
  items: T[],
  change: FavoriteOptimisticChange,
) {
  let delta = 0;
  let changed = false;
  const nextItems = items.map((item) => {
    const itemDelta = favoriteDelta(item, change);
    if (itemDelta === 0) return item;
    delta += itemDelta;
    changed = true;
    return updateAssetFavorite(item, change);
  });
  return { changed, delta, items: changed ? nextItems : items };
}

// eslint-disable-next-line react-refresh/only-export-components
export function applyFavoriteUpdateToCatalogItemsPage(
  page: CatalogItemsPage,
  change: FavoriteOptimisticChange,
  favoriteFilter = false,
) {
  const updated = updateAssetListFavorite(page.items, change);
  if (!updated.changed) return page;

  const items = favoriteFilter
    ? updated.items.filter((item) => Boolean(item.favorite))
    : updated.items;
  const removedFromFavoriteFilter = page.items.length - items.length;

  return {
    ...page,
    items,
    total: favoriteFilter
      ? Math.max(0, page.total - removedFromFavoriteFilter)
      : page.total,
    facets: {
      ...page.facets,
      favoriteCount: Math.max(0, page.facets.favoriteCount + updated.delta),
    },
  };
}

function updateCatalogItemsData(
  data: InfiniteData<CatalogItemsPage> | undefined,
  change: FavoriteOptimisticChange,
  favoriteFilter: boolean,
) {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = applyFavoriteUpdateToCatalogItemsPage(
      page,
      change,
      favoriteFilter,
    );
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...data, pages } : data;
}

function updateCatalogItemDetailData(
  data: CatalogItemDetail | undefined,
  change: FavoriteOptimisticChange,
) {
  if (!data) return data;
  const item = updateAssetFavorite(data.item, change);
  const duplicates = updateAssetListFavorite(data.duplicates, change);
  const similarItems = updateAssetListFavorite(data.similarItems, change);
  if (item === data.item && !duplicates.changed && !similarItems.changed) {
    return data;
  }
  return {
    ...data,
    item,
    duplicates: duplicates.items,
    similarItems: similarItems.items,
  };
}

function collectKnownFavoriteItems(
  snapshots: Array<[QueryKey, unknown]>,
  out = new Map<string, AssetItem>(),
) {
  for (const [, data] of snapshots) {
    if (!data || typeof data !== "object") continue;
    const maybeInfinite = data as { pages?: CatalogItemsPage[] };
    if (Array.isArray(maybeInfinite.pages)) {
      for (const page of maybeInfinite.pages) {
        for (const item of page.items ?? []) out.set(item.id, item);
      }
      continue;
    }
    const maybeDetail = data as CatalogItemDetail;
    if (maybeDetail.item?.id) out.set(maybeDetail.item.id, maybeDetail.item);
    for (const item of maybeDetail.duplicates ?? []) out.set(item.id, item);
    for (const item of maybeDetail.similarItems ?? []) out.set(item.id, item);

    const maybeSemantic = data as SemanticSearchResponse;
    for (const result of maybeSemantic.results ?? []) {
      if (result.item) out.set(result.item.id, result.item);
    }
  }
  return out;
}

function updateCatalogSummaryData(
  data: CatalogSummary | undefined,
  change: FavoriteOptimisticChange,
  knownItems: Map<string, AssetItem>,
) {
  if (!data) return data;
  let totalDelta = 0;
  const projectDeltas = new Map<string, number>();
  for (const id of change.ids) {
    const item = knownItems.get(id);
    if (!item) continue;
    const delta = favoriteDelta(item, change);
    if (delta === 0) continue;
    totalDelta += delta;
    projectDeltas.set(
      item.projectId,
      (projectDeltas.get(item.projectId) ?? 0) + delta,
    );
  }
  if (totalDelta === 0) return data;
  return {
    ...data,
    stats: {
      ...data.stats,
      favoriteFiles: Math.max(0, (data.stats.favoriteFiles ?? 0) + totalDelta),
    },
    projectStats: data.projectStats.map((stats) => {
      const delta = projectDeltas.get(stats.projectId) ?? 0;
      if (delta === 0) return stats;
      return {
        ...stats,
        favoriteFiles: Math.max(0, (stats.favoriteFiles ?? 0) + delta),
      };
    }),
  };
}

function updateSemanticSearchData(
  data: SemanticSearchResponse | undefined,
  change: FavoriteOptimisticChange,
) {
  if (!data) return data;
  let changed = false;
  const results = data.results.map((result) => {
    if (!result.item) return result;
    const item = updateAssetFavorite(result.item, change);
    if (item === result.item) return result;
    changed = true;
    return { ...result, item };
  });
  return changed ? { ...data, results } : data;
}

function catalogKeySection(queryKey: QueryKey) {
  return Array.isArray(queryKey) ? queryKey[1] : undefined;
}

function catalogItemsFavoriteFilter(queryKey: QueryKey) {
  if (!Array.isArray(queryKey)) return false;
  const params = queryKey[3];
  return (
    params != null &&
    typeof params === "object" &&
    "favorite" in params &&
    (params as { favorite?: unknown }).favorite === "true"
  );
}

async function applyFavoriteOptimisticUpdate(
  client: QueryClient,
  change: FavoriteOptimisticChange,
): Promise<FavoriteOptimisticSnapshot> {
  await Promise.all([
    client.cancelQueries({ queryKey: catalogQueryKey }),
    client.cancelQueries({ queryKey: ["browse-semantic-search"] }),
  ]);

  const snapshot: FavoriteOptimisticSnapshot = {
    catalog: client.getQueriesData({ queryKey: catalogQueryKey }),
    semantic: client.getQueriesData({ queryKey: ["browse-semantic-search"] }),
  };
  const knownItems = collectKnownFavoriteItems([
    ...snapshot.catalog,
    ...snapshot.semantic,
  ]);

  for (const [queryKey, data] of snapshot.catalog) {
    switch (catalogKeySection(queryKey)) {
      case "items":
        client.setQueryData(
          queryKey,
          updateCatalogItemsData(
            data as InfiniteData<CatalogItemsPage> | undefined,
            change,
            catalogItemsFavoriteFilter(queryKey),
          ),
        );
        break;
      case "item":
        client.setQueryData(
          queryKey,
          updateCatalogItemDetailData(
            data as CatalogItemDetail | undefined,
            change,
          ),
        );
        break;
      case "summary":
        client.setQueryData(
          queryKey,
          updateCatalogSummaryData(
            data as CatalogSummary | undefined,
            change,
            knownItems,
          ),
        );
        break;
    }
  }

  for (const [queryKey, data] of snapshot.semantic) {
    client.setQueryData(
      queryKey,
      updateSemanticSearchData(
        data as SemanticSearchResponse | undefined,
        change,
      ),
    );
  }

  return snapshot;
}

function restoreFavoriteOptimisticSnapshot(
  client: QueryClient,
  snapshot: FavoriteOptimisticSnapshot | undefined,
) {
  if (!snapshot) return;
  for (const [queryKey, data] of snapshot.catalog) {
    client.setQueryData(queryKey, data);
  }
  for (const [queryKey, data] of snapshot.semantic) {
    client.setQueryData(queryKey, data);
  }
}

export function useFavoriteAssetMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetId,
      favorite,
      scanId,
    }: {
      assetId: string;
      favorite: boolean;
      scanId?: number;
    }) => setCatalogItemFavorite(assetId, favorite, scanId),
    onMutate: async ({ assetId, favorite }) =>
      applyFavoriteOptimisticUpdate(client, {
        ids: new Set([assetId]),
        favorite,
      }),
    onError: (_error, _variables, snapshot) => {
      restoreFavoriteOptimisticSnapshot(client, snapshot);
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: ["browse-semantic-search"] }),
      ]);
    },
  });
}

export function useFavoriteAssetsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetIds,
      favorite,
      scanId,
    }: {
      assetIds: string[];
      favorite: boolean;
      scanId?: number;
    }) => setCatalogItemsFavorite(assetIds, favorite, scanId),
    onMutate: async ({ assetIds, favorite }) =>
      applyFavoriteOptimisticUpdate(client, {
        ids: new Set(assetIds),
        favorite,
      }),
    onError: (_error, _variables, snapshot) => {
      restoreFavoriteOptimisticSnapshot(client, snapshot);
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: ["browse-semantic-search"] }),
      ]);
    },
  });
}

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

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: getSettings,
  });
}

export function useVersionQuery() {
  return useQuery({
    queryKey: versionQueryKey,
    queryFn: getVersionCheck,
  });
}

export function useUpdateAppMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateApp,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: versionQueryKey });
    },
  });
}

const scanStatusQueryKey = ["scanStatus"] as const;

export function useScanStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: scanStatusQueryKey,
    queryFn: fetchScanStatus,
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });
}

export function useScanCatalogMutation(options?: {
  onEvent?: (event: ScanEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input?: ScanMutationInput) =>
      scanCatalog({
        onEvent: options?.onEvent,
        profile: input?.profile,
        analyses: input?.analyses,
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: scansQueryKey }),
      ]);
    },
  });
}

export function useRunOCRMutation(options?: {
  onEvent?: (event: OCRRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runOCR({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useRunAITagMutation(options?: {
  onEvent?: (event: AITagRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runAITagging({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useRunVLMOcrMutation(options?: {
  onEvent?: (event: VLMOcrRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runVLMOcr({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useInstallOCRMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (languages: string[]) => installOCR(languages),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

export function useRemoveOCRMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (languages?: string[]) => removeOCR(languages),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useAddProjectMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      scanIntent,
    }: {
      path: string;
      scanIntent: ProjectScanIntent;
    }) => addProject(path, scanIntent),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

export function useRenamePreviewMutation() {
  return useMutation({
    mutationFn: ({
      assetId,
      targetPath,
    }: {
      assetId: string;
      targetPath: string;
    }) => renamePreview(assetId, targetPath),
  });
}

export function useDeleteUnusedPreviewMutation() {
  return useMutation({
    mutationFn: (assetId: string) => deleteUnusedPreview(assetId),
  });
}

export function useApplyPreviewMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      endpoint,
      token,
    }: {
      endpoint: string;
      token: string;
    }) => {
      await applyPreview(endpoint, token);
      return scanCatalog();
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

function invalidateWorkspaceScope(client: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    client.invalidateQueries({ queryKey: catalogQueryKey }),
    client.invalidateQueries({ queryKey: settingsQueryKey }),
    client.invalidateQueries({ queryKey: embedStatsQueryKey }),
    client.invalidateQueries({ queryKey: ["tags"] }),
  ]);
}

export function useAddWorkspaceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, iconImage }: { name: string; iconImage?: string }) =>
      addWorkspace(name, iconImage),
    onSuccess: async () => {
      await invalidateWorkspaceScope(client);
    },
  });
}

export function useSwitchWorkspaceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => switchWorkspace(id),
    onSuccess: async () => {
      await invalidateWorkspaceScope(client);
    },
  });
}

export function useRenameWorkspaceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      name,
      iconImage,
    }: {
      id: string;
      name: string;
      iconImage?: string;
    }) => renameWorkspace(id, name, iconImage),
    onSuccess: async () => {
      await invalidateWorkspaceScope(client);
    },
  });
}

export function useRemoveWorkspaceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeWorkspace(id),
    onSuccess: async () => {
      await invalidateWorkspaceScope(client);
    },
  });
}

export function useImportSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: ExportData) => importSettings(data),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
      await client.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

export function useUpdateSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: SettingsUpdate) => updateSettings(data),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useDetectAgentCLIsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: detectAgentCLIs,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

export function useResetDatabaseMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: resetDatabase,
    onSuccess: async () => {
      const resetKeys = [
        catalogQueryKey,
        scansQueryKey,
        settingsQueryKey,
        embedStatsQueryKey,
        ["prompt-presets"],
        ["tags"],
        ["browse-semantic-search"],
      ];
      for (const queryKey of resetKeys) {
        client.removeQueries({ queryKey });
      }
      await Promise.all(
        resetKeys.map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    },
  });
}

export function useClearScanHistoryMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearScanHistory,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: scansQueryKey }),
        client.invalidateQueries({ queryKey: settingsQueryKey }),
      ]);
    },
  });
}

export function useClearOCRCacheMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearOCRCache,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useClearAITagCacheMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearAITagCache,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useClearEmbeddingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearEmbeddings,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: embedStatsQueryKey }),
      ]);
    },
  });
}

export function useEmbedRepairCheckQuery(enabled: boolean) {
  return useQuery({
    queryKey: embedRepairCheckQueryKey,
    queryFn: () => repairEmbeddings(false),
    enabled,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}

export function useRepairEmbeddingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (apply: boolean) => repairEmbeddings(apply),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: embedStatsQueryKey }),
        client.invalidateQueries({ queryKey: embedRepairCheckQueryKey }),
      ]);
    },
  });
}

export function useRemoveProjectMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeProject(id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: settingsQueryKey }),
      ]);
    },
  });
}

export function useRenameProjectMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      name,
      iconImage,
      scanIntent,
    }: {
      id: string;
      name: string;
      iconImage?: string;
      scanIntent: ProjectScanIntent;
    }) => renameProject(id, name, iconImage, scanIntent),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: settingsQueryKey }),
      ]);
    },
  });
}

export function useBatchDeleteMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assetIds: string[]) => batchDelete(assetIds),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useBatchMovePreviewMutation() {
  return useMutation({
    mutationFn: ({
      assetIds,
      targetDir,
    }: {
      assetIds: string[];
      targetDir: string;
    }) => batchMovePreview(assetIds, targetDir),
  });
}

export function useBatchRenamePreviewMutation() {
  return useMutation({
    mutationFn: ({
      assetIds,
      rules,
    }: {
      assetIds: string[];
      rules: RenameRules;
    }) => batchRenamePreview(assetIds, rules),
  });
}

export function useBatchMergePreviewMutation() {
  return useMutation({
    mutationFn: ({
      assetIds,
      preferredPaths,
    }: {
      assetIds: string[];
      preferredPaths: Record<string, string>;
    }) => batchMergePreview(assetIds, preferredPaths),
  });
}

export function useBatchApplyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ endpoint, token }: { endpoint: string; token: string }) =>
      batchApply(endpoint, token),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useBatchCopyMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetIds,
      targetDir,
    }: {
      assetIds: string[];
      targetDir: string;
    }) => batchCopy(assetIds, targetDir),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useLLMModelsQuery(
  enabled: boolean,
  params?: { provider: string; endpoint: string; apiKey?: string },
) {
  return useQuery({
    queryKey: [
      "llm-models",
      params?.provider,
      params?.endpoint,
      params?.apiKey,
    ],
    queryFn: () => fetchLLMModels(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useLLMHealthMutation() {
  return useMutation({
    mutationFn: checkLLMHealth,
  });
}

export function usePromptPresetsQuery(type?: PromptPresetType) {
  return useQuery({
    queryKey: ["prompt-presets", type ?? "all"],
    queryFn: () => listPromptPresets(type),
    staleTime: 30_000,
  });
}

export function useCreatePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPromptPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompt-presets"] }),
  });
}

export function useUpdatePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: Parameters<typeof updatePromptPreset>[1] & { id: string }) =>
      updatePromptPreset(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-presets"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useDeletePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePromptPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompt-presets"] }),
  });
}

export function useSetPromptPresetDefaultMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setPromptPresetDefault,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-presets"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

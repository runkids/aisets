import {
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
  OCRRunEvent,
  VLMOcrRunEvent,
  ProjectScanIntent,
  PromptPresetType,
  RenameRules,
  ScanAnalyses,
  ScanEvent,
  ScanProfile,
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
  };
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
      await client.invalidateQueries({ queryKey: catalogQueryKey });
      await client.invalidateQueries({ queryKey: settingsQueryKey });
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

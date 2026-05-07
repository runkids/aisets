import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProject,
  addWorkspace,
  applyPreview,
  batchApply,
  batchDelete,
  batchMovePreview,
  batchRenamePreview,
  deleteUnusedPreview,
  getCatalog,
  getSettings,
  importSettings,
  installOCR,
  listDirectories,
  removeOCR,
  removeProject,
  removeWorkspace,
  renamePreview,
  renameProject,
  renameWorkspace,
  resetDatabase,
  runOCR,
  scanCatalog,
  switchWorkspace,
  updateSettings,
} from "./api";
import type {
  ExportData,
  OCRRunEvent,
  RenameRules,
  ScanEvent,
  SettingsUpdate,
} from "./types";

export const catalogQueryKey = ["catalog"] as const;
export const settingsQueryKey = ["settings"] as const;

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

export function useCatalogQuery() {
  return useQuery({
    queryKey: catalogQueryKey,
    queryFn: getCatalog,
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: getSettings,
  });
}

export function useScanCatalogMutation(options?: {
  onEvent?: (event: ScanEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => scanCatalog({ onEvent: options?.onEvent }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
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
    mutationFn: async (path: string) => {
      await addProject(path);
      return scanCatalog();
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
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
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProject(id, name),
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

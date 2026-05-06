import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProject,
  applyPreview,
  deleteUnusedPreview,
  getCatalog,
  getSettings,
  importSettings,
  listDirectories,
  removeProject,
  renamePreview,
  renameProject,
  resetDatabase,
  scanCatalog,
  updateSettings,
} from "./api";
import type { ExportData, SettingsUpdate } from "./types";

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

export function useScanCatalogMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: scanCatalog,
    onSuccess: async () => {
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
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useRenameProjectMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProject(id, name),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

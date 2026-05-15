import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProject,
  addWorkspace,
  detectAgentCLIs,
  getSettings,
  getVersionCheck,
  importSettings,
  removeProject,
  removeWorkspace,
  renameProject,
  renameWorkspace,
  resetDatabase,
  restartApp,
  switchWorkspace,
  updateApp,
  updateSettings,
} from "@/api";
import type { ExportData, ProjectScanIntent, SettingsUpdate } from "@/types";
import {
  catalogQueryKey,
  embedStatsQueryKey,
  scansQueryKey,
  settingsQueryKey,
  versionQueryKey,
} from "./queryKeys";

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

export function useRestartAppMutation() {
  return useMutation({ mutationFn: restartApp });
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

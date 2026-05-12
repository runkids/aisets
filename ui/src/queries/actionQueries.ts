import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  applyPreview,
  batchApply,
  batchCopy,
  batchDelete,
  batchMergePreview,
  batchMovePreview,
  batchRenamePreview,
  deleteUnusedPreview,
  renamePreview,
  scanCatalog,
} from "@/api";
import type { RenameRules } from "@/types";
import { catalogQueryKey } from "./queryKeys";

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

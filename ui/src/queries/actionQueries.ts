import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
} from "@/api";
import type {
  AssetItem,
  CatalogDuplicatesPage,
  CatalogItemDetail,
  CatalogItemsPage,
  CatalogLintPage,
  CatalogSummary,
  RenameRules,
  SemanticSearchResponse,
} from "@/types";
import { catalogKeySection, catalogQueryKey } from "./queryKeys";
import { collectKnownItems } from "./favorites";

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
    mutationFn: ({ endpoint, token }: { endpoint: string; token: string }) =>
      applyPreview(endpoint, token),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

type DeleteOptimisticSnapshot = {
  catalog: Array<[QueryKey, unknown]>;
  semantic: Array<[QueryKey, unknown]>;
};

export function applyDeleteUpdateToCatalogItemsPage(
  page: CatalogItemsPage,
  deletedIds: Set<string>,
) {
  const items = page.items.filter((item) => !deletedIds.has(item.id));
  const removed = page.items.length - items.length;
  if (removed === 0) return page;
  return {
    ...page,
    items,
    total: Math.max(0, page.total - removed),
  };
}

function removeDeletedFromItems(
  data: InfiniteData<CatalogItemsPage> | undefined,
  deletedIds: Set<string>,
) {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const next = applyDeleteUpdateToCatalogItemsPage(page, deletedIds);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...data, pages } : data;
}

function removeDeletedFromDetail(
  data: CatalogItemDetail | undefined,
  deletedIds: Set<string>,
) {
  if (!data) return data;
  if (deletedIds.has(data.item.id)) return undefined;
  const duplicates = data.duplicates.filter((d) => !deletedIds.has(d.id));
  const similarItems = data.similarItems.filter((s) => !deletedIds.has(s.id));
  const similar = data.similar.filter(
    (s) => !deletedIds.has(s.leftId) && !deletedIds.has(s.rightId),
  );
  if (
    duplicates.length === data.duplicates.length &&
    similarItems.length === data.similarItems.length &&
    similar.length === data.similar.length
  ) {
    return data;
  }
  return { ...data, duplicates, similarItems, similar };
}

function removeDeletedFromDuplicates(
  data: InfiniteData<CatalogDuplicatesPage> | undefined,
  deletedIds: Set<string>,
) {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const groups = page.groups
      .map((group) => {
        const members = group.members?.filter((m) => !deletedIds.has(m.id));
        const paths = group.paths.filter(
          (_, i) => !group.members || !deletedIds.has(group.members[i]?.id),
        );
        if (members?.length === group.members?.length) return group;
        return { ...group, members, paths };
      })
      .filter((group) => (group.members?.length ?? 0) >= 2);

    const pairs = page.pairs.filter(
      (p) => !deletedIds.has(p.leftId) && !deletedIds.has(p.rightId),
    );

    const groupsRemoved = page.groups.length - groups.length;
    const filesRemoved =
      page.groups.reduce((n, g) => n + (g.members?.length ?? 0), 0) -
      groups.reduce((n, g) => n + (g.members?.length ?? 0), 0);

    if (groupsRemoved === 0 && pairs.length === page.pairs.length) return page;
    changed = true;
    return {
      ...page,
      groups,
      pairs,
      total: Math.max(0, page.total - groupsRemoved),
      totalFiles: Math.max(0, page.totalFiles - filesRemoved),
    };
  });
  return changed ? { ...data, pages } : data;
}

function removeDeletedFromLint(
  data: InfiniteData<CatalogLintPage> | undefined,
  deletedIds: Set<string>,
) {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const items = page.items.filter(
      (f) => !f.assetId || !deletedIds.has(f.assetId),
    );
    const removed = page.items.length - items.length;
    if (removed === 0) return page;
    changed = true;
    return { ...page, items, total: Math.max(0, page.total - removed) };
  });
  return changed ? { ...data, pages } : data;
}

function removeDeletedFromSummary(
  data: CatalogSummary | undefined,
  deletedIds: Set<string>,
  knownItems: Map<string, AssetItem>,
) {
  if (!data) return data;
  let totalDelta = 0;
  const projectDeltas = new Map<string, number>();
  for (const id of deletedIds) {
    const item = knownItems.get(id);
    if (!item) continue;
    totalDelta++;
    projectDeltas.set(
      item.projectId,
      (projectDeltas.get(item.projectId) ?? 0) + 1,
    );
  }
  if (totalDelta === 0) return data;
  return {
    ...data,
    stats: {
      ...data.stats,
      totalFiles: Math.max(0, data.stats.totalFiles - totalDelta),
    },
    projectStats: data.projectStats.map((stats) => {
      const delta = projectDeltas.get(stats.projectId) ?? 0;
      if (delta === 0) return stats;
      return {
        ...stats,
        totalFiles: Math.max(0, stats.totalFiles - delta),
      };
    }),
  };
}

function removeDeletedFromSemanticSearch(
  data: SemanticSearchResponse | undefined,
  deletedIds: Set<string>,
) {
  if (!data) return data;
  const results = data.results.filter(
    (r) => !r.item || !deletedIds.has(r.item.id),
  );
  if (results.length === data.results.length) return data;
  return { ...data, results };
}

async function applyDeleteOptimisticUpdate(
  client: QueryClient,
  deletedIds: Set<string>,
): Promise<DeleteOptimisticSnapshot> {
  await Promise.all([
    client.cancelQueries({ queryKey: catalogQueryKey }),
    client.cancelQueries({ queryKey: ["browse-semantic-search"] }),
  ]);

  const snapshot: DeleteOptimisticSnapshot = {
    catalog: client.getQueriesData({ queryKey: catalogQueryKey }),
    semantic: client.getQueriesData({ queryKey: ["browse-semantic-search"] }),
  };
  const knownItems = collectKnownItems([
    ...snapshot.catalog,
    ...snapshot.semantic,
  ]);

  for (const [queryKey, data] of snapshot.catalog) {
    switch (catalogKeySection(queryKey)) {
      case "items":
        client.setQueryData(
          queryKey,
          removeDeletedFromItems(
            data as InfiniteData<CatalogItemsPage> | undefined,
            deletedIds,
          ),
        );
        break;
      case "item":
        client.setQueryData(
          queryKey,
          removeDeletedFromDetail(
            data as CatalogItemDetail | undefined,
            deletedIds,
          ),
        );
        break;
      case "summary":
        client.setQueryData(
          queryKey,
          removeDeletedFromSummary(
            data as CatalogSummary | undefined,
            deletedIds,
            knownItems,
          ),
        );
        break;
      case "duplicates":
        client.setQueryData(
          queryKey,
          removeDeletedFromDuplicates(
            data as InfiniteData<CatalogDuplicatesPage> | undefined,
            deletedIds,
          ),
        );
        break;
      case "lint":
        client.setQueryData(
          queryKey,
          removeDeletedFromLint(
            data as InfiniteData<CatalogLintPage> | undefined,
            deletedIds,
          ),
        );
        break;
    }
  }

  for (const [queryKey, data] of snapshot.semantic) {
    client.setQueryData(
      queryKey,
      removeDeletedFromSemanticSearch(
        data as SemanticSearchResponse | undefined,
        deletedIds,
      ),
    );
  }

  return snapshot;
}

function restoreDeleteOptimisticSnapshot(
  client: QueryClient,
  snapshot: DeleteOptimisticSnapshot | undefined,
) {
  if (!snapshot) return;
  for (const [queryKey, data] of snapshot.catalog) {
    client.setQueryData(queryKey, data);
  }
  for (const [queryKey, data] of snapshot.semantic) {
    client.setQueryData(queryKey, data);
  }
}

export function useBatchDeleteMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assetIds: string[]) => batchDelete(assetIds),
    onMutate: async (assetIds) =>
      applyDeleteOptimisticUpdate(client, new Set(assetIds)),
    onError: (_error, _variables, snapshot) => {
      restoreDeleteOptimisticSnapshot(client, snapshot);
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: ["browse-semantic-search"] }),
      ]);
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

import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { setCatalogItemFavorite, setCatalogItemsFavorite } from "@/api";
import type {
  AssetItem,
  CatalogItemDetail,
  CatalogItemsPage,
  CatalogSummary,
  SemanticSearchResponse,
} from "@/types";
import { catalogKeySection, catalogQueryKey } from "./queryKeys";

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

export function collectKnownItems(
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
  const knownItems = collectKnownItems([
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

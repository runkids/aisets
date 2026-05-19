import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  clearCategories,
  deleteTags,
  getCategoryList,
  getTagCategories,
  getTagList,
  getTagSuggestions,
  mergeCategories,
  mergeTags,
  renameCategory,
  renameTag,
  setAssetDescription,
  setAssetOcrText,
  setAssetTags,
} from "./api";
import { catalogQueryKey } from "./queries";

export type TagListParams = {
  q?: string;
  sort?: string;
  project?: string;
  category?: string;
  locale?: string;
  limit?: number;
  offset?: number;
};

export type AICategoryListParams = {
  q?: string;
  sort?: string;
  locale?: string;
  limit?: number;
  offset?: number;
};

function normalizeTagListParams(params: TagListParams) {
  return {
    q: params.q || "",
    sort: params.sort || "count",
    project: params.project || "",
    category: params.category || "",
    locale: params.locale || "",
    limit: params.limit || 100,
    offset: params.offset || 0,
  };
}

function normalizeCategoryListParams(params: AICategoryListParams) {
  return {
    q: params.q || "",
    sort: params.sort || "count",
    locale: params.locale || "",
    limit: params.limit || 100,
    offset: params.offset || 0,
  };
}

export const tagKeys = {
  all: ["tags"] as const,
  list: (params: TagListParams) =>
    ["tags", "list", normalizeTagListParams(params)] as const,
  categoryList: (params: AICategoryListParams) =>
    ["tags", "category-list", normalizeCategoryListParams(params)] as const,
  suggest: (q: string) => ["tags", "suggest", q] as const,
  categories: ["tags", "categories"] as const,
};

export function useTagsQuery(params: TagListParams, enabled = true) {
  return useQuery({
    queryKey: tagKeys.list(params),
    queryFn: () => getTagList(normalizeTagListParams(params)),
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTagCategoriesQuery() {
  return useQuery({
    queryKey: tagKeys.categories,
    queryFn: getTagCategories,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useCategoryListQuery(
  params: AICategoryListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: tagKeys.categoryList(params),
    queryFn: () => getCategoryList(normalizeCategoryListParams(params)),
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTagSuggestQuery(q: string, enabled = true) {
  return useQuery({
    queryKey: tagKeys.suggest(q),
    queryFn: () => getTagSuggestions(q),
    enabled: enabled && q.length > 0,
    staleTime: 10_000,
  });
}

function invalidateTaxonomyQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: tagKeys.all });
  qc.invalidateQueries({ queryKey: catalogQueryKey });
}

export function useTagRenameMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      renameTag(from, to),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useTagMergeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, target }: { source: string[]; target: string }) =>
      mergeTags(source, target),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useTagDeleteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => deleteTags(tags),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useCategoryRenameMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      renameCategory(from, to),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useCategoryMergeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, target }: { source: string[]; target: string }) =>
      mergeCategories(source, target),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useCategoryClearMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categories: string[]) => clearCategories(categories),
    onSuccess: () => {
      invalidateTaxonomyQueries(qc);
    },
  });
}

export function useAssetTagsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      projectId: string;
      repoPath: string;
      contentHash: string;
      hashAlgorithm: string;
      tags: string[];
    }) => setAssetTags(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useAssetDescriptionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      projectId: string;
      repoPath: string;
      contentHash: string;
      hashAlgorithm: string;
      description: string;
    }) => setAssetDescription(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useAssetOcrTextMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      projectId: string;
      repoPath: string;
      contentHash: string;
      hashAlgorithm: string;
      text: string;
    }) => setAssetOcrText(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteTags,
  getTagCategories,
  getTagList,
  getTagSuggestions,
  mergeTags,
  renameTag,
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

export const tagKeys = {
  all: ["tags"] as const,
  list: (params: TagListParams) =>
    ["tags", "list", normalizeTagListParams(params)] as const,
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

export function useTagSuggestQuery(q: string, enabled = true) {
  return useQuery({
    queryKey: tagKeys.suggest(q),
    queryFn: () => getTagSuggestions(q),
    enabled: enabled && q.length > 0,
    staleTime: 10_000,
  });
}

export function useTagRenameMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      renameTag(from, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function useTagMergeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, target }: { source: string[]; target: string }) =>
      mergeTags(source, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function useTagDeleteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => deleteTags(tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
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

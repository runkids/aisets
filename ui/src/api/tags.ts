import type { AICategoryListResponse, TagListResponse } from "@/types";
import { queryString, request } from "./client";

export function getTagList(params: {
  q?: string;
  sort?: string;
  project?: string;
  category?: string;
  locale?: string;
  limit?: number;
  offset?: number;
}) {
  return request<TagListResponse>(
    `/api/tags${queryString({
      q: params.q,
      sort: params.sort,
      project: params.project,
      category: params.category,
      locale: params.locale,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function getCategoryList(params: {
  q?: string;
  sort?: string;
  locale?: string;
  limit?: number;
  offset?: number;
}) {
  return request<AICategoryListResponse>(
    `/api/tags/category-list${queryString({
      q: params.q,
      sort: params.sort,
      locale: params.locale,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function renameTag(from: string, to: string) {
  return request<{ ok: boolean; affected: number }>("/api/tags/rename", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });
}

export function mergeTags(source: string[], target: string) {
  return request<{ ok: boolean; affected: number }>("/api/tags/merge", {
    method: "POST",
    body: JSON.stringify({ source, target }),
  });
}

export function deleteTags(tags: string[]) {
  return request<{ ok: boolean; affected: number }>("/api/tags/delete", {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

export function renameCategory(from: string, to: string) {
  return request<{ ok: boolean; affected: number }>(
    "/api/tags/categories/rename",
    {
      method: "POST",
      body: JSON.stringify({ from, to }),
    },
  );
}

export function mergeCategories(source: string[], target: string) {
  return request<{ ok: boolean; affected: number }>(
    "/api/tags/categories/merge",
    {
      method: "POST",
      body: JSON.stringify({ source, target }),
    },
  );
}

export function clearCategories(categories: string[]) {
  return request<{ ok: boolean; affected: number }>(
    "/api/tags/categories/clear",
    {
      method: "POST",
      body: JSON.stringify({ categories }),
    },
  );
}

export function setAssetTags(params: {
  projectId: string;
  repoPath: string;
  contentHash: string;
  hashAlgorithm: string;
  tags: string[];
}) {
  return request<{ ok: boolean; tags: string[] }>("/api/assets/tags", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getTagCategories() {
  return request<{ categories: string[] }>("/api/tags/categories");
}

export function getTagSuggestions(q: string, limit = 10) {
  const searchParams = new URLSearchParams();
  if (q) searchParams.set("q", q);
  searchParams.set("limit", String(limit));
  return request<{ suggestions: string[] }>(
    `/api/tags/suggest?${searchParams.toString()}`,
  );
}

export function setAssetDescription(params: {
  projectId: string;
  repoPath: string;
  contentHash: string;
  hashAlgorithm: string;
  description: string;
}) {
  return request<{ ok: boolean }>("/api/assets/description", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function setAssetOcrText(params: {
  projectId: string;
  repoPath: string;
  contentHash: string;
  hashAlgorithm: string;
  text: string;
}) {
  return request<{ ok: boolean }>("/api/assets/ocr-text", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

import type { LLMModel, LLMRuntime } from "@/types";
import { request } from "./client";

export function fetchLLMModels(params?: {
  provider: string;
  endpoint: string;
  apiKey?: string;
}) {
  const parts: string[] = [];
  if (params) {
    parts.push(`provider=${encodeURIComponent(params.provider)}`);
    parts.push(`endpoint=${encodeURIComponent(params.endpoint)}`);
    if (params.apiKey)
      parts.push(`apiKey=${encodeURIComponent(params.apiKey)}`);
  }
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return request<{ models: LLMModel[]; error?: string }>(
    `/api/llm/models${qs}`,
  );
}

export function checkLLMHealth(params?: {
  provider: string;
  endpoint: string;
  apiKey?: string;
}) {
  return request<LLMRuntime>("/api/llm/health", {
    method: "POST",
    body: params ? JSON.stringify(params) : undefined,
  });
}

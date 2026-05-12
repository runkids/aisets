import type {
  PromptPreset,
  PromptPresetContent,
  PromptPresetType,
} from "@/types";
import { request } from "./client";

export function listPromptPresets(type?: PromptPresetType) {
  const params = type ? `?type=${type}` : "";
  return request<{ presets: PromptPreset[] }>(`/api/prompt-presets${params}`);
}

export function createPromptPreset(data: {
  type: PromptPresetType;
  name: string;
  content: PromptPresetContent;
  isDefault?: boolean;
}) {
  return request<{ preset: PromptPreset }>("/api/prompt-presets", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updatePromptPreset(
  id: string,
  data: {
    name?: string;
    content?: PromptPresetContent;
    isDefault?: boolean;
  },
) {
  return request<{ preset: PromptPreset }>(`/api/prompt-presets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deletePromptPreset(id: string) {
  return request<{ ok: boolean }>(`/api/prompt-presets/${id}`, {
    method: "DELETE",
  });
}

export function setPromptPresetDefault(id: string) {
  return request<{ preset: PromptPreset }>(
    `/api/prompt-presets/${id}/default`,
    { method: "POST" },
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPromptPreset,
  deletePromptPreset,
  listPromptPresets,
  setPromptPresetDefault,
  updatePromptPreset,
} from "@/api";
import type { PromptPresetType } from "@/types";

export function usePromptPresetsQuery(type?: PromptPresetType) {
  return useQuery({
    queryKey: ["prompt-presets", type ?? "all"],
    queryFn: () => listPromptPresets(type),
    staleTime: 30_000,
  });
}

export function useCreatePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPromptPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompt-presets"] }),
  });
}

export function useUpdatePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: Parameters<typeof updatePromptPreset>[1] & { id: string }) =>
      updatePromptPreset(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-presets"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useDeletePromptPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePromptPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompt-presets"] }),
  });
}

export function useSetPromptPresetDefaultMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setPromptPresetDefault,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompt-presets"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

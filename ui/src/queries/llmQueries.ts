import { useMutation, useQuery } from "@tanstack/react-query";
import { checkLLMHealth, fetchLLMModels } from "@/api";

export function useLLMModelsQuery(
  enabled: boolean,
  params?: { provider: string; endpoint: string; apiKey?: string },
) {
  return useQuery({
    queryKey: [
      "llm-models",
      params?.provider,
      params?.endpoint,
      params?.apiKey,
    ],
    queryFn: () => fetchLLMModels(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useLLMHealthMutation() {
  return useMutation({
    mutationFn: checkLLMHealth,
  });
}

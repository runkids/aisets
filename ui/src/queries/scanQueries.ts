import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearAITagCache,
  clearEmbeddings,
  clearOCRCache,
  clearScanHistory,
  fetchScanStatus,
  installOCR,
  removeOCR,
  repairEmbeddings,
  runAITagging,
  runOCR,
  runVLMOcr,
  scanCatalog,
} from "@/api";
import type {
  AITagRunEvent,
  OCRRunEvent,
  ScanAnalyses,
  ScanEvent,
  ScanProfile,
  VLMOcrRunEvent,
} from "@/types";
import {
  catalogQueryKey,
  embedRepairCheckQueryKey,
  embedStatsQueryKey,
  scansQueryKey,
  settingsQueryKey,
} from "./queryKeys";

type ScanMutationInput = {
  profile?: ScanProfile;
  analyses?: Partial<ScanAnalyses>;
};

const scanStatusQueryKey = ["scanStatus"] as const;

export function useScanStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: scanStatusQueryKey,
    queryFn: fetchScanStatus,
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });
}

export function useScanCatalogMutation(options?: {
  onEvent?: (event: ScanEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input?: ScanMutationInput) =>
      scanCatalog({
        onEvent: options?.onEvent,
        profile: input?.profile,
        analyses: input?.analyses,
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: scansQueryKey }),
      ]);
    },
  });
}

export function useRunOCRMutation(options?: {
  onEvent?: (event: OCRRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runOCR({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useRunAITagMutation(options?: {
  onEvent?: (event: AITagRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runAITagging({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useRunVLMOcrMutation(options?: {
  onEvent?: (event: VLMOcrRunEvent) => void;
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (signal?: AbortSignal) =>
      runVLMOcr({ onEvent: options?.onEvent, signal }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useInstallOCRMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (languages: string[]) => installOCR(languages),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

export function useRemoveOCRMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (languages?: string[]) => removeOCR(languages),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: settingsQueryKey });
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useClearScanHistoryMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearScanHistory,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: scansQueryKey }),
        client.invalidateQueries({ queryKey: settingsQueryKey }),
      ]);
    },
  });
}

export function useClearOCRCacheMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearOCRCache,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useClearAITagCacheMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearAITagCache,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: catalogQueryKey });
    },
  });
}

export function useClearEmbeddingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearEmbeddings,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: embedStatsQueryKey }),
      ]);
    },
  });
}

export function useEmbedRepairCheckQuery(enabled: boolean) {
  return useQuery({
    queryKey: embedRepairCheckQueryKey,
    queryFn: () => repairEmbeddings(false),
    enabled,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}

export function useRepairEmbeddingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (apply: boolean) => repairEmbeddings(apply),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogQueryKey }),
        client.invalidateQueries({ queryKey: embedStatsQueryKey }),
        client.invalidateQueries({ queryKey: embedRepairCheckQueryKey }),
      ]);
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCanvasSession,
  deleteCanvasSession,
  listCanvasSessions,
  renameCanvasSession,
  updateCanvasSession,
} from "@/api";

const CANVAS_SESSIONS_KEY = ["canvas-sessions"] as const;

export function useCanvasSessionsQuery() {
  return useQuery({
    queryKey: CANVAS_SESSIONS_KEY,
    queryFn: () => listCanvasSessions(),
    staleTime: 30_000,
  });
}

export function useCreateCanvasSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCanvasSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: CANVAS_SESSIONS_KEY }),
  });
}

export function useUpdateCanvasSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: Parameters<typeof updateCanvasSession>[1] & { id: string }) =>
      updateCanvasSession(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CANVAS_SESSIONS_KEY }),
  });
}

export function useRenameCanvasSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCanvasSession(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: CANVAS_SESSIONS_KEY }),
  });
}

export function useDeleteCanvasSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCanvasSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: CANVAS_SESSIONS_KEY }),
  });
}

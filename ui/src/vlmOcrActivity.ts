import type { VLMOcrRunCounts, VLMOcrRunEvent } from "./types";

export type VLMOcrActivityPhase =
  | "idle"
  | "saving"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type VLMOcrActivityState = {
  phase: VLMOcrActivityPhase;
  counts: VLMOcrRunCounts | null;
  currentFile?: string;
  errorMessage?: string;
};

export type VLMOcrActivityAction =
  | { type: "saving" }
  | { type: "running" }
  | { type: "event"; event: VLMOcrRunEvent }
  | { type: "stopping" }
  | { type: "done"; counts?: VLMOcrRunCounts }
  | { type: "stopped"; counts?: VLMOcrRunCounts }
  | { type: "error"; errorMessage: string; counts?: VLMOcrRunCounts }
  | { type: "dismiss" };

export type VLMOcrActivityAbortRef = {
  current: AbortController | null;
};

export const initialVLMOcrActivityState: VLMOcrActivityState = {
  phase: "idle",
  counts: null,
};

export function vlmOcrActivityReducer(
  state: VLMOcrActivityState,
  action: VLMOcrActivityAction,
): VLMOcrActivityState {
  switch (action.type) {
    case "saving":
      return { phase: "saving", counts: null };
    case "running":
      return { phase: "running", counts: state.counts };
    case "event": {
      const e = action.event;
      if (!("counts" in e) || !e.counts) return state;
      return {
        ...state,
        counts: e.counts,
        currentFile:
          "repoPath" in e && e.repoPath ? e.repoPath : state.currentFile,
      };
    }
    case "stopping":
      return isVLMOcrActivityBusy(state)
        ? { ...state, phase: "stopping" }
        : state;
    case "done":
      return { phase: "done", counts: action.counts ?? state.counts };
    case "stopped":
      return { phase: "stopped", counts: action.counts ?? state.counts };
    case "error":
      return {
        phase: "error",
        counts: action.counts ?? state.counts,
        errorMessage: action.errorMessage,
      };
    case "dismiss":
      return initialVLMOcrActivityState;
  }
}

export function isVLMOcrActivityBusy(state: VLMOcrActivityState) {
  return (
    state.phase === "saving" ||
    state.phase === "running" ||
    state.phase === "stopping"
  );
}

export function isVLMOcrActivityVisible(state: VLMOcrActivityState) {
  return state.phase !== "idle";
}

export function canDismissVLMOcrActivity(state: VLMOcrActivityState) {
  return (
    state.phase === "done" ||
    state.phase === "stopped" ||
    state.phase === "error"
  );
}

export function vlmOcrActivityProgressPercent(state: VLMOcrActivityState) {
  if (state.phase === "done" || state.phase === "stopped") return 100;
  if (!state.counts || state.counts.queued <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (state.counts.processed / state.counts.queued) * 100),
  );
}

export async function runVLMOcrActivity({
  abortRef,
  dispatch,
  saveSettings,
  run,
}: {
  abortRef: VLMOcrActivityAbortRef;
  dispatch: (action: VLMOcrActivityAction) => void;
  saveSettings: () => Promise<void>;
  run: (options: {
    signal: AbortSignal;
    onEvent: (event: VLMOcrRunEvent) => void;
  }) => Promise<Extract<VLMOcrRunEvent, { type: "done" }> | null>;
}) {
  dispatch({ type: "saving" });

  try {
    await saveSettings();
  } catch (error) {
    dispatch({ type: "error", errorMessage: String(error) });
    return { status: "error" as const };
  }

  const controller = new AbortController();
  abortRef.current = controller;
  dispatch({ type: "running" });

  try {
    const result = await run({
      signal: controller.signal,
      onEvent: (event) => dispatch({ type: "event", event }),
    });

    if (controller.signal.aborted) {
      dispatch({ type: "stopped", counts: result?.counts });
      return { status: "stopped" as const };
    }

    dispatch({ type: "done", counts: result?.counts });
    return { status: "done" as const };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      dispatch({ type: "stopped" });
      return { status: "stopped" as const };
    }

    const msg =
      typeof error === "object" &&
      error != null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : String(error);
    dispatch({ type: "error", errorMessage: msg });
    return { status: "error" as const };
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null;
    }
  }
}

import type { AITagRunCounts, AITagRunEvent } from "./types";

export type AITagActivityPhase =
  | "idle"
  | "saving"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type AITagActivityState = {
  phase: AITagActivityPhase;
  counts: AITagRunCounts | null;
  errorMessage?: string;
};

export type AITagActivityAction =
  | { type: "saving" }
  | { type: "running" }
  | { type: "event"; event: AITagRunEvent }
  | { type: "stopping" }
  | { type: "done"; counts?: AITagRunCounts }
  | { type: "stopped"; counts?: AITagRunCounts }
  | { type: "error"; errorMessage: string; counts?: AITagRunCounts }
  | { type: "dismiss" };

export type AITagActivityAbortRef = {
  current: AbortController | null;
};

export const initialAITagActivityState: AITagActivityState = {
  phase: "idle",
  counts: null,
};

export function aiTagActivityReducer(
  state: AITagActivityState,
  action: AITagActivityAction,
): AITagActivityState {
  switch (action.type) {
    case "saving":
      return { phase: "saving", counts: null };
    case "running":
      return { phase: "running", counts: state.counts };
    case "event":
      return "counts" in action.event && action.event.counts
        ? { ...state, counts: action.event.counts }
        : state;
    case "stopping":
      return isAITagActivityBusy(state)
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
      return initialAITagActivityState;
  }
}

export function isAITagActivityBusy(state: AITagActivityState) {
  return (
    state.phase === "saving" ||
    state.phase === "running" ||
    state.phase === "stopping"
  );
}

export function isAITagActivityVisible(state: AITagActivityState) {
  return state.phase !== "idle";
}

export function canDismissAITagActivity(state: AITagActivityState) {
  return (
    state.phase === "done" ||
    state.phase === "stopped" ||
    state.phase === "error"
  );
}

export function aiTagActivityProgressPercent(state: AITagActivityState) {
  if (state.phase === "done" || state.phase === "stopped") return 100;
  if (!state.counts || state.counts.queued <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (state.counts.processed / state.counts.queued) * 100),
  );
}

export async function runAITagActivity({
  abortRef,
  dispatch,
  saveSettings,
  run,
}: {
  abortRef: AITagActivityAbortRef;
  dispatch: (action: AITagActivityAction) => void;
  saveSettings: () => Promise<void>;
  run: (options: {
    signal: AbortSignal;
    onEvent: (event: AITagRunEvent) => void;
  }) => Promise<Extract<AITagRunEvent, { type: "done" }> | null>;
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

import type { AITagRunCounts, AITagRunEvent } from "./types";

export type AITagActivityPhase =
  | "idle"
  | "saving"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type ActivityError = { repoPath: string; message: string };

export type AITagActivityState = {
  phase: AITagActivityPhase;
  counts: AITagRunCounts | null;
  currentFile?: string;
  errorMessage?: string;
  errors: ActivityError[];
  startedAt?: number;
  scopeLabel?: string;
  providerName?: string;
  modelName?: string;
};

export type AITagActivityAction =
  | { type: "saving" }
  | { type: "running"; startedAt: number; scopeLabel?: string }
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
  errors: [],
};

export function aiTagActivityReducer(
  state: AITagActivityState,
  action: AITagActivityAction,
): AITagActivityState {
  switch (action.type) {
    case "saving":
      return { phase: "saving", counts: null, errors: [] };
    case "running":
      return {
        phase: "running",
        counts: state.counts,
        errors: state.errors,
        startedAt: action.startedAt,
        scopeLabel: action.scopeLabel,
      };
    case "event": {
      const e = action.event;
      if (!("counts" in e) || !e.counts) return state;
      const errors = state.errors;
      const hasItemError =
        "errorMessage" in e && e.errorMessage && "repoPath" in e && e.repoPath;
      return {
        ...state,
        counts: e.counts,
        currentFile:
          "repoPath" in e && e.repoPath ? e.repoPath : state.currentFile,
        errorMessage:
          state.errorMessage ??
          ("errorMessage" in e && e.errorMessage ? e.errorMessage : undefined),
        errors: hasItemError
          ? [...errors, { repoPath: e.repoPath!, message: e.errorMessage! }]
          : errors,
        providerName:
          "providerName" in e && e.providerName
            ? e.providerName
            : state.providerName,
        modelName:
          "modelName" in e && e.modelName ? e.modelName : state.modelName,
      };
    }
    case "stopping":
      return isAITagActivityBusy(state)
        ? { ...state, phase: "stopping" }
        : state;
    case "done":
      return {
        phase: "done",
        counts: action.counts ?? state.counts,
        errors: state.errors,
        startedAt: state.startedAt,
        scopeLabel: state.scopeLabel,
        providerName: state.providerName,
        modelName: state.modelName,
      };
    case "stopped":
      return {
        phase: "stopped",
        counts: action.counts ?? state.counts,
        errors: state.errors,
        startedAt: state.startedAt,
        scopeLabel: state.scopeLabel,
        providerName: state.providerName,
        modelName: state.modelName,
      };
    case "error":
      return {
        phase: "error",
        counts: action.counts ?? state.counts,
        errorMessage: action.errorMessage,
        errors: state.errors,
        startedAt: state.startedAt,
        scopeLabel: state.scopeLabel,
        providerName: state.providerName,
        modelName: state.modelName,
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
  scopeLabel,
}: {
  abortRef: AITagActivityAbortRef;
  dispatch: (action: AITagActivityAction) => void;
  saveSettings: () => Promise<void>;
  run: (options: {
    signal: AbortSignal;
    onEvent: (event: AITagRunEvent) => void;
  }) => Promise<Extract<AITagRunEvent, { type: "done" }> | null>;
  scopeLabel?: string;
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
  dispatch({ type: "running", startedAt: Date.now(), scopeLabel });

  try {
    const result = await run({
      signal: controller.signal,
      onEvent: (event) => dispatch({ type: "event", event }),
    });

    if (controller.signal.aborted) {
      dispatch({ type: "stopped", counts: result?.counts });
      return { status: "stopped" as const };
    }

    const counts = result?.counts;
    if (counts && counts.ready === 0 && counts.failed > 0) {
      dispatch({
        type: "error",
        errorMessage: result?.firstError ?? "",
        counts,
      });
      return { status: "error" as const };
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

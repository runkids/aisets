import type { OCRRunCounts, OCRRunEvent } from "../types";

export type OCRActivityPhase =
  | "idle"
  | "saving"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type OCRActivityState = {
  phase: OCRActivityPhase;
  batch: number;
  counts: OCRRunCounts | null;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: number;
};

export type OCRActivityAction =
  | { type: "saving" }
  | { type: "batchStarted"; batch: number; startedAt?: number }
  | { type: "event"; event: OCRRunEvent }
  | { type: "stopping" }
  | { type: "done"; counts?: OCRRunCounts }
  | { type: "stopped"; counts?: OCRRunCounts }
  | {
      type: "error";
      errorCode?: string;
      errorMessage: string;
      counts?: OCRRunCounts;
    }
  | { type: "dismiss" };

export type OCRActivityRunBatch = (options: {
  signal: AbortSignal;
  onEvent: (event: OCRRunEvent) => void;
}) => Promise<Extract<OCRRunEvent, { type: "done" }> | null>;

export type OCRActivityRunResult =
  | { status: "done" }
  | { status: "stopped" }
  | {
      status: "error";
      error: unknown;
      errorCode?: string;
      errorMessage: string;
    };

export type OCRActivityAbortRef = {
  current: AbortController | null;
};

export const initialOCRActivityState: OCRActivityState = {
  phase: "idle",
  batch: 0,
  counts: null,
};

export function ocrActivityReducer(
  state: OCRActivityState,
  action: OCRActivityAction,
): OCRActivityState {
  switch (action.type) {
    case "saving":
      return { phase: "saving", batch: 0, counts: null };
    case "batchStarted":
      return {
        phase: "running",
        batch: action.batch,
        counts: state.counts,
        startedAt: state.startedAt ?? action.startedAt,
      };
    case "event":
      return "counts" in action.event && action.event.counts
        ? { ...state, counts: action.event.counts }
        : state;
    case "stopping":
      return isOCRActivityBusy(state) ? { ...state, phase: "stopping" } : state;
    case "done":
      return {
        phase: "done",
        batch: state.batch,
        counts: action.counts ?? state.counts,
        startedAt: state.startedAt,
      };
    case "stopped":
      return {
        phase: "stopped",
        batch: state.batch,
        counts: action.counts ?? state.counts,
        startedAt: state.startedAt,
      };
    case "error":
      return {
        phase: "error",
        batch: state.batch,
        counts: action.counts ?? state.counts,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
        startedAt: state.startedAt,
      };
    case "dismiss":
      return initialOCRActivityState;
  }
}

export function isOCRActivityBusy(state: OCRActivityState) {
  return (
    state.phase === "saving" ||
    state.phase === "running" ||
    state.phase === "stopping"
  );
}

export function isOCRActivityVisible(state: OCRActivityState) {
  return state.phase !== "idle";
}

export function canDismissOCRActivity(state: OCRActivityState) {
  return (
    state.phase === "done" ||
    state.phase === "stopped" ||
    state.phase === "error"
  );
}

export function ocrActivityProgressPercent(state: OCRActivityState) {
  if (state.phase === "done" || state.phase === "stopped") return 100;
  if (state.phase === "error")
    return state.counts ? batchPercent(state.counts) : 100;
  return state.counts ? batchPercent(state.counts) : 0;
}

export async function runOCRActivity({
  abortRef,
  dispatch,
  runBatch,
  saveSettings,
}: {
  abortRef: OCRActivityAbortRef;
  dispatch: (action: OCRActivityAction) => void;
  runBatch: OCRActivityRunBatch;
  saveSettings: () => Promise<void>;
}): Promise<OCRActivityRunResult> {
  dispatch({ type: "saving" });

  try {
    await saveSettings();
  } catch (error) {
    const normalized = normalizeActivityError(error);
    dispatch({ type: "error", ...normalized });
    return { status: "error", error, ...normalized };
  }

  let activeController: AbortController | null = null;
  let batch = 0;

  try {
    for (;;) {
      activeController = new AbortController();
      abortRef.current = activeController;
      batch += 1;
      dispatch({ type: "batchStarted", batch, startedAt: Date.now() });

      const result = await runBatch({
        signal: activeController.signal,
        onEvent: (event) => dispatch({ type: "event", event }),
      });

      if (activeController.signal.aborted) {
        dispatch({ type: "stopped", counts: result?.counts });
        return { status: "stopped" };
      }

      if (!result?.hasMore) {
        dispatch({ type: "done", counts: result?.counts });
        return { status: "done" };
      }
    }
  } catch (error) {
    if (activeController?.signal.aborted || isAbortLikeError(error)) {
      dispatch({ type: "stopped" });
      return { status: "stopped" };
    }

    const normalized = normalizeActivityError(error);
    dispatch({ type: "error", ...normalized });
    return { status: "error", error, ...normalized };
  } finally {
    if (abortRef.current === activeController) {
      abortRef.current = null;
    }
  }
}

function batchPercent(counts: OCRRunCounts) {
  if (counts.queued <= 0) return 100;
  return Math.min(100, Math.max(0, (counts.processed / counts.queued) * 100));
}

function isAbortLikeError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (typeof error !== "object" || error == null) return false;
  return "code" in error && error.code === "ocr_canceled";
}

function normalizeActivityError(error: unknown) {
  if (typeof error === "object" && error != null) {
    const code = "code" in error ? String(error.code) : undefined;
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : code;
    if (message) return { errorCode: code, errorMessage: message };
  }
  return { errorMessage: String(error || "OCR failed") };
}

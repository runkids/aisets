export type TranslateActivityPhase =
  | "idle"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type TranslateActivityState = {
  phase: TranslateActivityPhase;
  locale?: string;
  translated: number;
  total: number;
  skipped: number;
  locales: string[];
  warnings: string[];
  errorMessage?: string;
  startedAt?: number;
};

export type TranslateEvent = {
  type: string;
  locale?: string;
  translated?: number;
  total?: number;
  skipped?: number;
  warning?: string;
  warnings?: string[];
  locales?: string[];
  error?: string;
};

export type TranslateActivityAction =
  | { type: "running"; startedAt: number }
  | { type: "event"; event: TranslateEvent }
  | { type: "stopping" }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "error"; errorMessage: string }
  | { type: "dismiss" };

export type TranslateActivityAbortRef = {
  current: AbortController | null;
};

export const initialTranslateActivityState: TranslateActivityState = {
  phase: "idle",
  translated: 0,
  total: 0,
  skipped: 0,
  locales: [],
  warnings: [],
};

function appendWarnings(current: string[], incoming: string[]) {
  const next = [...current];
  for (const warning of incoming) {
    if (warning && !next.includes(warning)) next.push(warning);
  }
  return next.slice(0, 5);
}

export function translateActivityReducer(
  state: TranslateActivityState,
  action: TranslateActivityAction,
): TranslateActivityState {
  switch (action.type) {
    case "running":
      return {
        phase: "running",
        translated: 0,
        total: 0,
        skipped: 0,
        locales: [],
        warnings: [],
        startedAt: action.startedAt,
      };
    case "event": {
      const e = action.event;
      const incomingWarnings = [
        ...(e.warning ? [e.warning] : []),
        ...(e.warnings ?? []),
      ];
      if (e.type === "translating") {
        return {
          ...state,
          locale: e.locale ?? state.locale,
          translated: e.translated ?? state.translated,
          total: e.total ?? state.total,
          skipped: e.skipped ?? state.skipped,
          locales: e.locales ?? state.locales,
          warnings: appendWarnings(state.warnings, incomingWarnings),
        };
      }
      if (e.type === "error") {
        return {
          ...state,
          phase: "error",
          errorMessage: e.error ?? "Translation failed",
        };
      }
      if (e.type === "done") {
        return {
          ...state,
          phase: "done",
          translated: e.translated ?? state.translated,
          skipped: e.skipped ?? state.skipped,
          locales: e.locales ?? state.locales,
          warnings: appendWarnings(state.warnings, incomingWarnings),
        };
      }
      return state;
    }
    case "stopping":
      return { ...state, phase: "stopping" };
    case "done":
      return { ...state, phase: "done" };
    case "stopped":
      return { ...state, phase: "stopped" };
    case "error":
      return { ...state, phase: "error", errorMessage: action.errorMessage };
    case "dismiss":
      return initialTranslateActivityState;
  }
}

export function isTranslateActivityVisible(
  state: TranslateActivityState,
): boolean {
  return state.phase !== "idle";
}

export function isTranslateActivityBusy(
  state: TranslateActivityState,
): boolean {
  return state.phase === "running" || state.phase === "stopping";
}

export function canDismissTranslateActivity(
  state: TranslateActivityState,
): boolean {
  return (
    state.phase === "done" ||
    state.phase === "stopped" ||
    state.phase === "error"
  );
}

export function translateActivityProgressPercent(
  state: TranslateActivityState,
): number {
  if (state.total <= 0) return 0;
  return Math.round((state.translated / state.total) * 100);
}

export async function runTranslateActivity({
  abortRef,
  dispatch,
  run,
}: {
  abortRef: TranslateActivityAbortRef;
  dispatch: (action: TranslateActivityAction) => void;
  run: (opts: {
    signal: AbortSignal;
    onEvent: (event: TranslateEvent) => void;
  }) => Promise<void>;
}) {
  const controller = new AbortController();
  abortRef.current = controller;

  dispatch({ type: "running", startedAt: Date.now() });

  try {
    await run({
      signal: controller.signal,
      onEvent: (event) => dispatch({ type: "event", event }),
    });

    if (controller.signal.aborted) {
      dispatch({ type: "stopped" });
    } else {
      dispatch({ type: "done" });
    }
  } catch (err) {
    if (controller.signal.aborted) {
      dispatch({ type: "stopped" });
    } else {
      dispatch({
        type: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    abortRef.current = null;
  }
}

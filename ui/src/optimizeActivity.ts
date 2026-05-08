import type { OptimizationOperation } from "./components/optimizeTypes";

export type OptimizeActivityPhase =
  | "idle"
  | "running"
  | "stopping"
  | "done"
  | "stopped"
  | "error";

export type OptimizeActivityCounts = {
  total: number;
  processed: number;
  applicable: number;
  blocked: number;
  savingsBytes: number;
};

export type OptimizeActivityState = {
  phase: OptimizeActivityPhase;
  counts: OptimizeActivityCounts | null;
  errorMessage?: string;
};

export type OptimizeActivityAction =
  | { type: "start"; total: number }
  | { type: "operation"; operation: OptimizationOperation }
  | { type: "stopping" }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "error"; errorMessage: string }
  | { type: "dismiss" };

export const initialOptimizeActivityState: OptimizeActivityState = {
  phase: "idle",
  counts: null,
};

export function optimizeActivityReducer(
  state: OptimizeActivityState,
  action: OptimizeActivityAction,
): OptimizeActivityState {
  switch (action.type) {
    case "start":
      return {
        phase: "running",
        counts: {
          total: action.total,
          processed: 0,
          applicable: 0,
          blocked: 0,
          savingsBytes: 0,
        },
      };
    case "operation": {
      const counts = state.counts ?? {
        total: 0,
        processed: 0,
        applicable: 0,
        blocked: 0,
        savingsBytes: 0,
      };
      const applicable = action.operation.canApply;
      return {
        ...state,
        counts: {
          total: counts.total,
          processed: counts.processed + 1,
          applicable: counts.applicable + (applicable ? 1 : 0),
          blocked: counts.blocked + (applicable ? 0 : 1),
          savingsBytes:
            counts.savingsBytes +
            Math.max(0, action.operation.savingsBytes ?? 0),
        },
      };
    }
    case "stopping":
      return isOptimizeActivityBusy(state)
        ? { ...state, phase: "stopping" }
        : state;
    case "done":
      return { ...state, phase: "done" };
    case "stopped":
      return { ...state, phase: "stopped" };
    case "error":
      return { ...state, phase: "error", errorMessage: action.errorMessage };
    case "dismiss":
      return initialOptimizeActivityState;
  }
}

export function isOptimizeActivityBusy(state: OptimizeActivityState) {
  return state.phase === "running" || state.phase === "stopping";
}

export function isOptimizeActivityVisible(state: OptimizeActivityState) {
  return state.phase !== "idle";
}

export function canDismissOptimizeActivity(state: OptimizeActivityState) {
  return (
    state.phase === "done" ||
    state.phase === "stopped" ||
    state.phase === "error"
  );
}

export function optimizeActivityProgressPercent(state: OptimizeActivityState) {
  if (state.phase === "done" || state.phase === "stopped") return 100;
  if (state.phase === "error")
    return state.counts ? percent(state.counts) : 100;
  return state.counts ? percent(state.counts) : 0;
}

function percent(counts: OptimizeActivityCounts) {
  if (counts.total <= 0) return 100;
  return Math.min(100, Math.max(0, (counts.processed / counts.total) * 100));
}

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

export type OptimizeActivityStage = "estimating" | "previewing";

export type OptimizeActivityState = {
  phase: OptimizeActivityPhase;
  stage?: OptimizeActivityStage;
  counts: OptimizeActivityCounts | null;
  errorMessage?: string;
  startedAt?: number;
};

export type OptimizeActivityAction =
  | { type: "start"; total: number; stage?: OptimizeActivityStage; startedAt?: number }
  | { type: "stage"; stage: OptimizeActivityStage }
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
        stage: action.stage ?? "estimating",
        counts: {
          total: action.total,
          processed: 0,
          applicable: 0,
          blocked: 0,
          savingsBytes: 0,
        },
        startedAt: state.startedAt ?? action.startedAt,
      };
    case "stage":
      return isOptimizeActivityBusy(state)
        ? { ...state, stage: action.stage }
        : { ...state, phase: "running", stage: action.stage };
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
      if (state.phase === "stopping") return state;
      return isOptimizeActivityBusy(state)
        ? { ...state, phase: "stopping" }
        : state;
    case "done":
      return { ...state, phase: "done", stage: undefined };
    case "stopped":
      return { ...state, phase: "stopped", stage: undefined };
    case "error":
      return {
        ...state,
        phase: "error",
        stage: undefined,
        errorMessage: action.errorMessage,
      };
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

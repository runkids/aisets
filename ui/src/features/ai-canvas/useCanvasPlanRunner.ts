import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { CanvasChatRunResult } from "./canvasChatRunResult";
import {
  applyCanvasPlanStepResult,
  cancelCanvasPlan,
  canvasPlanContextForStep,
  markCanvasPlanStepRunning,
} from "./canvasPlanRunner";
import type { CanvasPlanContext, CanvasPlanState } from "./canvasPlanState";

type CanvasAskHandler = (overrides?: {
  prompt?: string;
  selectedCardId?: string;
  selectedSkillIds?: string[];
  planContext?: CanvasPlanContext;
}) => Promise<CanvasChatRunResult>;

type UseCanvasPlanRunnerOptions = {
  plan: CanvasPlanState | undefined;
  setPlan: Dispatch<SetStateAction<CanvasPlanState | undefined>>;
  handleAsk: CanvasAskHandler;
  handleStop: () => void;
  isWorking: boolean;
};

export function useCanvasPlanRunner({
  plan,
  setPlan,
  handleAsk,
  handleStop,
  isWorking,
}: UseCanvasPlanRunnerOptions) {
  const runningStepIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plan || plan.status !== "running" || isWorking) return;
    if (runningStepIdRef.current) return;

    const step =
      plan.steps.find((item) => item.status === "running") ??
      plan.steps.find((item) => item.status === "pending");
    if (!step) {
      setPlan((current) =>
        current && current.status === "running"
          ? {
              ...current,
              status: "completed",
              activeStepId: undefined,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      return;
    }

    runningStepIdRef.current = step.id;
    setPlan((current) =>
      current ? markCanvasPlanStepRunning(current, step.id) : current,
    );

    void (async () => {
      const result = await handleAsk({
        prompt: step.task,
        planContext: canvasPlanContextForStep(plan, step),
      });
      setPlan((current) =>
        current ? applyCanvasPlanStepResult(current, step.id, result) : current,
      );
      runningStepIdRef.current = null;
    })();
  }, [handleAsk, isWorking, plan, setPlan]);

  const cancelPlan = useCallback(() => {
    handleStop();
    runningStepIdRef.current = null;
    setPlan((current) => (current ? cancelCanvasPlan(current) : current));
  }, [handleStop, setPlan]);

  return { cancelPlan };
}

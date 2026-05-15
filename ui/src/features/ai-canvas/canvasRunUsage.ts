import type { ChatRunUsage } from "./aiCanvasState";

export function canvasRunToolCount(usage?: ChatRunUsage) {
  const executed = usage?.executedActionCount;
  if (Number.isFinite(executed)) return Math.round(executed ?? 0);
  return (usage?.toolCallCount ?? 0) + (usage?.fallbackActionCount ?? 0);
}

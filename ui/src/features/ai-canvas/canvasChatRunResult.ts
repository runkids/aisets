import type { ChatActivityEntry, ChatRunUsage } from "./aiCanvasState";

export type CanvasChatRunResult = {
  status: "completed" | "failed" | "canceled";
  assistantText: string;
  activity: ChatActivityEntry[];
  usage?: ChatRunUsage;
  evidence: {
    actionResultTools: string[];
    actionResultCounts: Record<string, number>;
    proposalTools: string[];
    generatedImageCount: number;
    executedActionCount: number;
    invalidActionCount: number;
  };
  error?: string;
};

export function emptyCanvasChatRunEvidence(): CanvasChatRunResult["evidence"] {
  return {
    actionResultTools: [],
    actionResultCounts: {},
    proposalTools: [],
    generatedImageCount: 0,
    executedActionCount: 0,
    invalidActionCount: 0,
  };
}

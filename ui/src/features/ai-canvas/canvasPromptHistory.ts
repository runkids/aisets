import type { ChatHistoryEntry } from "./aiCanvasState";

export type CanvasPromptHistoryState = {
  index: number | null;
  draft: string;
};

export function canvasUserPromptHistory(chatHistory: ChatHistoryEntry[]) {
  return chatHistory
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content.trim())
    .filter((content) => content.length > 0);
}

export function navigateCanvasPromptHistory(
  history: string[],
  direction: "previous" | "next",
  state: CanvasPromptHistoryState,
  currentPrompt: string,
): { prompt: string; state: CanvasPromptHistoryState } | null {
  if (history.length === 0) return null;

  if (direction === "previous") {
    const index =
      state.index === null
        ? history.length - 1
        : Math.max(0, Math.min(state.index - 1, history.length - 1));
    return {
      prompt: history[index],
      state: {
        index,
        draft: state.index === null ? currentPrompt : state.draft,
      },
    };
  }

  if (state.index === null) return null;

  if (state.index >= history.length - 1) {
    return {
      prompt: state.draft,
      state: { index: null, draft: state.draft },
    };
  }

  const index = state.index + 1;
  return {
    prompt: history[index],
    state: { index, draft: state.draft },
  };
}

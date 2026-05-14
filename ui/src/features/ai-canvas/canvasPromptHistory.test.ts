import { describe, expect, it } from "vitest";
import {
  canvasUserPromptHistory,
  navigateCanvasPromptHistory,
  type CanvasPromptHistoryState,
} from "./canvasPromptHistory";

const emptyState: CanvasPromptHistoryState = { index: null, draft: "" };

describe("canvasUserPromptHistory", () => {
  it("keeps only non-empty user messages", () => {
    expect(
      canvasUserPromptHistory([
        { role: "assistant", content: "assistant answer" },
        { role: "user", content: " first prompt " },
        { role: "system", content: "system note" },
        { role: "user", content: "   " },
        { role: "user", content: "second prompt" },
      ]),
    ).toEqual(["first prompt", "second prompt"]);
  });
});

describe("navigateCanvasPromptHistory", () => {
  it("walks backward through user prompts and clamps at the oldest entry", () => {
    const history = ["first", "second"];

    const latest = navigateCanvasPromptHistory(
      history,
      "previous",
      emptyState,
      "draft",
    );
    expect(latest).toEqual({
      prompt: "second",
      state: { index: 1, draft: "draft" },
    });

    const older = navigateCanvasPromptHistory(
      history,
      "previous",
      latest!.state,
      latest!.prompt,
    );
    expect(older).toEqual({
      prompt: "first",
      state: { index: 0, draft: "draft" },
    });

    expect(
      navigateCanvasPromptHistory(
        history,
        "previous",
        older!.state,
        older!.prompt,
      ),
    ).toEqual({ prompt: "first", state: { index: 0, draft: "draft" } });
  });

  it("walks forward and restores the draft after the newest entry", () => {
    const history = ["first", "second"];
    const state: CanvasPromptHistoryState = { index: 0, draft: "draft" };

    const newer = navigateCanvasPromptHistory(history, "next", state, "first");
    expect(newer).toEqual({
      prompt: "second",
      state: { index: 1, draft: "draft" },
    });

    expect(
      navigateCanvasPromptHistory(history, "next", newer!.state, "second"),
    ).toEqual({ prompt: "draft", state: { index: null, draft: "draft" } });
  });
});

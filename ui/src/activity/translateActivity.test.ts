import { describe, expect, it } from "vitest";
import {
  initialTranslateActivityState,
  translateActivityReducer,
  type TranslateActivityAction,
} from "./translateActivity";

function reduce(actions: TranslateActivityAction[]) {
  return actions.reduce(translateActivityReducer, initialTranslateActivityState);
}

describe("translateActivityReducer", () => {
  it("tracks skipped rows and warnings from stream events", () => {
    const state = reduce([
      { type: "running", startedAt: 1 },
      {
        type: "event",
        event: {
          type: "translating",
          locale: "en",
          locales: ["en", "zh-TW"],
          translated: 0,
          total: 2,
          skipped: 1,
          warning: "failed to translate en batch",
        },
      },
      {
        type: "event",
        event: {
          type: "done",
          translated: 1,
          total: 12,
          skipped: 1,
          locales: ["en", "zh-TW"],
          warnings: ["some en translations were skipped"],
        },
      },
    ]);

    expect(state).toMatchObject({
      phase: "done",
      locale: "en",
      translated: 1,
      total: 12,
      skipped: 1,
      locales: ["en", "zh-TW"],
      warnings: [
        "failed to translate en batch",
        "some en translations were skipped",
      ],
    });
  });
});

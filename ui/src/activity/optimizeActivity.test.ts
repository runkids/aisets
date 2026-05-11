import { describe, expect, it } from "vitest";
import {
  initialOptimizeActivityState,
  optimizeActivityProgressPercent,
  optimizeActivityReducer,
} from "./optimizeActivity";

function reduce(actions: Parameters<typeof optimizeActivityReducer>[1][]) {
  return actions.reduce(optimizeActivityReducer, initialOptimizeActivityState);
}

describe("optimizeActivityReducer", () => {
  it("tracks streamed operations and savings", () => {
    const state = reduce([
      { type: "start", total: 2 },
      {
        type: "operation",
        operation: {
          assetId: "a",
          repoPath: "a.png",
          operation: "convert-avif",
          outputFormat: "avif",
          outputMode: "safeVariants",
          targetPath: "a.avif",
          currentBytes: 100,
          estimatedBytes: 40,
          savingsBytes: 60,
          available: true,
          canApply: true,
          referencePolicy: "manualReview",
        },
      },
      {
        type: "operation",
        operation: {
          assetId: "b",
          repoPath: "b.gif",
          operation: "convert-webp",
          outputFormat: "webp",
          outputMode: "safeVariants",
          targetPath: "b.webp",
          currentBytes: 100,
          estimatedBytes: 100,
          savingsBytes: 0,
          available: true,
          canApply: false,
          referencePolicy: "manualReview",
        },
      },
    ]);

    expect(state.counts).toMatchObject({
      total: 2,
      processed: 2,
      applicable: 1,
      blocked: 1,
      savingsBytes: 60,
    });
    expect(optimizeActivityProgressPercent(state)).toBe(100);
  });
});

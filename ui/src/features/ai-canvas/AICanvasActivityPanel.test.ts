import { describe, expect, it } from "vitest";
import { canvasRunToolCount } from "./AICanvasActivityPanel";

describe("canvasRunToolCount", () => {
  it("uses executed actions when native and fallback transports are summarized", () => {
    expect(
      canvasRunToolCount({
        toolCallCount: 0,
        fallbackActionCount: 24,
        executedActionCount: 24,
      }),
    ).toBe(24);
  });

  it("falls back to native plus fallback action counts for older sessions", () => {
    expect(
      canvasRunToolCount({
        toolCallCount: 2,
        fallbackActionCount: 3,
      }),
    ).toBe(5);
  });
});

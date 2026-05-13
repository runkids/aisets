import { describe, expect, it } from "vitest";
import { canvasWheelZoomFactor } from "./canvasUtils";

describe("canvasWheelZoomFactor", () => {
  it("zooms faster for wheel-sized deltas", () => {
    expect(canvasWheelZoomFactor(-100, 0)).toBeGreaterThan(1.2);
    expect(canvasWheelZoomFactor(100, 0)).toBeLessThan(0.84);
  });

  it("keeps trackpad deltas gradual", () => {
    const factor = canvasWheelZoomFactor(-5, 0);

    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThan(1.02);
  });
});

import { describe, expect, it } from "vitest";
import { modeForPath, pathForMode } from "./routeHelpers";

describe("routeHelpers", () => {
  it("uses /canvas for the canvas mode", () => {
    expect(pathForMode("aiCanvas")).toBe("/canvas");
    expect(modeForPath("/canvas")).toBe("aiCanvas");
  });

  it("does not keep the old ai-canvas route", () => {
    expect(modeForPath("/ai-canvas")).toBe("projects");
  });
});

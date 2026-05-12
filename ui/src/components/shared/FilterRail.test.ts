import { describe, expect, it } from "vitest";
import { shouldShowFavoriteRail } from "./FilterRail";

describe("shouldShowFavoriteRail", () => {
  it("hides the saved rail when there are no favorites", () => {
    expect(shouldShowFavoriteRail()).toBe(false);
    expect(shouldShowFavoriteRail(0)).toBe(false);
  });

  it("shows the saved rail when favorites exist", () => {
    expect(shouldShowFavoriteRail(1)).toBe(true);
  });
});

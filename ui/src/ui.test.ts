import { describe, expect, it } from "vitest";
import { clearBrowseSearchParams, drawerSearchParams } from "./ui";

describe("drawerSearchParams", () => {
  it("cleans global-search focus params while preserving browse search", () => {
    const result = drawerSearchParams(
      new URLSearchParams("asset=a&focusAsset=a&q=1006.png"),
      "",
    );

    expect(result.toString()).toBe("q=1006.png");
  });

  it("preserves non-focus browse params when closing the drawer", () => {
    const result = drawerSearchParams(
      new URLSearchParams("asset=a&q=icons&aiCategory=logo"),
      "",
    );

    expect(result.toString()).toBe("q=icons&aiCategory=logo");
  });

  it("cleans stale focus params when opening another drawer asset", () => {
    const result = drawerSearchParams(
      new URLSearchParams("asset=a&focusAsset=a&q=1006.png"),
      "b",
    );

    expect(result.toString()).toBe("asset=b&q=1006.png");
  });
});

describe("clearBrowseSearchParams", () => {
  it("cleans route-backed browse search without closing the drawer", () => {
    const result = clearBrowseSearchParams(
      new URLSearchParams("asset=a&focusAsset=a&q=1006.png&aiCategory=logo"),
    );

    expect(result.toString()).toBe("asset=a&aiCategory=logo");
  });
});

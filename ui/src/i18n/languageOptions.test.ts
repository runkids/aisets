import { describe, expect, it } from "vitest";
import {
  languageOptionsForLocale,
  prefersSimplifiedChineseFirst,
} from "./languageOptions";

function codesFor(locale: string) {
  return languageOptionsForLocale(locale).map((language) => language.code);
}

describe("languageOptionsForLocale", () => {
  it("puts Simplified Chinese first for Mainland China locale", () => {
    expect(codesFor("zh-CN")[0]).toBe("zh-CN");
  });

  it("puts Simplified Chinese first for Hong Kong locale", () => {
    expect(codesFor("en-HK")[0]).toBe("zh-CN");
  });

  it("puts Simplified Chinese first for Macau locale", () => {
    expect(codesFor("zh-Hant-MO")[0]).toBe("zh-CN");
  });

  it("keeps the default order for other locales", () => {
    expect(codesFor("en-US")).toEqual(["en", "zh-TW", "zh-CN", "ja", "ko"]);
  });
});

describe("prefersSimplifiedChineseFirst", () => {
  it("accepts Simplified Chinese script-only tags", () => {
    expect(prefersSimplifiedChineseFirst("zh-Hans")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { defaultTagViewLocale, tagViewLocaleOptions } from "./tagViewLocale";

describe("tagViewLocaleOptions", () => {
  it("only exposes configured translation locales", () => {
    expect(tagViewLocaleOptions(["en", "zh-TW"])).toEqual([
      { value: "en", label: "EN" },
      { value: "zh-TW", label: "繁中" },
    ]);
  });

  it("defaults to English when no translation locales are configured", () => {
    expect(tagViewLocaleOptions()).toEqual([{ value: "en", label: "EN" }]);
  });
});

describe("defaultTagViewLocale", () => {
  it("uses English for English display language", () => {
    expect(defaultTagViewLocale("en", ["en", "zh-TW"])).toBe("en");
  });

  it("uses the current non-English language when it is configured", () => {
    expect(defaultTagViewLocale("zh-TW", ["en", "zh-TW"])).toBe("zh-TW");
  });

  it("normalizes regional English to English", () => {
    expect(defaultTagViewLocale("en-US", ["en", "zh-TW"])).toBe("en");
  });

  it("falls back to English when the current language is not configured", () => {
    expect(defaultTagViewLocale("ja", ["en", "zh-TW"])).toBe("en");
  });
});

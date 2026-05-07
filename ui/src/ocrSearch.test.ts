import { describe, expect, it } from "vitest";
import { matchesOCRSearchText } from "./ocrSearch";

describe("matchesOCRSearchText", () => {
  it("matches exact OCR substrings", () => {
    expect(matchesOCRSearchText("forest party", "party")).toBe(true);
  });

  it("matches conservative OCR token truncation", () => {
    expect(matchesOCRSearchText("part", "party")).toBe(true);
  });

  it("matches small OCR character dropouts", () => {
    expect(matchesOCRSearchText("aran adventur", "tarzan")).toBe(true);
  });

  it("matches OCR tokens with noisy prefix or suffix characters", () => {
    expect(matchesOCRSearchText("ERARZAN™S", "tarzan")).toBe(true);
  });

  it("can disable fuzzy OCR matching", () => {
    expect(matchesOCRSearchText("ERARZAN™S", "tarzan", { fuzzy: false })).toBe(
      false,
    );
    expect(
      matchesOCRSearchText("clean tarzan text", "tarzan", {
        fuzzy: false,
      }),
    ).toBe(true);
  });

  it("does not fuzzy match very short queries", () => {
    expect(matchesOCRSearchText("part", "pty")).toBe(false);
  });
});

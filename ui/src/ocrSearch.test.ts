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

  it("does not fuzzy match very short queries", () => {
    expect(matchesOCRSearchText("part", "pty")).toBe(false);
  });
});

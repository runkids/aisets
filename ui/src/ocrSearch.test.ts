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

  it("matches short game-logo words with one OCR character error", () => {
    expect(matchesOCRSearchText("TREASURE BOWI", "bowl")).toBe(true);
    expect(matchesOCRSearchText("TREASURE BOW", "bowl")).toBe(true);
  });

  it("rejects unrelated short game-logo words", () => {
    expect(matchesOCRSearchText("MAYAN EMPIRE", "fire")).toBe(false);
    expect(matchesOCRSearchText("Mahjong for 2 Players", "fire")).toBe(false);
    expect(matchesOCRSearchText("FortuneTREE", "fire")).toBe(false);
    expect(matchesOCRSearchText("FourCard Suit", "fire")).toBe(false);
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

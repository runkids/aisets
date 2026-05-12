import { describe, expect, it } from "vitest";
import { activeRailSectionsForScroll } from "./RailState";

type TestSection = { id: string; top: number };

const sections: TestSection[] = [
  { id: "project", top: 0 },
  { id: "extension", top: 120 },
];

function activeIds(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
) {
  return activeRailSectionsForScroll(
    sections,
    scrollTop,
    scrollHeight,
    clientHeight,
    (section) => section.top,
  ).map((section) => section.id);
}

describe("activeRailSectionsForScroll", () => {
  it("does not render sticky headings before the rail scrolls", () => {
    expect(activeIds(0, 400, 400)).toEqual([]);
    expect(activeIds(0, 800, 400)).toEqual([]);
  });

  it("does not render sticky headings when the rail cannot scroll", () => {
    expect(activeIds(12, 400, 400)).toEqual([]);
  });

  it("renders only scrolled-past headings after the rail scrolls", () => {
    expect(activeIds(12, 800, 400)).toEqual(["project"]);
    expect(activeIds(130, 800, 400)).toEqual(["project", "extension"]);
  });
});

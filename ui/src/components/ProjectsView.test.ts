import { describe, expect, it } from "vitest";
import { sortProjectStats, type ProjectStat } from "./ProjectsView";

function stat(name: string, createdAt?: string): ProjectStat {
  return {
    project: {
      id: name,
      workspaceId: "default",
      name,
      path: `/${name}`,
      createdAt,
    },
    items: [],
    bytes: 0,
    used: 0,
    unused: 0,
    duplicates: 0,
    optimizable: 0,
    lint: 0,
    health: 100,
    lastScanLabel: "—",
  };
}

describe("sortProjectStats", () => {
  it("sorts projects by imported date, newest first", () => {
    const sorted = sortProjectStats(
      [
        stat("Beta", "2026-05-06T12:00:00Z"),
        stat("Gamma"),
        stat("Alpha", "2026-05-07T12:00:00Z"),
      ],
      "imported",
    );

    expect(sorted.map((item) => item.project.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("uses project name as the imported-date tiebreaker", () => {
    const sorted = sortProjectStats(
      [
        stat("Beta", "2026-05-07T12:00:00Z"),
        stat("Alpha", "2026-05-07T12:00:00Z"),
      ],
      "imported",
    );

    expect(sorted.map((item) => item.project.name)).toEqual(["Alpha", "Beta"]);
  });
});

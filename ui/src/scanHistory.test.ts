import { describe, expect, it } from "vitest";
import {
  defaultScanSelection,
  filterScanDiffRows,
  formatSignedBytes,
  scanDiffRows,
} from "./scanHistory";
import type { ScanDiff, ScanSummary } from "./types";

function scan(id: number, completedAt: string): ScanSummary {
  return {
    id,
    startedAt: completedAt,
    completedAt,
    status: "completed",
    profile: "full",
    projectCount: 1,
    totalFiles: 10,
    duplicateGroups: 0,
    duplicateFiles: 0,
    unusedFiles: 0,
    nearDuplicates: 0,
    cacheHits: 0,
    analysis: {
      references: "computed",
      nearDuplicates: "computed",
      optimization: "computed",
    },
  };
}

const diff: ScanDiff = {
  base: scan(1, "2026-05-08T10:00:00Z"),
  target: scan(2, "2026-05-08T11:00:00Z"),
  summary: {
    added: 1,
    removed: 1,
    modified: 1,
    referenceChanged: 1,
    becameUnused: 1,
    noLongerUnused: 1,
    totalByteDelta: 1024,
    optimizationSavingsDelta: -512,
    duplicateGroupsDelta: 0,
    nearDuplicatesDelta: 0,
  },
  added: [
    {
      projectId: "app",
      projectName: "App",
      repoPath: "src/new.png",
      ext: ".png",
      afterBytes: 100,
      afterUsedCount: 1,
    },
  ],
  removed: [
    {
      projectId: "app",
      projectName: "App",
      repoPath: "src/old.svg",
      ext: ".svg",
      beforeBytes: 200,
      beforeUsedCount: 0,
    },
  ],
  modified: [
    {
      projectId: "web",
      projectName: "Web",
      repoPath: "assets/logo.png",
      ext: ".png",
      beforeBytes: 300,
      afterBytes: 320,
    },
  ],
  referenceChanges: [
    {
      projectId: "web",
      projectName: "Web",
      repoPath: "assets/logo.png",
      ext: ".png",
      beforeUsedCount: 1,
      afterUsedCount: 3,
    },
  ],
  unusedTransitions: [
    {
      projectId: "app",
      projectName: "App",
      repoPath: "src/orphan.png",
      ext: ".png",
      direction: "becameUnused",
      beforeUsedCount: 1,
      afterUsedCount: 0,
    },
  ],
};

describe("defaultScanSelection", () => {
  it("picks second item as base and first as target (expects pre-sorted input)", () => {
    expect(
      defaultScanSelection([
        scan(3, "2026-05-08T12:00:00Z"),
        scan(2, "2026-05-08T11:00:00Z"),
        scan(1, "2026-05-08T10:00:00Z"),
      ]),
    ).toEqual({ baseId: 2, targetId: 3 });
  });

  it("returns null until two scans exist", () => {
    expect(defaultScanSelection([scan(1, "2026-05-08T10:00:00Z")])).toBeNull();
  });
});

describe("scanDiffRows", () => {
  it("keeps backend diff categories as separate display rows", () => {
    expect(scanDiffRows(diff).map((row) => row.category)).toEqual([
      "added",
      "removed",
      "modified",
      "references",
      "becameUnused",
    ]);
  });
});

describe("filterScanDiffRows", () => {
  it("filters rows by category and query", () => {
    const rows = scanDiffRows(diff);

    expect(
      filterScanDiffRows({ rows, category: "references", query: "logo" }).map(
        (row) => row.id,
      ),
    ).toEqual(["references:web:assets/logo.png"]);
  });
});

describe("formatSignedBytes", () => {
  it("formats positive, negative, and zero deltas", () => {
    expect(formatSignedBytes(2048)).toBe("+2.0 KB");
    expect(formatSignedBytes(-512)).toBe("-512 B");
    expect(formatSignedBytes(0)).toBe("0 B");
  });
});

import type { ScanAssetDiff, ScanDiff, ScanSummary } from "./types";
import { formatBytes } from "./ui";

export type ScanDiffCategory =
  | "all"
  | "added"
  | "removed"
  | "modified"
  | "references"
  | "becameUnused"
  | "noLongerUnused";

export type ScanDiffRow = {
  id: string;
  category: Exclude<ScanDiffCategory, "all">;
  projectId: string;
  projectName: string;
  repoPath: string;
  ext: string;
  beforeBytes?: number;
  afterBytes?: number;
  beforeUsedCount?: number;
  afterUsedCount?: number;
};

export function sortedScans(scans: ScanSummary[]) {
  return [...scans].sort((a, b) => {
    const aTime = Date.parse(a.completedAt || a.startedAt || "");
    const bTime = Date.parse(b.completedAt || b.startedAt || "");
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return b.id - a.id;
  });
}

export function defaultScanSelection(scans: ScanSummary[]) {
  if (scans.length < 2) return null;
  return { baseId: scans[1].id, targetId: scans[0].id };
}

function rowFromAssetDiff(
  category: ScanDiffRow["category"],
  item: ScanAssetDiff,
): ScanDiffRow {
  return {
    id: `${category}:${item.projectId}:${item.repoPath}`,
    category,
    projectId: item.projectId,
    projectName: item.projectName,
    repoPath: item.repoPath,
    ext: item.ext,
    beforeBytes: item.beforeBytes,
    afterBytes: item.afterBytes,
    beforeUsedCount: item.beforeUsedCount,
    afterUsedCount: item.afterUsedCount,
  };
}

export function scanDiffRows(diff: ScanDiff): ScanDiffRow[] {
  return [
    ...diff.added.map((item) => rowFromAssetDiff("added", item)),
    ...diff.removed.map((item) => rowFromAssetDiff("removed", item)),
    ...diff.modified.map((item) => rowFromAssetDiff("modified", item)),
    ...diff.referenceChanges.map((item) =>
      rowFromAssetDiff("references", item),
    ),
    ...diff.unusedTransitions.map((item) => ({
      id: `${item.direction}:${item.projectId}:${item.repoPath}`,
      category: item.direction,
      projectId: item.projectId,
      projectName: item.projectName,
      repoPath: item.repoPath,
      ext: item.ext,
      beforeUsedCount: item.beforeUsedCount,
      afterUsedCount: item.afterUsedCount,
    })),
  ];
}

export function filterScanDiffRows({
  rows,
  category,
  query,
}: {
  rows: ScanDiffRow[];
  category: ScanDiffCategory;
  query: string;
}) {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (category !== "all" && row.category !== category) return false;
    if (!needle) return true;
    return (
      row.repoPath.toLowerCase().includes(needle) ||
      row.projectName.toLowerCase().includes(needle) ||
      row.ext.toLowerCase().includes(needle)
    );
  });
}

export function formatSignedBytes(bytes: number) {
  const sign = bytes > 0 ? "+" : bytes < 0 ? "-" : "";
  return `${sign}${formatBytes(Math.abs(bytes))}`;
}

export function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function summaryChangeCount(diff: ScanDiff) {
  return (
    diff.summary.added +
    diff.summary.removed +
    diff.summary.modified +
    diff.summary.referenceChanged +
    diff.summary.becameUnused +
    diff.summary.noLongerUnused +
    Math.abs(diff.summary.duplicateGroupsDelta) +
    Math.abs(diff.summary.nearDuplicatesDelta)
  );
}

export function summaryHasChanges(diff: ScanDiff) {
  return (
    summaryChangeCount(diff) > 0 ||
    diff.summary.totalByteDelta !== 0 ||
    diff.summary.optimizationSavingsDelta !== 0
  );
}

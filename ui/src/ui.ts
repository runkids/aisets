import i18n from "i18next";
import type { AssetItem, Catalog } from "./types";

export function formatExt(ext: string) {
  return ext.replace(/^\./, "").toUpperCase();
}

export function hasDuplicates(item: AssetItem) {
  return (
    item.duplicates.length > 0 ||
    item.similar.length > 0 ||
    item.duplicateGroupId != null
  );
}

export type Mode =
  | "projects"
  | "history"
  | "browse"
  | "duplicates"
  | "unused"
  | "optimize"
  | "lint"
  | "precheck"
  | "settings";

export const modes: Mode[] = [
  "projects",
  "history",
  "browse",
  "duplicates",
  "unused",
  "optimize",
  "lint",
  "precheck",
  "settings",
];

export function pathForMode(mode: Mode) {
  return `/${mode}`;
}

export function modeForPath(pathname: string): Mode {
  const segment = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  return modes.includes(segment as Mode) ? (segment as Mode) : "projects";
}

export function titleForMode(mode: Mode) {
  return i18n.t(`mode.${mode}`);
}

export function descriptionForMode(mode: Mode) {
  return i18n.t(`mode.${mode}Desc`);
}

export function formatDate(unixSeconds: number) {
  if (unixSeconds <= 0) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

export function primarySeverity(item: AssetItem) {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return item.optimizationRecommendations.reduce<
    AssetItem["optimizationRecommendations"][number]["severity"] | null
  >((current, recommendation) => {
    if (current == null) return recommendation.severity;
    return rank[recommendation.severity] < rank[current]
      ? recommendation.severity
      : current;
  }, null);
}

export function duplicateSavings(catalog: Catalog) {
  const items = catalog.items ?? [];
  return (catalog.duplicateGroups ?? []).reduce((sum, group) => {
    const members = items.filter((item) => item.duplicateGroupId === group.id);
    return (
      sum +
      members
        .filter((item) => item.repoPath !== group.preferredPath)
        .reduce((size, item) => size + item.bytes, 0)
    );
  }, 0);
}

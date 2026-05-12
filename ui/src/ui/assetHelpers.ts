import type { AssetItem, Catalog } from "@/types";

export function hasDuplicates(item: AssetItem) {
  return (
    item.duplicates.length > 0 ||
    item.similar.length > 0 ||
    item.duplicateGroupId != null
  );
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

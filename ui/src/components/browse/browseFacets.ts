import type { AssetItem } from "../../types";

export type FacetOption = {
  id: string;
  count: number;
};

type FacetKey = "projectName" | "ext";

export function facetOptions(
  allIds: string[],
  scopedItems: AssetItem[],
  key: FacetKey,
) {
  const counts = new Map<string, number>();
  for (const item of scopedItems) {
    const id = item[key];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    total: scopedItems.length,
    options: allIds
      .map((id) => ({ id, count: counts.get(id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  };
}

export function projectFacetIds({
  items,
  projectNames,
  projectFilterName,
}: {
  items: AssetItem[];
  projectNames: string[];
  projectFilterName: string;
}) {
  const ids = projectFilterName
    ? [projectFilterName]
    : projectNames.length > 0
      ? projectNames
      : items.map((item) => item.projectName);
  return Array.from(new Set(ids)).sort();
}

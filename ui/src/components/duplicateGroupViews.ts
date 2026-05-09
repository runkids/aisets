import type { AssetItem, DuplicateGroup } from "../types";

type SortKey = "members" | "size";

export type DuplicateGroupView = DuplicateGroup & {
  members: AssetItem[];
  totalBytes: number;
  savings: number;
};

export function buildDuplicateGroupViews(
  groups: DuplicateGroup[],
  fallbackItems: AssetItem[],
  sort: SortKey,
  search = "",
): DuplicateGroupView[] {
  const fallbackItemsByGroup = new Map<string, AssetItem[]>();
  for (const item of fallbackItems) {
    if (!item.duplicateGroupId) continue;
    const list = fallbackItemsByGroup.get(item.duplicateGroupId);
    if (list) list.push(item);
    else fallbackItemsByGroup.set(item.duplicateGroupId, [item]);
  }

  const normalizedSearch = search.trim().toLowerCase();
  return groups
    .map((group) => {
      const sourceMembers =
        group.members && group.members.length > 0
          ? group.members
          : (fallbackItemsByGroup.get(group.id) ?? []);
      const members = normalizedSearch
        ? sourceMembers.filter(
            (member) =>
              member.repoPath.toLowerCase().includes(normalizedSearch) ||
              member.projectName.toLowerCase().includes(normalizedSearch),
          )
        : sourceMembers;
      const totalBytes = members.reduce((sum, member) => sum + member.bytes, 0);
      const savings = members
        .filter((member) => member.repoPath !== group.preferredPath)
        .reduce((sum, member) => sum + member.bytes, 0);
      return { ...group, members, totalBytes, savings };
    })
    .filter((group) => !normalizedSearch || group.members.length > 0)
    .sort((a, b) =>
      sort === "size"
        ? b.totalBytes - a.totalBytes
        : b.members.length - a.members.length,
    );
}

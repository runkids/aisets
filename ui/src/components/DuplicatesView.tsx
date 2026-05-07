import { GitMerge } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetItem, DuplicateGroup, NearDuplicate } from "../types";
import { fileName, formatBytes } from "../ui";
import { AssetThumbnail, Badge, Button, Card, EmptyState, Tabs } from "./ui";

type Props = {
  items: AssetItem[];
  groups: DuplicateGroup[];
  nearDuplicates: NearDuplicate[];
  onOpenAsset?: (id: string) => void;
  onMerge?: (groupId: string) => void;
};

type Tab = "exact" | "similar";
type SortKey = "members" | "size";

export function DuplicatesView({
  items,
  groups,
  nearDuplicates,
  onOpenAsset,
  onMerge,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("exact");
  const [sort, setSort] = useState<SortKey>("members");
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const groupViews = useMemo(() => {
    return groups
      .map((g) => {
        const members = items.filter((i) => i.duplicateGroupId === g.id);
        const totalBytes = members.reduce((s, m) => s + m.bytes, 0);
        return { ...g, members, totalBytes };
      })
      .sort((a, b) =>
        sort === "size"
          ? b.totalBytes - a.totalBytes
          : b.members.length - a.members.length,
      );
  }, [groups, items, sort]);

  const totalSavings = useMemo(
    () =>
      groupViews.reduce(
        (sum, g) =>
          sum +
          g.members
            .filter((m) => m.repoPath !== g.preferredPath)
            .reduce((s, m) => s + m.bytes, 0),
        0,
      ),
    [groupViews],
  );

  return (
    <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Tabs
          value={tab}
          ariaLabel={t("duplicates.title")}
          onChange={setTab}
          items={[
            {
              value: "exact",
              label: t("duplicates.exactTab", { count: groups.length }),
            },
            {
              value: "similar",
              label: t("duplicates.similarTab", {
                count: nearDuplicates.length,
              }),
            },
          ]}
        />
        {tab === "exact" && (
          <Tabs
            value={sort}
            ariaLabel={t("sort.byCount")}
            onChange={setSort}
            items={[
              { value: "members", label: t("sort.byCount") },
              { value: "size", label: t("sort.bySize") },
            ]}
          />
        )}
        {tab === "exact" && totalSavings > 0 && (
          <span className="font-g-mono text-g-caption text-g-green">
            {t("duplicates.canSave", { size: formatBytes(totalSavings) })}
          </span>
        )}
      </div>

      {tab === "exact" && (
        <div className="grid gap-3">
          {groupViews.map((group) => (
            <Card key={group.id} padding="md">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-g-mono text-g-caption text-g-ink-3">
                    {group.contentHash.slice(0, 10)}
                  </span>
                  <Badge>
                    {t("asset.files", { count: group.members.length })}
                  </Badge>
                  <Badge tone="line">{formatBytes(group.totalBytes)}</Badge>
                </div>
                {onMerge && (
                  <Button
                    variant="primary"
                    size="sm"
                    leadingIcon={<GitMerge size={12} />}
                    onClick={() => onMerge(group.id)}
                  >
                    {t("action.merge")}
                  </Button>
                )}
              </div>
              <div className="grid gap-1">
                {group.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="flex items-center gap-2 rounded-g-sm px-2 py-1.5 text-left transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus data-[preferred=true]:bg-g-green-soft"
                    data-preferred={
                      member.repoPath === group.preferredPath || undefined
                    }
                    onClick={() => onOpenAsset?.(member.id)}
                  >
                    {member.repoPath === group.preferredPath && (
                      <Badge tone="green" className="text-[9px]">
                        {t("duplicates.keep")}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate font-g-mono text-g-caption text-g-ink">
                      {member.repoPath}
                    </span>
                    <span className="font-g-mono text-g-chip text-g-ink-4">
                      {formatBytes(member.bytes)}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ))}
          {groupViews.length === 0 && (
            <EmptyState
              title={t("duplicates.noExact")}
              description={t("duplicates.noExactDesc")}
            />
          )}
        </div>
      )}

      {tab === "similar" && (
        <div className="grid gap-2">
          {nearDuplicates.map((nd) => {
            const left = itemById.get(nd.leftId);
            const right = itemById.get(nd.rightId);
            if (!left || !right) return null;
            return (
              <Card
                key={nd.id}
                padding="md"
                className="flex items-center gap-3.5"
              >
                <div className="flex min-w-0 flex-1 gap-2.5">
                  <AssetThumbnail
                    src={left.thumbnailUrl || left.url}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate font-g-mono text-g-caption font-[510] text-g-ink hover:text-g-ink-2 focus-visible:outline-none focus-visible:shadow-g-focus"
                      onClick={() => onOpenAsset?.(left.id)}
                    >
                      {fileName(left.repoPath)}
                    </button>
                    <div className="truncate text-[10px] text-g-ink-4">
                      {left.repoPath}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <Badge
                    tone={
                      nd.distance <= 5
                        ? "red"
                        : nd.distance <= 8
                          ? "amber"
                          : "blue"
                    }
                    className="text-[10px]"
                  >
                    d={nd.distance}
                  </Badge>
                  {nd.flipped && (
                    <span className="text-[9px] text-g-ink-4">
                      {t("duplicates.flipped")}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 gap-2.5">
                  <AssetThumbnail
                    src={right.thumbnailUrl || right.url}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate font-g-mono text-g-caption font-[510] text-g-ink hover:text-g-ink-2 focus-visible:outline-none focus-visible:shadow-g-focus"
                      onClick={() => onOpenAsset?.(right.id)}
                    >
                      {fileName(right.repoPath)}
                    </button>
                    <div className="truncate text-[10px] text-g-ink-4">
                      {right.repoPath}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {nearDuplicates.length === 0 && (
            <EmptyState
              title={t("duplicates.noSimilar")}
              description={t("duplicates.noSimilarDesc")}
            />
          )}
        </div>
      )}
    </div>
  );
}

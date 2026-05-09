import {
  Check,
  CheckSquare,
  Copy,
  Eye,
  Files,
  GitMerge,
  Layers,
  Link2,
  Search,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  useBatchApplyMutation,
  useBatchDeleteMutation,
  useBatchMergePreviewMutation,
  useCatalogDuplicatesInfiniteQuery,
  useCatalogItemsInfiniteQuery,
} from "../queries";
import type { BatchPreviewResponse } from "../api";
import type { AssetItem } from "../types";
import { fileName, formatBytes, formatExt } from "../ui";
import { useDebouncedValue } from "../useDebouncedValue";
import {
  AssetThumbnail,
  Badge,
  Button,
  Card,
  Checkbox,
  CopyButton,
  EmptyState,
  Modal,
  StatCard,
  Tabs,
  TextInput,
  TextInputClearButton,
} from "./ui";
import { ComparePanel, useCompareTabs } from "./ComparePanel";
import { toCompareAsset, type CompareMode } from "./compareTypes";
import { useInfiniteScrollSentinel } from "../hooks/useInfiniteScrollSentinel";
import { BatchConfirmModal } from "./BatchConfirmModal";
import { BatchPreviewModal } from "./BatchPreviewModal";
import { FilterRail } from "./FilterRail";
import { buildDuplicateGroupViews } from "./duplicateGroupViews";

type Props = {
  scanId?: number;
  projectFilterName?: string;
  enabled?: boolean;
  onOpenAsset?: (id: string) => void;
  onMerge?: (groupId: string) => void;
};

type Tab = "exact" | "similar";
type SortKey = "members" | "size";

const ACTION_BTN =
  "inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus";

export function DuplicatesView({
  scanId,
  projectFilterName = "",
  enabled = true,
  onOpenAsset,
  onMerge,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("exact");
  const [sort, setSort] = useState<SortKey>("members");

  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pathsCopied, setPathsCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState({
    project: "",
    ext: "",
    customFilter: "",
  });

  const exactScrollRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  const effectiveProject = projectFilterName || railFilter.project || undefined;

  /* ── Data fetching ── */

  const duplicateItemsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    {
      projectName: effectiveProject,
      ext: railFilter.ext || undefined,
      q: debouncedSearch || undefined,
      status: "duplicate",
      sort: "path",
      limit: 200,
    },
    enabled,
    0,
  );
  const exactDuplicatesQuery = useCatalogDuplicatesInfiniteQuery(
    scanId,
    {
      kind: "exact",
      projectName: effectiveProject,
      ext: railFilter.ext || undefined,
      limit: 200,
    },
    enabled,
  );
  const nearDuplicatesQuery = useCatalogDuplicatesInfiniteQuery(
    scanId,
    {
      kind: "near",
      projectName: effectiveProject,
      ext: railFilter.ext || undefined,
      limit: 200,
    },
    enabled,
  );
  const {
    fetchNextPage: fetchNextDuplicateItemsPage,
    hasNextPage: hasMoreDuplicateItems,
    isFetchingNextPage: isFetchingMoreDuplicateItems,
  } = duplicateItemsQuery;
  const {
    fetchNextPage: fetchNextExactDuplicatesPage,
    hasNextPage: hasMoreExactDuplicates,
    isFetchingNextPage: isFetchingMoreExactDuplicates,
  } = exactDuplicatesQuery;
  const {
    fetchNextPage: fetchNextNearDuplicatesPage,
    hasNextPage: hasMoreNearDuplicates,
    isFetchingNextPage: isFetchingMoreNearDuplicates,
  } = nearDuplicatesQuery;
  const items = useMemo(
    () => duplicateItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [duplicateItemsQuery.data],
  );
  const groups = useMemo(
    () => exactDuplicatesQuery.data?.pages.flatMap((page) => page.groups) ?? [],
    [exactDuplicatesQuery.data],
  );
  const nearDuplicates = useMemo(
    () => nearDuplicatesQuery.data?.pages.flatMap((page) => page.pairs) ?? [],
    [nearDuplicatesQuery.data],
  );
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const loading =
    (duplicateItemsQuery.isLoading ||
      exactDuplicatesQuery.isLoading ||
      nearDuplicatesQuery.isLoading) &&
    items.length === 0 &&
    groups.length === 0 &&
    nearDuplicates.length === 0;

  /* ── Scroll-triggered pagination ── */

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMoreData =
    hasMoreDuplicateItems || hasMoreExactDuplicates || hasMoreNearDuplicates;
  const isFetchingMore =
    isFetchingMoreDuplicateItems ||
    isFetchingMoreExactDuplicates ||
    isFetchingMoreNearDuplicates;

  const loadMorePages = useCallback(() => {
    if (hasMoreDuplicateItems && !isFetchingMoreDuplicateItems)
      void fetchNextDuplicateItemsPage();
    if (hasMoreExactDuplicates && !isFetchingMoreExactDuplicates)
      void fetchNextExactDuplicatesPage();
    if (hasMoreNearDuplicates && !isFetchingMoreNearDuplicates)
      void fetchNextNearDuplicatesPage();
  }, [
    fetchNextDuplicateItemsPage,
    hasMoreDuplicateItems,
    isFetchingMoreDuplicateItems,
    fetchNextExactDuplicatesPage,
    hasMoreExactDuplicates,
    isFetchingMoreExactDuplicates,
    fetchNextNearDuplicatesPage,
    hasMoreNearDuplicates,
    isFetchingMoreNearDuplicates,
  ]);

  useInfiniteScrollSentinel({
    rootRef: exactScrollRef,
    sentinelRef: loadMoreRef,
    enabled: hasMoreData && !isFetchingMore,
    onLoadMore: loadMorePages,
  });

  /* ── Computed views ── */

  const groupViews = useMemo(
    () => buildDuplicateGroupViews(groups, items, sort, debouncedSearch),
    [groups, items, sort, debouncedSearch],
  );

  const totalSavings = useMemo(
    () => groupViews.reduce((sum, g) => sum + g.savings, 0),
    [groupViews],
  );

  const selectedBytes = useMemo(
    () =>
      items
        .filter((i) => selected.has(i.id))
        .reduce((sum, i) => sum + i.bytes, 0),
    [items, selected],
  );

  /* ── Search & filter (server-side via query params) ── */

  const groupedByExt = useMemo(() => {
    if (railFilter.ext) {
      return [{ ext: railFilter.ext, groups: groupViews }];
    }
    const map = new Map<string, typeof groupViews>();
    for (const g of groupViews) {
      const ext = g.members[0]?.ext || "";
      const list = map.get(ext) || [];
      list.push(g);
      map.set(ext, list);
    }
    if (map.size <= 1) return null;
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([ext, gs]) => ({ ext, groups: gs }));
  }, [groupViews, railFilter.ext]);

  type VRow = { group: (typeof groupViews)[number]; sectionExt?: string };

  const virtualRows = useMemo<VRow[]>(() => {
    if (groupedByExt) {
      const rows: VRow[] = [];
      for (const section of groupedByExt) {
        for (let i = 0; i < section.groups.length; i++) {
          rows.push({
            group: section.groups[i],
            sectionExt: i === 0 ? section.ext : undefined,
          });
        }
      }
      return rows;
    }
    return groupViews.map((g) => ({ group: g }));
  }, [groupedByExt, groupViews]);

  // eslint-disable-next-line react-hooks/incompatible-library -- intentional virtual scroll for 900+ groups
  const exactVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => exactScrollRef.current,
    estimateSize: () => 280,
    overscan: 6,
  });
  const exactVirtualItems = exactVirtualizer.getVirtualItems();

  /* ── Selection callbacks ── */

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBulkMode = useCallback(() => {
    setBulkMode((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
  }, []);

  const toggleGroupSelect = useCallback(
    (members: AssetItem[], preferredPath: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const removable = members.filter((m) => m.repoPath !== preferredPath);
        const allSelected = removable.every((m) => next.has(m.id));
        for (const m of removable) {
          if (allSelected) next.delete(m.id);
          else next.add(m.id);
        }
        return next;
      });
    },
    [],
  );

  /* ── Copy paths ── */

  useEffect(() => {
    if (!pathsCopied) return;
    const timer = window.setTimeout(() => setPathsCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [pathsCopied]);

  function copyPaths() {
    const paths = items
      .filter((i) => selected.has(i.id))
      .map((i) => i.repoPath);
    navigator.clipboard?.writeText(paths.join("\n"));
    setPathsCopied(true);
  }

  /* ── Batch delete ── */

  const batchDeleteMut = useBatchDeleteMutation();

  function handleBatchDelete() {
    batchDeleteMut.mutate(Array.from(selected), {
      onSuccess: () => {
        setSelected(new Set());
        setBulkMode(false);
        setShowDeleteConfirm(false);
      },
    });
  }

  /* ── Batch merge ── */

  const [mergePreview, setMergePreview] = useState<BatchPreviewResponse | null>(
    null,
  );
  const batchMergePreviewMut = useBatchMergePreviewMutation();
  const batchApplyMut = useBatchApplyMutation();

  const preferredPaths = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groupViews) {
      map[g.id] = g.preferredPath;
    }
    return map;
  }, [groupViews]);

  function handleMergePreview() {
    batchMergePreviewMut.mutate(
      { assetIds: Array.from(selected), preferredPaths },
      { onSuccess: (data) => setMergePreview(data) },
    );
  }

  function handleMergeApply() {
    if (!mergePreview) return;
    batchApplyMut.mutate(
      {
        endpoint: "/api/actions/batch/merge-duplicates/apply",
        token: mergePreview.token,
      },
      {
        onSuccess: () => {
          setMergePreview(null);
          setSelected(new Set());
          setBulkMode(false);
        },
      },
    );
  }

  /* ── Render helpers ── */

  function renderGroupCard(group: (typeof groupViews)[number]) {
    const representative = group.members[0];
    const nonPreferred = group.members.filter(
      (m) => m.repoPath !== group.preferredPath,
    );
    const groupAllSelected =
      nonPreferred.length > 0 && nonPreferred.every((m) => selected.has(m.id));

    return (
      <Card key={group.id} padding="md">
        <div
          className={cn(
            "mb-3 flex items-center gap-2",
            bulkMode &&
              "cursor-pointer rounded-g-sm -mx-1 px-1 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2",
          )}
          onClick={
            bulkMode
              ? () => toggleGroupSelect(group.members, group.preferredPath)
              : undefined
          }
          role={bulkMode ? "button" : undefined}
        >
          {bulkMode && (
            <Checkbox
              checked={groupAllSelected}
              size="md"
              aria-label={
                groupAllSelected ? t("action.deselect") : t("action.select")
              }
              onCheckedChange={() =>
                toggleGroupSelect(group.members, group.preferredPath)
              }
            />
          )}
          {representative && (
            <AssetThumbnail
              src={representative.thumbnailUrl || representative.url}
              size="md"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-g-mono text-g-caption text-g-ink-3">
                {group.contentHash.slice(0, 10)}
              </span>
              <Badge>{t("asset.files", { count: group.members.length })}</Badge>
              <Badge tone="line">{formatBytes(group.totalBytes)}</Badge>
            </div>
            {group.savings > 0 && (
              <span className="font-g-mono text-g-chip text-g-green">
                {t("duplicates.canSave", {
                  size: formatBytes(group.savings),
                })}
              </span>
            )}
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
          {group.members.map((member) => {
            const isPreferred = member.repoPath === group.preferredPath;
            const isSelected = selected.has(member.id);
            return (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "group relative flex cursor-pointer flex-col overflow-hidden rounded-g-md border text-left",
                  "transition-all duration-[120ms] ease-g",
                  "focus-visible:outline-none focus-visible:shadow-g-focus",
                  "hover:-translate-y-px hover:shadow-g-md",
                  isSelected
                    ? "ring-2 ring-g-accent border-g-accent bg-g-surface-2"
                    : isPreferred
                      ? "border-g-green bg-g-green-soft shadow-g-sm"
                      : "border-g-line hover:border-g-line-strong hover:bg-g-surface-2",
                )}
                onClick={() => {
                  if (bulkMode && !isPreferred) {
                    toggleSelect(member.id);
                  } else {
                    onOpenAsset?.(member.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (bulkMode && !isPreferred) {
                      toggleSelect(member.id);
                    } else {
                      onOpenAsset?.(member.id);
                    }
                  }
                }}
              >
                <AssetThumbnail
                  src={member.thumbnailUrl || member.url}
                  size="fill"
                  className="rounded-none border-0"
                />
                {isPreferred && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-[3px] rounded-g-sm border px-1.5 py-[3px] text-[10px] font-[590] leading-none tracking-[0.02em] shadow-g-sm border-[color-mix(in_srgb,var(--g-green)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-green)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-green)_78%,var(--g-ink)_22%)]">
                    <Check size={10} strokeWidth={3} />
                    {t("duplicates.keep")}
                  </span>
                )}
                {bulkMode && !isPreferred && (
                  <Checkbox
                    asChild
                    checked={isSelected}
                    tabIndex={-1}
                    size="md"
                    className="absolute right-1.5 top-1.5 pointer-events-none shadow-g-sm"
                    aria-label={
                      isSelected ? t("action.deselect") : t("action.select")
                    }
                  />
                )}
                {!bulkMode && (
                  <span className="absolute right-1.5 top-1.5 rounded-g-sm bg-g-surface/80 shadow-g-sm backdrop-blur-sm opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
                    <CopyButton value={member.repoPath} size="sm" />
                  </span>
                )}
                <div className="flex min-w-0 flex-col gap-1 px-2.5 py-2.5">
                  <span className="truncate font-g-mono text-g-ui font-[510] text-g-ink">
                    {fileName(member.repoPath)}
                  </span>
                  <span className="truncate font-g-mono text-g-caption text-g-ink-4">
                    {member.repoPath}
                  </span>
                  <span className="font-g-mono text-g-caption text-g-ink-3">
                    {formatBytes(member.bytes)}
                    {member.image.width > 0 && (
                      <span className="text-g-ink-4">
                        {" "}
                        &middot; {member.image.width}&times;
                        {member.image.height}
                      </span>
                    )}
                    {member.references.length > 0 && (
                      <span className="text-g-ink-4">
                        {" "}
                        &middot; <Link2 size={10} className="mb-px inline" />
                        {member.references.length}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  /* ── Render ── */

  const exactFirstPage = exactDuplicatesQuery.data?.pages[0];
  const nearFirstPage = nearDuplicatesQuery.data?.pages[0];

  return (
    <>
      <FilterRail
        items={items}
        filters={railFilter}
        projectOptions={exactFirstPage?.facets.projects}
        projectTotal={exactFirstPage?.facets.projectTotal}
        projectScopeName={projectFilterName}
        extensionOptions={exactFirstPage?.facets.extensions}
        extensionTotal={exactFirstPage?.facets.extensionTotal}
        extensionHeading={t("duplicates.filterByExt")}
        extensionAllLabel={t("duplicates.allGroups")}
        onFiltersChange={setRailFilter}
      />
      <div
        ref={exactScrollRef}
        className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0"
      >
        <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
          {/* ── Stats dashboard ── */}
          {!loading && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard
                label={t("duplicates.statGroups")}
                value={exactFirstPage?.total ?? groupViews.length}
                icon={<Layers size={14} />}
              />
              <StatCard
                label={t("duplicates.statFiles")}
                value={exactFirstPage?.totalFiles ?? items.length}
                icon={<Files size={14} />}
              />
              <StatCard
                label={t("duplicates.statSavings")}
                value={formatBytes(totalSavings)}
                icon={<TrendingDown size={14} />}
              />
              <StatCard
                label={t("duplicates.statSimilar")}
                value={nearFirstPage?.total ?? nearDuplicates.length}
                icon={<Eye size={14} />}
              />
            </div>
          )}

          {/* ── Sticky filter + action bar ── */}
          <div className="sticky top-0 z-10 bg-g-canvas pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Tabs
                value={tab}
                ariaLabel={t("duplicates.title")}
                onChange={(v) => {
                  setTab(v);
                  setSelected(new Set());
                  setBulkMode(false);
                }}
                items={[
                  {
                    value: "exact",
                    label: t("duplicates.exact"),
                    badge: (
                      <span className="font-[400] text-g-ink-4">
                        {exactFirstPage?.total ?? groups.length}
                      </span>
                    ),
                  },
                  {
                    value: "similar",
                    label: t("duplicates.similar"),
                    badge: (
                      <span className="font-[400] text-g-ink-4">
                        {nearFirstPage?.total ?? nearDuplicates.length}
                      </span>
                    ),
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
              {tab === "exact" && (
                <TextInput
                  variant="search"
                  placeholder={t("duplicates.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<Search size={14} />}
                  suffix={
                    search ? (
                      <TextInputClearButton
                        label={t("toolbar.clearSearch")}
                        onClick={() => setSearch("")}
                      />
                    ) : undefined
                  }
                  className="min-w-0 flex-[1_1_180px]"
                />
              )}
              {tab === "exact" && (
                <Button
                  variant={bulkMode ? "primary" : "secondary"}
                  size="md"
                  leadingIcon={<CheckSquare size={14} />}
                  onClick={toggleBulkMode}
                  className="shrink-0"
                >
                  {bulkMode ? t("action.deselectAll") : t("toolbar.bulkSelect")}
                </Button>
              )}
            </div>

            {bulkMode && selected.size > 0 && (
              <div className="mt-2 flex min-h-[44px] items-center gap-0.5 rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
                <span className="inline-flex min-h-[34px] items-center px-2.5 font-g-mono text-g-body text-g-ink-2">
                  {t("selection.summary", {
                    count: selected.size,
                    size: formatBytes(selectedBytes),
                  })}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  className={ACTION_BTN}
                  onClick={copyPaths}
                >
                  {pathsCopied ? <Check size={14} /> : <Copy size={14} />}
                  {pathsCopied ? t("toast.copied") : t("action.copyPaths")}
                </button>
                <button
                  type="button"
                  className={ACTION_BTN}
                  onClick={handleMergePreview}
                  disabled={batchMergePreviewMut.isPending}
                >
                  <GitMerge size={14} />
                  {t("action.merge")}
                </button>
                <button
                  type="button"
                  className={ACTION_BTN}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 size={14} />
                  {t("action.deleteSelected")}
                </button>
              </div>
            )}

            {tab === "exact" &&
              groupViews.length > 0 &&
              (() => {
                const vis = exactVirtualItems;
                const scrollTop = exactScrollRef.current?.scrollTop ?? 0;
                let activeExt: string | undefined;
                for (let i = vis.length - 1; i >= 0; i--) {
                  const r = virtualRows[vis[i].index];
                  if (r.sectionExt && vis[i].start <= scrollTop) {
                    activeExt = r.sectionExt;
                    break;
                  }
                }
                if (!activeExt) activeExt = groupViews[0]?.members[0]?.ext;
                if (!activeExt) return null;
                const count =
                  exactFirstPage?.facets.extensions?.find(
                    (f) => f.id === activeExt,
                  )?.count ?? groupViews.length;
                return (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-g-mono text-g-ui font-[510] uppercase text-g-ink-3">
                      {formatExt(activeExt)}
                    </span>
                    <Badge>{count}</Badge>
                    <span className="h-px flex-1 bg-g-line" />
                  </div>
                );
              })()}
          </div>

          {/* ── Content ── */}

          {loading ? (
            <EmptyState title={t("common.loading")} />
          ) : tab === "exact" ? (
            virtualRows.length === 0 ? (
              <EmptyState
                title={t("duplicates.noExact")}
                description={t("duplicates.noExactDesc")}
              />
            ) : (
              <div
                className="relative w-full"
                style={{ height: exactVirtualizer.getTotalSize() }}
              >
                {exactVirtualItems.map((vItem) => {
                  const row = virtualRows[vItem.index];
                  return (
                    <div
                      key={vItem.key}
                      className="absolute left-0 top-0 w-full"
                      style={{
                        transform: `translateY(${vItem.start}px)`,
                      }}
                      ref={exactVirtualizer.measureElement}
                      data-index={vItem.index}
                    >
                      <div className="pb-4">{renderGroupCard(row.group)}</div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          {hasMoreData && (
            <div
              ref={loadMoreRef}
              className="flex items-center justify-center py-6 text-g-caption text-g-ink-4"
            >
              {isFetchingMore ? t("common.loading") : null}
            </div>
          )}

          {/* ── Similar tab ── */}

          {!loading && tab === "similar" && (
            <div className="grid gap-4">
              {nearDuplicates.map((nd) => {
                const left = itemById.get(nd.leftId);
                const right = itemById.get(nd.rightId);
                if (!left || !right) return null;
                return (
                  <SimilarPairCard
                    key={nd.id}
                    nd={nd}
                    left={left}
                    right={right}
                  />
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

          {/* ── Delete confirmation ── */}
          {showDeleteConfirm && (
            <BatchConfirmModal
              count={selected.size}
              sizeLabel={formatBytes(selectedBytes)}
              working={batchDeleteMut.isPending}
              onCancel={() => setShowDeleteConfirm(false)}
              onConfirm={handleBatchDelete}
            />
          )}

          {/* ── Merge confirmation ── */}
          {mergePreview &&
            ((mergePreview.preview.blockers?.length ?? 0) > 0 ? (
              <BatchPreviewModal
                title={t("action.merge")}
                moves={mergePreview.preview.moves ?? []}
                changes={mergePreview.preview.changes ?? []}
                blockers={mergePreview.preview.blockers ?? []}
                canApply={mergePreview.preview.canApply}
                working={batchApplyMut.isPending}
                onCancel={() => setMergePreview(null)}
                onApply={handleMergeApply}
              />
            ) : (
              <Modal
                title={t("duplicates.mergeConfirmTitle", {
                  count: selected.size,
                })}
                onClose={() => setMergePreview(null)}
                size="sm"
                footer={
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setMergePreview(null)}
                      disabled={batchApplyMut.isPending}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      leadingIcon={<GitMerge size={12} />}
                      onClick={handleMergeApply}
                      disabled={batchApplyMut.isPending}
                    >
                      {t("action.merge")}
                    </Button>
                  </div>
                }
              >
                <p className="text-g-body text-g-ink-2">
                  {t("duplicates.mergeConfirmBody", {
                    count: selected.size,
                    size: formatBytes(selectedBytes),
                    refs: mergePreview.preview.changes?.length ?? 0,
                  })}
                </p>
              </Modal>
            ))}
        </div>
      </div>
    </>
  );
}

/* ── Similar pair card ── */

function SimilarPairCard({
  nd,
  left,
  right,
}: {
  nd: { id: string; distance: number; flipped: boolean };
  left: AssetItem;
  right: AssetItem;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CompareMode>("side");
  const tabItems = useCompareTabs();

  return (
    <Card padding="md">
      <div className="mb-2 flex items-center gap-2">
        <Badge
          tone={nd.distance <= 5 ? "red" : nd.distance <= 8 ? "amber" : "blue"}
        >
          {Math.round((1 - nd.distance / 64) * 100)}%
        </Badge>
        {nd.flipped && (
          <span className="text-[9px] text-g-ink-4">
            {t("duplicates.flipped")}
          </span>
        )}
        <span className="flex-1" />
        <Tabs
          value={mode}
          ariaLabel="Compare mode"
          onChange={setMode}
          items={tabItems}
        />
      </div>

      <ComparePanel
        left={toCompareAsset(left)}
        right={toCompareAsset(right)}
        mode={mode}
      />
    </Card>
  );
}

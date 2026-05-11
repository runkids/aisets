import {
  ArrowLeftRight,
  CheckCircle2,
  GitCompareArrows,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { useElementHeight } from "../../hooks/useElementHeight";
import { errorMessage } from "../../i18n";
import {
  defaultScanSelection,
  filterScanDiffRows,
  formatSignedBytes,
  formatSignedNumber,
  scanDiffRows,
  sortedScans,
  summaryChangeCount,
  summaryHasChanges,
  type ScanDiffCategory,
  type ScanDiffRow,
} from "../../scanHistory";
import type { ScanDiff, ScanSummary } from "../../types";
import { fileName, formatBytes } from "../../ui";
import { useScanDiffQuery, useScansQuery } from "../../queries";
import {
  Badge,
  EmptyState,
  IconButton,
  Notice,
  Rail,
  RailItem,
  RailSection,
  Select,
  StackedBar,
  StatCard,
  Tabs,
  TextInput,
  TextInputClearButton,
  Tooltip,
  type StackedBarSegment,
  type TabItem,
} from "../ui";

const categories: ScanDiffCategory[] = [
  "all",
  "added",
  "removed",
  "modified",
  "references",
  "becameUnused",
  "noLongerUnused",
];

const diffColumns = [
  "status",
  "path",
  "project",
  "ext",
  "bytes",
  "references",
] as const;

const DIFF_ROW_HEIGHT = 52;
const diffGridCols =
  "grid-cols-[90px_minmax(140px,2fr)_minmax(90px,1fr)_70px_minmax(100px,1fr)_80px]";

type RailFilter = { project: string; ext: string };

function formatScanDate(
  scan: Pick<ScanSummary, "completedAt" | "startedAt">,
  locale: string,
) {
  const date = new Date(scan.completedAt || scan.startedAt);
  return Number.isNaN(date.getTime())
    ? scan.completedAt || scan.startedAt || ""
    : date.toLocaleString(locale);
}

function scanLabel(
  scan: {
    id: number;
    completedAt?: string;
    startedAt: string;
  },
  locale: string,
) {
  const formatted = formatScanDate(scan, locale);
  return formatted ? `${formatted} · #${scan.id}` : `#${scan.id}`;
}

function rowTone(category: ScanDiffRow["category"]) {
  switch (category) {
    case "added":
    case "noLongerUnused":
      return "green" as const;
    case "removed":
    case "becameUnused":
      return "red" as const;
    case "modified":
      return "amber" as const;
    case "references":
      return "blue" as const;
  }
}

function rowBorderColor(category: ScanDiffRow["category"]) {
  switch (category) {
    case "added":
    case "noLongerUnused":
      return "border-l-g-green";
    case "removed":
    case "becameUnused":
      return "border-l-g-red";
    case "modified":
      return "border-l-g-amber";
    case "references":
      return "border-l-g-blue";
  }
}

function countLabel(value: number | undefined) {
  return value == null ? "—" : value.toLocaleString();
}

function bytesLabel(value: number | undefined) {
  return value == null ? "—" : formatBytes(value);
}

function computeFacets(
  rows: ScanDiffRow[],
  key: "projectName" | "ext",
  crossFilter: Partial<RailFilter>,
) {
  const filtered = rows.filter((r) => {
    if (crossFilter.project && r.projectName !== crossFilter.project)
      return false;
    if (crossFilter.ext && r.ext !== crossFilter.ext) return false;
    return true;
  });
  const map = new Map<string, number>();
  for (const r of filtered) {
    const val = r[key];
    if (val) map.set(val, (map.get(val) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

function facetTotal(facets: Array<{ count: number }>) {
  return facets.reduce((sum, f) => sum + f.count, 0);
}

function ScanSnapshotColumn({
  label,
  scan,
}: {
  label: string;
  scan: ScanSummary;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const metrics = [
    {
      label: t("history.metric.profile"),
      value: t(`settings.scanProfile.${scan.profile}`, {
        defaultValue: scan.profile,
      }),
    },
    {
      label: t("history.metric.totalAssets"),
      value: scan.totalFiles.toLocaleString(locale),
    },
    {
      label: t("history.metric.duplicates"),
      value: scan.duplicateGroups.toLocaleString(locale),
    },
    {
      label: t("history.metric.unused"),
      value: scan.unusedFiles.toLocaleString(locale),
    },
    {
      label: t("history.metric.nearDuplicates"),
      value: scan.nearDuplicates.toLocaleString(locale),
    },
    {
      label: t("history.metric.cacheHits"),
      value: scan.cacheHits.toLocaleString(locale),
    },
  ];

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-g-caption font-[590] uppercase tracking-[0.06em] text-g-ink-4">
            {label}
          </div>
          <div className="mt-1 font-g-display text-2xl font-[590] leading-none text-g-ink">
            #{scan.id}
          </div>
        </div>
        <Badge tone="line">
          {t(`history.scanStatus.${scan.status}`, {
            defaultValue: scan.status,
          })}
        </Badge>
      </div>
      <div className="mb-3 text-g-caption text-g-ink-3">
        {formatScanDate(scan, locale)}
      </div>
      <div className="grid gap-1.5">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex items-center justify-between gap-3 rounded-g-sm bg-g-surface-2 px-2.5 py-1.5"
          >
            <span className="text-g-caption text-g-ink-4">{metric.label}</span>
            <span className="font-g-mono text-g-caption font-[510] text-g-ink-2">
              {metric.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonSummaryPanel({
  diff,
  hasChanges,
}: {
  diff: ScanDiff;
  hasChanges: boolean;
}) {
  const { t } = useTranslation();
  const unusedChanges = diff.summary.becameUnused + diff.summary.noLongerUnused;
  const changeCount = summaryChangeCount(diff);
  const changeChips = hasChanges
    ? [
        t("history.changeChip.added", { count: diff.summary.added }),
        t("history.changeChip.removed", { count: diff.summary.removed }),
        t("history.changeChip.modified", { count: diff.summary.modified }),
        t("history.changeChip.references", {
          count: diff.summary.referenceChanged,
        }),
        t("history.changeChip.unused", { count: unusedChanges }),
        t("history.changeChip.duplicates", {
          value: formatSignedNumber(diff.summary.duplicateGroupsDelta),
        }),
        t("history.changeChip.nearDuplicates", {
          value: formatSignedNumber(diff.summary.nearDuplicatesDelta),
        }),
        t("history.changeChip.bytes", {
          value: formatSignedBytes(diff.summary.totalByteDelta),
        }),
      ]
    : [
        t("history.stableCheck.assets"),
        t("history.stableCheck.references"),
        t("history.stableCheck.unused"),
        t("history.stableCheck.bytes"),
        t("history.stableCheck.optimization"),
      ];

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start gap-2.5 rounded-g-md border border-g-line bg-g-surface-2 p-3">
        <CheckCircle2
          size={18}
          className={
            hasChanges
              ? "mt-px shrink-0 text-g-blue"
              : "mt-px shrink-0 text-g-green"
          }
        />
        <div className="min-w-0">
          <div className="font-[590] text-g-ink">
            {hasChanges
              ? t("history.changesTitle", { count: changeCount })
              : t("history.noChangesTitle")}
          </div>
          <div className="mt-0.5 text-g-ui text-g-ink-3">
            {hasChanges ? t("history.changesDesc") : t("history.noChangesDesc")}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <ScanSnapshotColumn label={t("history.baseScan")} scan={diff.base} />
        <div className="hidden w-px bg-g-line lg:block" />
        <ScanSnapshotColumn
          label={t("history.targetScan")}
          scan={diff.target}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {changeChips.map((check) => (
          <Badge key={check} tone={hasChanges ? "blue" : "green"}>
            <CheckCircle2 size={11} />
            {check}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function buildStackedBarSegments(
  diff: ScanDiff,
  t: (key: string) => string,
): StackedBarSegment[] {
  const s = diff.summary;
  const unusedTotal = s.becameUnused + s.noLongerUnused;
  const segments: StackedBarSegment[] = [];
  if (s.added > 0)
    segments.push({
      value: s.added,
      tone: "green",
      label: t("history.category.added"),
    });
  if (s.removed > 0)
    segments.push({
      value: s.removed,
      tone: "red",
      label: t("history.category.removed"),
    });
  if (s.modified > 0)
    segments.push({
      value: s.modified,
      tone: "amber",
      label: t("history.category.modified"),
    });
  if (s.referenceChanged > 0)
    segments.push({
      value: s.referenceChanged,
      tone: "blue",
      label: t("history.category.references"),
    });
  if (unusedTotal > 0)
    segments.push({
      value: unusedTotal,
      tone: "purple",
      label: t("history.stat.unused"),
    });
  return segments;
}

const SHELL_CLASS =
  "flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12";

export function ScanHistoryView() {
  const { t, i18n } = useTranslation();
  const scansQuery = useScansQuery();
  const scans = useMemo(
    () => sortedScans(scansQuery.data?.scans ?? []),
    [scansQuery.data?.scans],
  );
  const [selection, setSelection] = useState<{
    baseId: number;
    targetId: number;
  } | null>(null);
  const [category, setCategory] = useState<ScanDiffCategory>("all");
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>({
    project: "",
    ext: "",
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toolbarH, toolbarRef] = useElementHeight();

  const defaultSelection = useMemo(() => defaultScanSelection(scans), [scans]);
  const scanIdSet = useMemo(
    () => new Set(scans.map((scan) => scan.id)),
    [scans],
  );
  const selectionValid =
    selection != null &&
    scanIdSet.has(selection.baseId) &&
    scanIdSet.has(selection.targetId);
  const baseId = selectionValid ? selection.baseId : defaultSelection?.baseId;
  const targetId = selectionValid
    ? selection.targetId
    : defaultSelection?.targetId;
  const sameScan = baseId != null && targetId != null && baseId === targetId;
  const diffQuery = useScanDiffQuery(
    sameScan ? undefined : baseId,
    sameScan ? undefined : targetId,
  );
  const diff = diffQuery.data;
  const hasSummaryChanges = diff ? summaryHasChanges(diff) : false;
  const rows = useMemo(() => (diff ? scanDiffRows(diff) : []), [diff]);

  const projectFacets = useMemo(
    () => computeFacets(rows, "projectName", { ext: railFilter.ext }),
    [rows, railFilter.ext],
  );
  const extFacets = useMemo(
    () => computeFacets(rows, "ext", { project: railFilter.project }),
    [rows, railFilter.project],
  );
  const projectTotal = useMemo(
    () => facetTotal(projectFacets),
    [projectFacets],
  );
  const extTotal = useMemo(() => facetTotal(extFacets), [extFacets]);

  const visibleRows = useMemo(
    () =>
      filterScanDiffRows({ rows, category, query: search }).filter((r) => {
        if (railFilter.project && r.projectName !== railFilter.project)
          return false;
        if (railFilter.ext && r.ext !== railFilter.ext) return false;
        return true;
      }),
    [category, rows, search, railFilter],
  );

  const virtualContainerRef = useRef<HTMLDivElement>(null);
  const scrollMargin = virtualContainerRef.current?.offsetTop ?? 0;

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DIFF_ROW_HEIGHT,
    getItemKey: (i) => visibleRows[i]?.id ?? i,
    overscan: 12,
    scrollMargin,
  });

  const segments: StackedBarSegment[] = useMemo(
    () => (diff ? buildStackedBarSegments(diff, t) : []),
    [diff, t],
  );

  const scanOptions = useMemo(
    () =>
      scans.map((scan) => ({
        value: String(scan.id),
        label: scanLabel(scan, i18n.language),
        description: t("history.scanOptionMeta", {
          count: scan.totalFiles.toLocaleString(i18n.language),
          profile: t(`settings.scanProfile.${scan.profile}`, {
            defaultValue: scan.profile,
          }),
        }),
      })),
    [scans, t, i18n.language],
  );

  const tabItems: Array<TabItem<ScanDiffCategory>> = useMemo(
    () =>
      categories.map((value) => ({
        value,
        label: t(`history.category.${value}`),
      })),
    [t],
  );

  if (scansQuery.isLoading) {
    return (
      <div className={SHELL_CLASS}>
        <div className="mx-auto w-full max-w-[1600px]">
          <Notice loading>{t("history.loading")}</Notice>
        </div>
      </div>
    );
  }

  if (scans.length === 0) {
    return (
      <div className={SHELL_CLASS}>
        <div className="mx-auto w-full max-w-[900px]">
          <EmptyState
            title={t("history.emptyTitle")}
            description={t("history.emptyDesc")}
          />
        </div>
      </div>
    );
  }

  if (scans.length === 1) {
    return (
      <div className={SHELL_CLASS}>
        <div className="mx-auto w-full max-w-[900px]">
          <EmptyState
            title={t("history.singleTitle")}
            description={t("history.singleDesc")}
          />
        </div>
      </div>
    );
  }

  function onSwap() {
    if (baseId != null && targetId != null) {
      setSelection({ baseId: targetId, targetId: baseId });
    }
  }

  return (
    <>
      <Rail className="ml-3 px-0">
        <RailSection heading={t("filter.project")}>
          <RailItem
            active={railFilter.project === ""}
            label={t("filter.allProjects")}
            count={projectTotal}
            onClick={() => setRailFilter((f) => ({ ...f, project: "" }))}
          />
          {projectFacets.map((p) => (
            <RailItem
              key={p.id}
              active={railFilter.project === p.id}
              label={p.id}
              count={p.count}
              onClick={() =>
                setRailFilter((f) => ({
                  ...f,
                  project: f.project === p.id ? "" : p.id,
                }))
              }
            />
          ))}
        </RailSection>

        <RailSection heading={t("filter.extension")}>
          <RailItem
            active={railFilter.ext === ""}
            label={t("filter.allExtensions")}
            count={extTotal}
            onClick={() => setRailFilter((f) => ({ ...f, ext: "" }))}
          />
          {extFacets.map((e) => (
            <RailItem
              key={e.id}
              active={railFilter.ext === e.id}
              label={e.id}
              count={e.count}
              onClick={() =>
                setRailFilter((f) => ({
                  ...f,
                  ext: f.ext === e.id ? "" : e.id,
                }))
              }
            />
          ))}
        </RailSection>
      </Rail>

      <div
        ref={scrollRef}
        className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0"
      >
        <div className="mx-auto max-w-[1600px] pb-6">
          {diff && (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard
                  label={t("history.stat.added")}
                  value={diff.summary.added}
                  icon={<PlusCircle size={14} />}
                  tone={diff.summary.added > 0 ? "green" : "neutral"}
                />
                <StatCard
                  label={t("history.stat.removed")}
                  value={diff.summary.removed}
                  icon={<MinusCircle size={14} />}
                  tone={diff.summary.removed > 0 ? "red" : "neutral"}
                />
                <StatCard
                  label={t("history.stat.modified")}
                  value={diff.summary.modified}
                  icon={<RefreshCw size={14} />}
                  tone={diff.summary.modified > 0 ? "amber" : "neutral"}
                />
                <StatCard
                  label={t("history.stat.references")}
                  value={diff.summary.referenceChanged}
                  icon={<GitCompareArrows size={14} />}
                />
              </div>

              {segments.length > 0 && (
                <StackedBar
                  segments={segments}
                  className="mb-4"
                  ariaLabel={t("history.healthBar")}
                />
              )}
            </>
          )}

          <div
            ref={toolbarRef}
            className="sticky top-0 z-[4] bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] pb-3 backdrop-blur-[12px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={baseId != null ? String(baseId) : ""}
                options={scanOptions}
                onChange={(v) => {
                  const id = Number(v);
                  setSelection({ baseId: id, targetId: targetId ?? id });
                }}
                aria-label={t("history.baseScan")}
                className="min-w-[200px] flex-[1_1_220px]"
              />
              <IconButton
                onClick={onSwap}
                aria-label={t("history.swapScans")}
                size="md"
              >
                <ArrowLeftRight />
              </IconButton>
              <Select
                value={targetId != null ? String(targetId) : ""}
                options={scanOptions}
                onChange={(v) => {
                  const id = Number(v);
                  setSelection({ baseId: baseId ?? id, targetId: id });
                }}
                aria-label={t("history.targetScan")}
                className="min-w-[200px] flex-[1_1_220px]"
              />
              <Tabs
                value={category}
                items={tabItems}
                onChange={setCategory}
                ariaLabel={t("history.categoryAria")}
                className="max-w-full overflow-x-auto"
              />
              <TextInput
                variant="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("history.searchPlaceholder")}
                icon={<Search size={14} />}
                suffix={
                  search ? (
                    <TextInputClearButton
                      label={t("toolbar.clearSearch")}
                      onClick={() => setSearch("")}
                    />
                  ) : undefined
                }
                className="min-w-[180px] flex-[1_1_220px]"
              />
            </div>
          </div>

          {sameScan && (
            <Notice tone="warning" title={t("history.sameScanTitle")}>
              {t("history.sameScanDesc")}
            </Notice>
          )}

          {diffQuery.error && (
            <Notice tone="danger" title={t("history.diffError")}>
              {errorMessage(diffQuery.error)}
            </Notice>
          )}

          <div className="rounded-g-md border border-g-line bg-g-surface shadow-g-sm">
            {diffQuery.isLoading ? (
              <div className="p-3">
                <Notice loading>{t("history.diffLoading")}</Notice>
              </div>
            ) : rows.length === 0 && diff ? (
              <ComparisonSummaryPanel
                diff={diff}
                hasChanges={hasSummaryChanges}
              />
            ) : visibleRows.length === 0 && rows.length > 0 ? (
              <div className="p-8">
                <EmptyState title={t("history.noFilteredChanges")} size="sm" />
              </div>
            ) : diff ? (
              <>
                <ComparisonSummaryPanel
                  diff={diff}
                  hasChanges={hasSummaryChanges}
                />
                <div className="border-t border-g-line text-g-ui" role="table">
                  <div
                    className={`sticky z-[2] grid ${diffGridCols} items-center border-b border-g-line border-l-[3px] border-l-transparent bg-g-surface-2 pl-5 text-g-caption uppercase tracking-[0.06em] text-g-ink-4`}
                    style={{ top: `${toolbarH}px` }}
                    role="row"
                  >
                    {diffColumns.map((col) => (
                      <div
                        key={col}
                        className="px-3 py-2 font-[590]"
                        role="columnheader"
                      >
                        {t(`history.column.${col}`)}
                      </div>
                    ))}
                  </div>
                  <div
                    ref={virtualContainerRef}
                    className="relative w-full"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    role="rowgroup"
                  >
                    {rowVirtualizer.getVirtualItems().map((vItem) => {
                      const row = visibleRows[vItem.index];
                      if (!row) return null;
                      return (
                        <div
                          key={row.id}
                          className={cn(
                            `absolute left-0 top-0 grid w-full ${diffGridCols} items-center border-b border-g-line border-l-[3px] pl-5 transition-colors duration-75 translate-y-[var(--row-y,0)] hover:bg-g-surface-2`,
                            rowBorderColor(row.category),
                          )}
                          style={
                            {
                              "--row-y": `${vItem.start - scrollMargin}px`,
                            } as CSSProperties
                          }
                          role="row"
                        >
                          <div className="px-3 py-2.5">
                            <Badge tone={rowTone(row.category)}>
                              {t(`history.category.${row.category}`)}
                            </Badge>
                          </div>
                          <Tooltip
                            label={row.repoPath}
                            placement="top"
                            contentClassName="max-w-[420px] whitespace-normal break-words"
                          >
                            <div className="overflow-hidden px-3 py-2.5">
                              <span className="block truncate font-g-mono text-g-body font-medium text-g-ink">
                                {fileName(row.repoPath)}
                              </span>
                              <span className="block truncate font-g-mono text-g-chip text-g-ink-4">
                                {row.repoPath.split("/").slice(0, -1).join("/")}
                              </span>
                            </div>
                          </Tooltip>
                          <div className="px-3 py-2.5 font-g-mono text-g-caption text-g-ink-2">
                            {row.projectName}
                          </div>
                          <div className="px-3 py-2.5">
                            <Badge tone="line">
                              {row.ext || t("common.none")}
                            </Badge>
                          </div>
                          <div className="px-3 py-2.5 font-g-mono text-g-caption">
                            <span className="text-g-ink-4">
                              {bytesLabel(row.beforeBytes)}
                            </span>
                            <span className="text-g-ink-3"> → </span>
                            <span className="font-[510] text-g-ink">
                              {bytesLabel(row.afterBytes)}
                            </span>
                          </div>
                          <div className="px-3 py-2.5 font-g-mono text-g-caption">
                            <span className="text-g-ink-4">
                              {countLabel(row.beforeUsedCount)}
                            </span>
                            <span className="text-g-ink-3"> → </span>
                            <span className="font-[510] text-g-ink">
                              {countLabel(row.afterUsedCount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

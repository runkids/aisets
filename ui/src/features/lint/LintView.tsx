import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  FileCode,
  FileWarning,
  Info,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/cn";
import { useCatalogLintInfiniteQuery } from "@/queries";
import { useDebouncedValue } from "@/useDebouncedValue";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import type { LintFinding } from "@/types";
import {
  Badge,
  EmptyState,
  IconButton,
  Rail,
  RailItem,
  RailSection,
  StackedBar,
  StatCard,
  Tabs,
  TextInput,
  TextInputClearButton,
  Tooltip,
  type StackedBarSegment,
} from "@/components/ui";

type Props = {
  scanId?: number;
  projectFilterId?: string;
  projectFilterName?: string;
  stats?: {
    totalFiles: number;
    usageNotApplicableFiles?: number;
    lintFindings: number;
  };
  enabled?: boolean;
  onOpenAsset?: (id: string) => void;
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <XCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
};
const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-g-red",
  warning: "text-g-amber",
  info: "text-g-blue",
};
const SEVERITY_TONE: Record<string, "red" | "amber" | "blue"> = {
  critical: "red",
  warning: "amber",
  info: "blue",
};
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

type GroupTab = "file" | "rule";
type RailFilter = { project: string; rule: string };

function extractLintArgs(f: LintFinding): Record<string, string> | undefined {
  switch (f.ruleId) {
    case "duplicate-asset": {
      const m = f.message.match(/^Identical copy exists at (.+)$/);
      return m ? { path: m[1] } : undefined;
    }
    case "large-inline-import":
    case "no-responsive-image":
    case "bg-content-image": {
      const m = f.message.match(/(\d+)KB/);
      return m ? { kb: m[1] } : undefined;
    }
    default:
      return undefined;
  }
}

type VirtualRow =
  | { kind: "file-header"; file: string; count: number; assetId?: string }
  | { kind: "rule-header"; ruleId: string; severity: string; count: number }
  | { kind: "finding"; finding: LintFinding; indented: boolean };

export function LintView({
  scanId,
  projectFilterId,
  projectFilterName = "",
  stats,
  enabled = true,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const [severityFilter, setSeverityFilter] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>({
    project: "",
    rule: "",
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [groupTab, setGroupTab] = useState<GroupTab>("file");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const lintQuery = useCatalogLintInfiniteQuery(
    scanId,
    {
      projectId: projectFilterId || undefined,
      projectName: projectFilterId
        ? undefined
        : projectFilterName || railFilter.project || undefined,
      severity: severityFilter || undefined,
      ruleId: railFilter.rule || undefined,
      q: debouncedSearch || undefined,
      limit: 200,
    },
    enabled,
  );

  const firstPage = lintQuery.data?.pages[0];
  const findings = useMemo(
    () => lintQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [lintQuery.data],
  );

  useInfiniteScrollSentinel({
    rootRef: scrollRef,
    sentinelRef,
    enabled: !!(lintQuery.hasNextPage && !lintQuery.isFetchingNextPage),
    onLoadMore: lintQuery.fetchNextPage,
  });

  const sevFacets = useMemo(
    () => firstPage?.facets.severities ?? [],
    [firstPage?.facets.severities],
  );
  const ruleFacets = firstPage?.facets.rules ?? [];
  const projectFacets = firstPage?.facets.projects ?? [];
  const projectTotal = firstPage?.facets.projectTotal ?? 0;

  const facetSevMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of sevFacets) m[f.id] = f.count;
    return m;
  }, [sevFacets]);

  const totalFromFacets = useMemo(
    () => sevFacets.reduce((a, f) => a + f.count, 0),
    [sevFacets],
  );

  const segments: StackedBarSegment[] = useMemo(
    () =>
      (["critical", "warning", "info"] as const)
        .map((sev) => ({
          value: facetSevMap[sev] ?? 0,
          tone: SEVERITY_TONE[sev],
          label: t(`severity.${sev}`),
        }))
        .filter((s) => s.value > 0),
    [facetSevMap, t],
  );

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  const groups = useMemo(() => {
    if (groupTab === "file") {
      const map = new Map<string, LintFinding[]>();
      for (const f of findings) {
        const arr = map.get(f.file) ?? [];
        arr.push(f);
        map.set(f.file, arr);
      }
      return {
        kind: "file" as const,
        items: Array.from(map.entries())
          .map(([file, fds]) => ({
            key: file,
            file,
            severity: "",
            findings: fds.sort(
              (a, b) =>
                (SEVERITY_ORDER[a.severity] ?? 9) -
                  (SEVERITY_ORDER[b.severity] ?? 9) || a.line - b.line,
            ),
          }))
          .sort((a, b) => {
            const aSev = Math.min(
              ...a.findings.map((f) => SEVERITY_ORDER[f.severity] ?? 9),
            );
            const bSev = Math.min(
              ...b.findings.map((f) => SEVERITY_ORDER[f.severity] ?? 9),
            );
            return (
              aSev - bSev ||
              b.findings.length - a.findings.length ||
              a.file.localeCompare(b.file)
            );
          }),
      };
    }
    const map = new Map<string, LintFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.ruleId) ?? [];
      arr.push(f);
      map.set(f.ruleId, arr);
    }
    return {
      kind: "rule" as const,
      items: Array.from(map.entries())
        .map(([ruleId, fds]) => {
          const worstSev = Math.min(
            ...fds.map((f) => SEVERITY_ORDER[f.severity] ?? 9),
          );
          const sevKey =
            Object.entries(SEVERITY_ORDER).find(
              ([, v]) => v === worstSev,
            )?.[0] ?? "info";
          return {
            key: ruleId,
            file: "",
            severity: sevKey,
            findings: fds.sort(
              (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
            ),
          };
        })
        .sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 9) -
              (SEVERITY_ORDER[b.severity] ?? 9) ||
            b.findings.length - a.findings.length,
        ),
    };
  }, [findings, groupTab]);

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(groups.items.map((g) => g.key)));
  }, [groups]);

  const allCollapsed =
    groups.items.length > 0 && groups.items.every((g) => collapsed.has(g.key));

  const virtualRows = useMemo((): VirtualRow[] => {
    const rows: VirtualRow[] = [];
    for (const g of groups.items) {
      if (groups.kind === "file") {
        rows.push({
          kind: "file-header",
          file: g.key,
          count: g.findings.length,
          assetId: g.findings[0]?.assetId,
        });
      } else {
        rows.push({
          kind: "rule-header",
          ruleId: g.key,
          severity: g.severity,
          count: g.findings.length,
        });
      }
      if (!collapsed.has(g.key)) {
        for (const f of g.findings)
          rows.push({ kind: "finding", finding: f, indented: true });
      }
    }
    return rows;
  }, [groups, collapsed]);

  const rowKey = virtualRows.length + "-" + collapsed.size;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = virtualRows[index];
      if (!row || row.kind !== "finding") return 36;
      return row.finding.snippet ? 96 : 68;
    },
    gap: 6,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowKey, virtualizer]);

  const hasActiveFilter =
    !!severityFilter ||
    !!railFilter.project ||
    !!railFilter.rule ||
    !!debouncedSearch;
  const lintNotApplicable =
    !hasActiveFilter &&
    (stats?.totalFiles ?? 0) > 0 &&
    (stats?.lintFindings ?? 0) === 0 &&
    (stats?.usageNotApplicableFiles ?? 0) === stats?.totalFiles;

  const loading = lintQuery.isLoading && findings.length === 0;
  const empty = !loading && findings.length === 0;
  const projectScopeLocked = Boolean(projectFilterName);
  const railProjects = projectFilterName
    ? projectFacets.filter((p) => p.id === projectFilterName)
    : projectFacets;

  return (
    <>
      {/* ── FilterRail sidebar ── */}
      <Rail className="ml-3 px-0">
        <RailSection heading={t("filter.project")}>
          {!projectScopeLocked && (
            <RailItem
              active={railFilter.project === ""}
              label={t("filter.allProjects")}
              count={projectTotal}
              onClick={() => setRailFilter((f) => ({ ...f, project: "" }))}
            />
          )}
          {railProjects.map((p) => (
            <RailItem
              key={p.id}
              active={railFilter.project === p.id}
              label={p.id}
              count={p.count}
              onClick={() =>
                setRailFilter((f) => ({
                  ...f,
                  project:
                    f.project === p.id && !projectScopeLocked ? "" : p.id,
                }))
              }
            />
          ))}
        </RailSection>

        <RailSection heading={t("lint.ruleFilter")}>
          <RailItem
            active={railFilter.rule === ""}
            label={t("lint.allRules")}
            count={totalFromFacets}
            onClick={() => setRailFilter((f) => ({ ...f, rule: "" }))}
          />
          {ruleFacets.map((rf) => (
            <RailItem
              key={rf.id}
              active={railFilter.rule === rf.id}
              label={t(`lint.rule.${rf.id}.name`, { defaultValue: rf.id })}
              count={rf.count}
              onClick={() =>
                setRailFilter((f) => ({
                  ...f,
                  rule: f.rule === rf.id ? "" : rf.id,
                }))
              }
            />
          ))}
        </RailSection>
      </Rail>

      {/* ── Main content ── */}
      <div
        ref={scrollRef}
        className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0"
      >
        <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
          {/* ── Stats dashboard ── */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label={t("lint.statTotal")}
              value={totalFromFacets || firstPage?.total || 0}
              icon={<FileWarning size={14} />}
            />
            <StatCard
              label={t("severity.critical")}
              value={facetSevMap["critical"] ?? 0}
              icon={<XCircle size={14} />}
              tone={(facetSevMap["critical"] ?? 0) > 0 ? "red" : "neutral"}
            />
            <StatCard
              label={t("severity.warning")}
              value={facetSevMap["warning"] ?? 0}
              icon={<AlertTriangle size={14} />}
              tone={(facetSevMap["warning"] ?? 0) > 0 ? "amber" : "neutral"}
            />
            <StatCard
              label={t("severity.info")}
              value={facetSevMap["info"] ?? 0}
              icon={<Info size={14} />}
            />
          </div>

          {totalFromFacets > 0 && (
            <StackedBar
              segments={segments}
              className="mb-4"
              ariaLabel={t("lint.healthBar")}
            />
          )}

          {/* ── Sticky toolbar ── */}
          <div className="sticky top-0 z-[4] grid gap-2.5 mb-1 pb-1 bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)]">
            <div className="flex flex-wrap items-center gap-2.5">
              <Tabs
                value={groupTab}
                ariaLabel={t("lint.groupBy")}
                onChange={setGroupTab}
                items={[
                  {
                    value: "file" as GroupTab,
                    label: t("lint.byFile"),
                    icon: <FileCode size={13} />,
                  },
                  {
                    value: "rule" as GroupTab,
                    label: t("lint.byRule"),
                    icon: <ShieldAlert size={13} />,
                  },
                ]}
              />

              <Tabs
                value={severityFilter}
                ariaLabel={t("lint.severityFilter")}
                onChange={(v) =>
                  setSeverityFilter(v === severityFilter ? "" : v)
                }
                items={[
                  {
                    value: "",
                    label: t("status.all"),
                  },
                  {
                    value: "critical",
                    label: t("severity.critical"),
                    icon: <XCircle size={13} className="text-g-red" />,
                    badge: (
                      <span className="font-[400] text-g-ink-4">
                        {facetSevMap["critical"] ?? 0}
                      </span>
                    ),
                  },
                  {
                    value: "warning",
                    label: t("severity.warning"),
                    icon: <AlertTriangle size={13} className="text-g-amber" />,
                    badge: (
                      <span className="font-[400] text-g-ink-4">
                        {facetSevMap["warning"] ?? 0}
                      </span>
                    ),
                  },
                  {
                    value: "info",
                    label: t("severity.info"),
                    icon: <Info size={13} className="text-g-blue" />,
                    badge: (
                      <span className="font-[400] text-g-ink-4">
                        {facetSevMap["info"] ?? 0}
                      </span>
                    ),
                  },
                ]}
              />

              <TextInput
                variant="search"
                placeholder={t("lint.searchPlaceholder")}
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

              <Tooltip
                label={
                  allCollapsed ? t("lint.expandAll") : t("lint.collapseAll")
                }
              >
                <IconButton
                  aria-label={
                    allCollapsed ? t("lint.expandAll") : t("lint.collapseAll")
                  }
                  onClick={allCollapsed ? expandAll : collapseAll}
                >
                  {allCollapsed ? (
                    <ChevronsUpDown size={14} />
                  ) : (
                    <ChevronsDownUp size={14} />
                  )}
                </IconButton>
              </Tooltip>
            </div>
          </div>

          {/* ── Content ── */}
          {loading ? (
            <EmptyState title={t("common.loading")} />
          ) : empty ? (
            <EmptyState
              icon={
                lintNotApplicable ? (
                  <Info size={22} />
                ) : !severityFilter && !railFilter.rule && !debouncedSearch ? (
                  <CheckCircle2 size={22} className="text-g-green" />
                ) : undefined
              }
              title={
                lintNotApplicable
                  ? t("lint.notApplicable")
                  : !severityFilter && !railFilter.rule && !debouncedSearch
                    ? t("lint.allClear")
                    : t("lint.empty")
              }
              description={
                lintNotApplicable
                  ? t("lint.notApplicableDesc")
                  : !severityFilter && !railFilter.rule && !debouncedSearch
                    ? t("lint.allClearDesc")
                    : t("lint.emptyDesc")
              }
              tone="neutral"
            />
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const row = virtualRows[vItem.index];
                if (!row) return null;

                if (row.kind === "file-header") {
                  const isCollapsed = collapsed.has(row.file);
                  const headerAssetId = row.assetId;
                  return (
                    <div
                      key={`fh-${row.file}`}
                      className="absolute left-0 right-0 top-0"
                      style={{ transform: `translateY(${vItem.start}px)` }}
                    >
                      <div className="flex w-full items-center gap-0 rounded-g-md px-0 py-0 text-g-ui font-medium text-g-ink">
                        <button
                          type="button"
                          aria-label={
                            isCollapsed
                              ? t("common.expand")
                              : t("common.collapse")
                          }
                          className="inline-flex shrink-0 items-center justify-center size-8 rounded-g-md text-g-ink-4 hover:bg-g-surface-2 transition-colors duration-[120ms] ease-g cursor-pointer"
                          onClick={() => toggleCollapse(row.file)}
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? (
                            <ChevronRight size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 rounded-g-md px-2 py-2 text-left hover:bg-g-surface-2 transition-colors duration-[120ms] ease-g",
                            headerAssetId ? "cursor-pointer" : "cursor-default",
                          )}
                          onClick={() =>
                            headerAssetId
                              ? onOpenAsset?.(headerAssetId)
                              : toggleCollapse(row.file)
                          }
                        >
                          <FileCode
                            size={14}
                            className="shrink-0 text-g-ink-4"
                          />
                          <span className="min-w-0 truncate font-g-mono text-g-caption">
                            {row.file}
                          </span>
                          <Badge
                            tone="line"
                            className="ml-auto shrink-0 text-[10px]"
                          >
                            {row.count}
                          </Badge>
                        </button>
                      </div>
                    </div>
                  );
                }

                if (row.kind === "rule-header") {
                  const isCollapsed = collapsed.has(row.ruleId);
                  return (
                    <div
                      key={`rh-${row.ruleId}`}
                      className="absolute left-0 right-0 top-0"
                      style={{ transform: `translateY(${vItem.start}px)` }}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-g-md px-2 py-2 text-left text-g-ui font-medium text-g-ink hover:bg-g-surface-2 transition-colors duration-[120ms] ease-g cursor-pointer"
                        onClick={() => toggleCollapse(row.ruleId)}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? (
                          <ChevronRight
                            size={14}
                            className="shrink-0 text-g-ink-4"
                          />
                        ) : (
                          <ChevronDown
                            size={14}
                            className="shrink-0 text-g-ink-4"
                          />
                        )}
                        <span
                          className={cn(
                            "shrink-0",
                            SEVERITY_COLOR[row.severity],
                          )}
                        >
                          {SEVERITY_ICON[row.severity]}
                        </span>
                        <span className="text-g-caption">
                          {t(`lint.rule.${row.ruleId}.name`, {
                            defaultValue: row.ruleId,
                          })}
                        </span>
                        <Badge
                          tone="line"
                          className="ml-auto shrink-0 text-[10px]"
                        >
                          {t("lint.fileCount", { count: row.count })}
                        </Badge>
                      </button>
                    </div>
                  );
                }

                const { finding, indented } = row;
                const hasAsset = !!finding.assetId;
                return (
                  <div
                    key={`f-${finding.ruleId}-${finding.file}-${finding.line}-${vItem.index}`}
                    ref={virtualizer.measureElement}
                    data-index={vItem.index}
                    className="absolute left-0 right-0 top-0"
                    style={{ transform: `translateY(${vItem.start}px)` }}
                  >
                    <div
                      className={cn(
                        "flex items-start gap-2.5 rounded-g-md border border-g-line bg-g-surface px-3 py-2.5 transition-[border-color,box-shadow] duration-[120ms] ease-g hover:border-g-line-strong",
                        indented && "ml-7",
                        hasAsset && "cursor-pointer hover:shadow-g-md",
                      )}
                      data-clickable={hasAsset || undefined}
                      onClick={() =>
                        hasAsset && onOpenAsset?.(finding.assetId!)
                      }
                      role={hasAsset ? "button" : undefined}
                      tabIndex={hasAsset ? 0 : undefined}
                      onKeyDown={
                        hasAsset
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onOpenAsset?.(finding.assetId!);
                              }
                            }
                          : undefined
                      }
                    >
                      <span
                        className={cn(
                          "mt-0.5 shrink-0",
                          SEVERITY_COLOR[finding.severity],
                        )}
                      >
                        {SEVERITY_ICON[finding.severity]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          {groupTab === "rule" && (
                            <span className="font-g-mono text-g-caption text-g-ink">
                              {finding.file}:{finding.line}
                            </span>
                          )}
                          {groupTab === "file" && (
                            <>
                              <Badge tone="line" className="text-[10px]">
                                {t(`lint.rule.${finding.ruleId}.name`, {
                                  defaultValue: finding.ruleId,
                                })}
                              </Badge>
                              <span className="font-g-mono text-g-chip text-g-ink-3">
                                L:{finding.line}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 line-clamp-2 text-g-ui text-g-ink-2">
                          {t(`lint.rule.${finding.ruleId}.message`, {
                            defaultValue: finding.message,
                            ...extractLintArgs(finding),
                          })}
                        </div>
                        {finding.suggestion && (
                          <div className="mt-1 truncate text-g-caption text-g-ink-4">
                            {t(`lint.rule.${finding.ruleId}.suggestion`, {
                              defaultValue: finding.suggestion,
                            })}
                          </div>
                        )}
                        {finding.snippet && (
                          <div className="mt-1.5 rounded-g-sm bg-g-canvas px-2 py-1 font-g-mono text-g-chip text-g-ink-3 line-clamp-1">
                            <Code2
                              size={10}
                              className="mr-1 inline-block opacity-50"
                            />
                            {finding.snippet}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div ref={sentinelRef} className="h-1" />
          {lintQuery.isFetchingNextPage && (
            <div className="py-4 text-center text-g-caption text-g-ink-4">
              {t("common.loading")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

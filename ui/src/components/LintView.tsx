import { AlertTriangle, Info, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCatalogLintInfiniteQuery } from "../queries";
import { Badge, EmptyState } from "./ui";

type Props = {
  scanId?: number;
  projectFilterId?: string;
  stats?: {
    totalFiles: number;
    usageNotApplicableFiles?: number;
    lintFindings: number;
  };
  enabled?: boolean;
  onOpenAsset?: (id: string) => void;
};

const SEVERITY_ICON = {
  critical: <XCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
};
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

const FINDING_HEIGHT = 110;

export function LintView({
  scanId,
  projectFilterId,
  stats,
  enabled = true,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const [severityFilter, setSeverityFilter] = useState("");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lintQuery = useCatalogLintInfiniteQuery(
    scanId,
    {
      projectId: projectFilterId || undefined,
      limit: 200,
    },
    enabled,
  );
  const findings = useMemo(
    () => lintQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [lintQuery.data],
  );
  const {
    fetchNextPage: fetchNextLintPage,
    hasNextPage: hasMoreLint,
    isFetchingNextPage: isFetchingMoreLint,
  } = lintQuery;

  useEffect(() => {
    if (!hasMoreLint || isFetchingMoreLint) return;
    void fetchNextLintPage();
  }, [fetchNextLintPage, hasMoreLint, isFetchingMoreLint]);

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0 };
    for (const f of findings) c[f.severity as keyof typeof c]++;
    return c;
  }, [findings]);

  const filtered = useMemo(() => {
    let items = findings;
    if (severityFilter)
      items = items.filter((f) => f.severity === severityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (f) =>
          f.file.toLowerCase().includes(q) ||
          f.ruleId.toLowerCase().includes(q) ||
          f.message.toLowerCase().includes(q),
      );
    }
    return [...items].sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] -
        SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER],
    );
  }, [findings, severityFilter, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FINDING_HEIGHT,
    overscan: 5,
  });
  const lintNotApplicable =
    (stats?.totalFiles ?? 0) > 0 &&
    (stats?.lintFindings ?? 0) === 0 &&
    (stats?.usageNotApplicableFiles ?? 0) === stats?.totalFiles;

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex max-w-[280px] items-center gap-2 rounded-g-md border border-g-input-border bg-g-surface px-3 py-[7px] transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:border-g-input-hover hover:bg-g-input-hover-bg focus-within:border-g-input-focus focus-within:bg-g-surface focus-within:shadow-g-input-focus">
          <input
            className="flex-1 border-0 bg-transparent text-[13px] text-g-ink outline-0 placeholder:text-g-ink-4"
            placeholder={t("lint.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {(["", "critical", "warning", "info"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`inline-flex h-7 items-center gap-1 rounded-g-md border px-2.5 text-[12px] font-medium transition-all duration-[120ms] ease-g ${severityFilter === s ? "border-g-ink bg-g-ink text-g-canvas" : "border-g-line bg-g-surface text-g-ink-3 hover:border-g-line-strong hover:text-g-ink"}`}
            onClick={() => setSeverityFilter(severityFilter === s ? "" : s)}
          >
            {t("filter.countLabel", {
              label: s ? t(`severity.${s}`) : t("status.all"),
              count: s ? counts[s as keyof typeof counts] : findings.length,
            })}
          </button>
        ))}
      </div>

      {lintQuery.isLoading && filtered.length === 0 ? (
        <EmptyState title={t("common.loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={lintNotApplicable ? <Info size={22} /> : undefined}
          title={lintNotApplicable ? t("lint.notApplicable") : t("lint.empty")}
          description={
            lintNotApplicable
              ? t("lint.notApplicableDesc")
              : t("lint.emptyDesc")
          }
          tone="neutral"
        />
      ) : (
        <div
          ref={scrollRef}
          className="scroll-thin min-h-0 flex-1 overflow-auto"
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const finding = filtered[row.index];
              const iconClassName =
                finding.severity === "critical"
                  ? "text-g-red"
                  : finding.severity === "warning"
                    ? "text-g-amber"
                    : "text-g-blue";
              return (
                <div
                  key={`${finding.ruleId}-${finding.file}-${finding.line}-${row.index}`}
                  className="absolute left-0 right-0 top-0 flex items-start gap-2.5 rounded-g-md border border-g-line bg-g-surface px-4 py-3 transition-[border-color,box-shadow] duration-[120ms] ease-g hover:border-g-line-strong hover:shadow-g-md data-[clickable=true]:cursor-pointer"
                  data-clickable={!!finding.assetId || undefined}
                  style={{
                    transform: `translateY(${row.start}px)`,
                    height: FINDING_HEIGHT - 6,
                  }}
                  onClick={() =>
                    finding.assetId && onOpenAsset?.(finding.assetId)
                  }
                >
                  <span className={`mt-0.5 shrink-0 ${iconClassName}`}>
                    {SEVERITY_ICON[finding.severity]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-g-mono text-g-caption text-g-ink">
                        {finding.file}:{finding.line}
                      </span>
                      <Badge tone="line" className="text-[10px]">
                        {finding.ruleId}
                      </Badge>
                    </div>
                    <div className="mt-1 line-clamp-2 text-g-ui text-g-ink-2">
                      {finding.message}
                    </div>
                    <div className="mt-1 truncate text-g-caption text-g-ink-4">
                      {finding.suggestion}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

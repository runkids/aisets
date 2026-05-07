import {
  CheckSquare,
  Copy,
  Download,
  Search,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { fileName, formatBytes, primarySeverity } from "../ui";
import {
  AssetThumbnail,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Modal,
  Notice,
} from "./ui";

type Props = {
  items: AssetItem[];
  totalCount: number;
  onOpenAsset?: (id: string) => void;
};

type Category = "" | "size" | "format" | "svg" | "dimensions" | "animation";
type Severity = "" | "critical" | "warning" | "info";

function categoryOfItem(item: AssetItem): Set<string> {
  const cats = new Set<string>();
  for (const r of item.optimizationRecommendations) cats.add(r.category);
  return cats;
}

export function OptimizeView({ items, totalCount, onOpenAsset }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [severity, setSeverity] = useState<Severity>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scriptOpen, setScriptOpen] = useState<{ script: string } | null>(null);
  const [scriptWorking, setScriptWorking] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const sev = { critical: 0, warning: 0, info: 0 };
    const cat = { size: 0, format: 0, svg: 0, dimensions: 0, animation: 0 };
    for (const item of items) {
      const s = primarySeverity(item);
      if (s) sev[s as keyof typeof sev]++;
      for (const c of categoryOfItem(item)) {
        if (c in cat) cat[c as keyof typeof cat]++;
      }
    }
    return { sev, cat };
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (severity) list = list.filter((i) => primarySeverity(i) === severity);
    if (category) list = list.filter((i) => categoryOfItem(i).has(category));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          fileName(i.repoPath).toLowerCase().includes(q) ||
          i.repoPath.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, severity, category, search]);

  const selectionInfo = useMemo(() => {
    const list = items.filter((i) => selected.has(i.id));
    const totalBytes = list.reduce((s, i) => s + i.bytes, 0);
    const savings = list.reduce(
      (s, i) =>
        s +
        i.optimizationRecommendations.reduce(
          (a, r) => a + ((r as { savingsBytes?: number }).savingsBytes ?? 0),
          0,
        ),
      0,
    );
    return { count: list.length, totalBytes, savings };
  }, [items, selected]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const i of filtered) next.delete(i.id);
        return next;
      }
      const next = new Set(prev);
      for (const i of filtered) next.add(i.id);
      return next;
    });
  }

  async function generateScript() {
    setScriptWorking(true);
    setScriptError(null);
    try {
      const ids = selected.size > 0 ? [...selected] : filtered.map((i) => i.id);
      const res = await fetch("/api/actions/optimization/generate-script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error?.message ||
            t("error.requestFailed", { status: res.status }),
        );
      }
      const body = await res.json();
      setScriptOpen({ script: body.script ?? "" });
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : String(err));
    } finally {
      setScriptWorking(false);
    }
  }

  function copyScript() {
    if (scriptOpen) navigator.clipboard?.writeText(scriptOpen.script);
  }
  function downloadScript() {
    if (!scriptOpen) return;
    const blob = new Blob([scriptOpen.script], { type: "text/x-shellscript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset-studio-optimize.sh";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="m-0 font-g-display text-[44px] font-bold leading-[1.05] tracking-[-0.035em] text-g-ink max-[768px]:text-[30px]">
            {t("optimize.title")}{" "}
            <em className="ml-2.5 align-[0.6em] font-g text-[0.32em] font-medium not-italic uppercase tracking-[0.06em] text-g-ink-3">
              {t("asset.assets", { count: totalCount })}
            </em>
          </h1>
          <p className="mt-2.5 max-w-[540px] text-g-body text-g-ink-3">
            {t("optimize.description")}
          </p>
        </div>
      </div>

      <div className="sticky top-0 z-[4] mb-1 flex items-center gap-2 bg-[color-mix(in_srgb,var(--g-canvas)_94%,transparent)] py-3 backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)]">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <div className="flex max-w-[360px] items-center gap-2 rounded-g-md border border-g-input-border bg-g-surface px-3 py-[7px] transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:border-g-input-hover hover:bg-g-input-hover-bg focus-within:border-g-input-focus focus-within:bg-g-surface focus-within:shadow-g-input-focus">
            <Search size={14} className="size-3.5 shrink-0 text-g-ink-4" />
            <input
              className="flex-1 border-0 bg-transparent text-[13px] text-g-ink outline-0 placeholder:text-g-ink-4"
              placeholder={t("optimize.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="grid size-5 place-items-center rounded-full text-g-ink-4 hover:bg-g-surface-2 hover:text-g-ink"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-color:var(--g-line-strong)_transparent]">
            {(
              [
                [
                  "",
                  t("filter.countLabel", {
                    label: t("status.all"),
                    count: totalCount,
                  }),
                ],
                [
                  "size",
                  t("filter.countLabel", {
                    label: t("optimize.category.size"),
                    count: counts.cat.size,
                  }),
                ],
                [
                  "format",
                  t("filter.countLabel", {
                    label: t("optimize.category.format"),
                    count: counts.cat.format,
                  }),
                ],
                [
                  "svg",
                  t("filter.countLabel", {
                    label: t("optimize.category.svg"),
                    count: counts.cat.svg,
                  }),
                ],
                [
                  "dimensions",
                  t("filter.countLabel", {
                    label: t("optimize.category.dimensions"),
                    count: counts.cat.dimensions,
                  }),
                ],
                [
                  "animation",
                  t("filter.countLabel", {
                    label: t("optimize.category.animation"),
                    count: counts.cat.animation,
                  }),
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key || "all"}
                type="button"
                className={`inline-flex h-7 items-center gap-1 rounded-g-md border px-2.5 text-xs font-medium transition-all duration-[120ms] ease-g ${category === key ? "border-g-ink bg-g-ink text-g-canvas" : "border-g-line bg-g-surface text-g-ink-3 hover:border-g-line-strong hover:text-g-ink"}`}
                onClick={() =>
                  setCategory(category === key ? "" : (key as Category))
                }
              >
                {label}
              </button>
            ))}
            <span className="h-5 w-px shrink-0 bg-g-line-strong" />
            {(
              [
                [
                  "critical",
                  t("filter.countLabel", {
                    label: t("severity.critical"),
                    count: counts.sev.critical,
                  }),
                ],
                [
                  "warning",
                  t("filter.countLabel", {
                    label: t("severity.warning"),
                    count: counts.sev.warning,
                  }),
                ],
                [
                  "info",
                  t("filter.countLabel", {
                    label: t("severity.info"),
                    count: counts.sev.info,
                  }),
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`inline-flex h-7 items-center gap-1 rounded-g-md border px-2.5 text-xs font-medium transition-all duration-[120ms] ease-g ${severity === key ? "border-g-ink bg-g-ink text-g-canvas" : "border-g-line bg-g-surface text-g-ink-3 hover:border-g-line-strong hover:text-g-ink"}`}
                onClick={() =>
                  setSeverity(severity === key ? "" : (key as Severity))
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-[5] mb-4 flex min-h-[44px] animate-[slideUp2_200ms_var(--g-ease-out)] flex-wrap items-center gap-2 rounded-g-md border border-g-line-strong bg-g-surface-3 px-3 py-2 text-[13px] text-g-ink shadow-g-md">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={
            allFilteredSelected ? (
              <CheckSquare size={14} />
            ) : (
              <Square size={14} />
            )
          }
          onClick={toggleAllVisible}
        >
          {allFilteredSelected
            ? t("action.deselectVisible")
            : t("action.selectVisible")}
        </Button>
        {selected.size > 0 && (
          <span className="font-g-mono text-g-caption text-g-ink-3">
            {t("selection.summary", {
              count: selectionInfo.count,
              size: formatBytes(selectionInfo.totalBytes),
            })}
            {selectionInfo.savings > 0 &&
              t("selection.savingsSuffix", {
                size: formatBytes(selectionInfo.savings),
              })}
          </span>
        )}
        <span className="ml-auto" />
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Terminal size={14} />}
          onClick={generateScript}
          disabled={
            scriptWorking || (filtered.length === 0 && selected.size === 0)
          }
        >
          {scriptWorking
            ? t("action.generating")
            : t(
                selected.size > 0
                  ? "optimize.generateScriptSelected"
                  : "optimize.generateScriptVisible",
                { count: selected.size > 0 ? selected.size : filtered.length },
              )}
        </Button>
      </div>
      {scriptError && (
        <Notice
          tone="danger"
          className="mb-3"
          title={t("optimize.scriptGenerationFailed")}
        >
          {scriptError}
        </Notice>
      )}

      <div>
        {filtered.map((item) => {
          const sev = primarySeverity(item);
          const rec = item.optimizationRecommendations[0];
          const isSelected = selected.has(item.id);
          return (
            <div
              key={item.id}
              className="relative mb-2.5 grid cursor-pointer items-center gap-4 rounded-g-lg border border-g-line bg-g-surface px-[18px] py-3.5 transition-all duration-[120ms] ease-g hover:translate-x-0.5 hover:border-g-line-strong grid-cols-[28px_64px_1fr_220px_140px] max-[768px]:grid-cols-[28px_48px_1fr] max-[768px]:gap-2.5 max-[768px]:[&>:nth-child(4)]:col-start-3 max-[768px]:[&>:nth-child(5)]:col-start-3"
              onClick={() => onOpenAsset?.(item.id)}
            >
              <div
                className="flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <IconButton
                  size="sm"
                  active={isSelected}
                  onClick={() => toggleOne(item.id)}
                  aria-label={
                    isSelected ? t("action.deselect") : t("action.select")
                  }
                >
                  {isSelected ? (
                    <CheckSquare size={16} />
                  ) : (
                    <Square size={16} />
                  )}
                </IconButton>
              </div>
              <AssetThumbnail
                src={item.thumbnailUrl || item.url}
                size="lg"
                className="size-16 rounded-g-md"
              />
              <div className="min-w-0 text-left">
                <div className="truncate font-g-mono text-[13px] font-medium">
                  {fileName(item.repoPath)}
                </div>
                <div className="mt-0.5 truncate font-g-mono text-g-chip text-g-ink-4">
                  {item.repoPath}
                </div>
                {rec && (
                  <div className="mt-1.5 text-xs text-g-ink-2">
                    {rec.suggestion}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {sev && (
                  <Badge
                    tone={
                      sev === "critical"
                        ? "red"
                        : sev === "warning"
                          ? "amber"
                          : "blue"
                    }
                  >
                    {t(`severity.${sev}`)}
                  </Badge>
                )}
                {item.optimizationRecommendations.map((r, i) => (
                  <Badge key={i} tone="line" className="text-[10px]">
                    {t(`optimize.category.${r.category}`, {
                      defaultValue: r.category,
                    })}
                  </Badge>
                ))}
              </div>
              <div className="text-right">
                <div className="font-g-mono text-g-ui font-[510] text-g-ink">
                  {formatBytes(item.bytes)}
                </div>
                <div className="text-g-chip text-g-ink-4">
                  {item.ext.replace(".", "").toUpperCase()}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState
            title={t("common.noResults")}
            description={t("optimize.noRecommendations")}
          />
        )}
      </div>

      {scriptOpen && (
        <Modal
          title={t("optimize.scriptTitle")}
          onClose={() => setScriptOpen(null)}
          bodyPadding="none"
          footer={
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Copy size={14} />}
                onClick={copyScript}
              >
                {t("action.copy")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Download size={14} />}
                onClick={downloadScript}
              >
                {t("action.downloadShell")}
              </Button>
            </div>
          }
        >
          <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre bg-g-surface-2 p-4 font-g-mono text-g-caption">
            {scriptOpen.script}
          </pre>
        </Modal>
      )}
    </div>
  );
}

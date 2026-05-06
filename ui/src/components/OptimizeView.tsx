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
import { Badge, Button, EmptyState, IconButton, Modal, Notice } from "./ui";

type Props = {
  items: AssetItem[];
  onOpenAsset?: (id: string) => void;
};

type Category = "" | "size" | "format" | "svg" | "dimensions" | "animation";
type Severity = "" | "critical" | "warning" | "info";

function categoryOfItem(item: AssetItem): Set<string> {
  const cats = new Set<string>();
  for (const r of item.optimizationRecommendations) cats.add(r.category);
  return cats;
}

export function OptimizeView({ items, onOpenAsset }: Props) {
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
    <div className="page pt-6">
      <div className="page-h">
        <div>
          <h1 className="page-h-title">
            {t("optimize.title")}{" "}
            <em>{t("asset.assets", { count: items.length })}</em>
          </h1>
          <p className="page-h-sub">{t("optimize.description")}</p>
        </div>
      </div>

      <div className="opt-filters-wrap">
        <div className="opt-filters-bar">
          <div className="opt-search">
            <Search size={14} />
            <input
              className="opt-search-input"
              placeholder={t("optimize.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="opt-search-clear"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="opt-filter-row">
            {(
              [
                [
                  "",
                  t("filter.countLabel", {
                    label: t("status.all"),
                    count: items.length,
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
                className={`opt-chip ${category === key ? "opt-chip-active" : ""}`}
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
                className={`opt-chip ${severity === key ? "opt-chip-active" : ""}`}
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

      <div className="bulkbar flex flex-wrap items-center gap-2 py-2.5">
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
              className="opt-row"
              onClick={() => onOpenAsset?.(item.id)}
            >
              <div
                className="opt-row-check"
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
              <div className="opt-row-thumb">
                <img
                  src={item.thumbnailUrl || item.url}
                  alt=""
                  loading="lazy"
                />
              </div>
              <div className="opt-row-text">
                <div className="opt-row-name">{fileName(item.repoPath)}</div>
                <div className="opt-row-path">{item.repoPath}</div>
                {rec && <div className="opt-row-reason">{rec.suggestion}</div>}
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
              <div className="opt-row-savings">
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

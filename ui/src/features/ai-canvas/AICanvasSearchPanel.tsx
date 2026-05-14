import {
  Check,
  LoaderCircle,
  Plus,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import type { TFunction } from "i18next";
import {
  AssetThumbnail,
  TextInput,
  TextInputClearButton,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AssetItem } from "@/types";
import { fileName } from "@/ui";
import { imageMeta } from "./canvasUtils";
import type { StateSetter } from "./aiCanvasTypes";

const SEMANTIC_PHASES = [
  "向量比對中",
  "Embedding lookup",
  "計算餘弦距離",
  "Cosine similarity",
  "標記相似群集",
  "k-NN clustering",
  "語意排序中",
  "Ranking results",
  "解析語意特徵",
  "Parsing features",
  "ベクトル検索中",
  "유사도 계산",
];

type AICanvasSearchPanelProps = {
  t: TFunction;
  open: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: StateSetter<string>;
  searchMode: "catalog" | "semantic";
  setSearchMode: StateSetter<"catalog" | "semantic">;
  semanticAvailable: boolean;
  searchBusy: boolean;
  searchError: string;
  searchResults: AssetItem[];
  searchTotal: number;
  searchActiveIndex: number;
  setSearchActiveIndex: StateSetter<number>;
  searchSelectedIds: Set<string>;
  setSearchSelectedIds: StateSetter<Set<string>>;
  setSearchResults: StateSetter<AssetItem[]>;
  setSearchTotal: StateSetter<number>;
  setOpen: StateSetter<boolean>;
  runSearch: () => void | Promise<void>;
  addAsset: (asset: AssetItem) => void;
};

export function AICanvasSearchPanel({
  t,
  open,
  inputRef,
  query,
  setQuery,
  searchMode,
  setSearchMode,
  semanticAvailable,
  searchBusy,
  searchError,
  searchResults,
  searchTotal,
  searchActiveIndex,
  setSearchActiveIndex,
  searchSelectedIds,
  setSearchSelectedIds,
  setSearchResults,
  setSearchTotal,
  setOpen,
  runSearch,
  addAsset,
}: AICanvasSearchPanelProps) {
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    if (!searchBusy || searchMode !== "semantic") return;
    const id = window.setInterval(() => {
      setPhaseIdx((i) => (i + 1) % SEMANTIC_PHASES.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [searchBusy, searchMode]);

  if (!open) {
    return (
      <button
        data-ai-canvas-overlay="true"
        type="button"
        aria-label={t("aiCanvas.openSearch")}
        className="pointer-events-auto absolute left-[130px] top-3 z-50 inline-flex h-[44px] w-[44px] items-center justify-center rounded-g-lg border border-transparent bg-g-surface/75 shadow-g-pop backdrop-blur-xl animate-[canvasSearchIn_160ms_var(--g-ease-out)_both] transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus motion-reduce:animate-none [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80 [[data-theme='dark']_&]:hover:bg-g-surface-3"
        onClick={() => setOpen(true)}
      >
        <Search size={20} className="text-g-ink-2" />
      </button>
    );
  }

  return (
    <aside
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute left-[130px] top-3 z-50 flex w-[min(480px,calc(100%-142px))] origin-top-left flex-col gap-1 rounded-g-lg border border-transparent bg-g-surface/75 p-1.5 shadow-g-pop backdrop-blur-xl animate-[canvasSearchIn_200ms_var(--g-ease-out)_both] motion-reduce:animate-none [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80"
    >
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch();
        }}
      >
        <TextInput
          ref={inputRef}
          value={query}
          variant="command"
          size="sm"
          icon={
            searchBusy ? (
              <LoaderCircle size={14} className="animate-spin text-g-ink-3" />
            ) : (
              <span className="relative inline-grid size-[14px] place-items-center">
                <Search
                  size={14}
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-[280ms] ease-g-spring",
                    searchMode === "catalog"
                      ? "rotate-0 scale-100 opacity-100"
                      : "rotate-[-20deg] scale-75 opacity-0",
                  )}
                />
                <WandSparkles
                  size={14}
                  className={cn(
                    "absolute inset-0 text-g-purple transition-[opacity,transform] duration-[280ms] ease-g-spring",
                    searchMode === "semantic"
                      ? "rotate-0 scale-100 opacity-100"
                      : "rotate-[20deg] scale-75 opacity-0",
                  )}
                />
              </span>
            )
          }
          placeholder={
            searchMode === "semantic"
              ? t("toolbar.semanticSearch")
              : t("aiCanvas.searchPlaceholder")
          }
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && semanticAvailable) {
              e.preventDefault();
              setSearchMode((m) => (m === "catalog" ? "semantic" : "catalog"));
              return;
            }
            if (e.key === "ArrowDown" && searchResults.length > 0) {
              e.preventDefault();
              setSearchActiveIndex((i) =>
                Math.min(i + 1, searchResults.length - 1),
              );
              return;
            }
            if (e.key === "ArrowUp" && searchResults.length > 0) {
              e.preventDefault();
              setSearchActiveIndex((i) => Math.max(i - 1, -1));
              return;
            }
            if (e.key === "Enter") {
              e.stopPropagation();
              if (searchActiveIndex >= 0 && searchResults[searchActiveIndex]) {
                e.preventDefault();
                setSearchSelectedIds((prev) => {
                  const next = new Set(prev);
                  const id = searchResults[searchActiveIndex].id;
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }
            }
          }}
          suffix={
            <span className="-mr-1 inline-flex h-full items-center gap-1">
              {query && (
                <TextInputClearButton
                  label={t("toolbar.clearSearch")}
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                    setSearchTotal(0);
                    setSearchSelectedIds(new Set());
                    setSearchActiveIndex(-1);
                  }}
                  className="mr-0.5"
                />
              )}
              {semanticAvailable && (
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-5 items-center gap-1 border-l border-g-line px-2 pr-1 font-g text-[12px] font-[650] tracking-g-ui transition-colors duration-[140ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus",
                    searchMode === "semantic"
                      ? "text-g-purple hover:text-g-purple"
                      : "text-g-ink-3 hover:text-g-ink",
                  )}
                  aria-label={t("toolbar.searchMode")}
                  onClick={() =>
                    setSearchMode((m) =>
                      m === "catalog" ? "semantic" : "catalog",
                    )
                  }
                >
                  {searchMode === "semantic" ? (
                    <WandSparkles size={13} aria-hidden="true" />
                  ) : (
                    <Search size={13} aria-hidden="true" />
                  )}
                  <span>
                    {searchMode === "semantic"
                      ? t("toolbar.aiSearchMode")
                      : t("toolbar.catalogSearchMode")}
                  </span>
                  <kbd className="ml-0.5 font-g-mono text-[10px] font-[650] text-g-ink-4 opacity-70">
                    TAB
                  </kbd>
                </button>
              )}
              {searchBusy && searchMode === "semantic" && (
                <span className="relative ml-1.5 mr-0.5 inline-flex h-[18px] items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--g-purple)_10%,transparent)] px-2 animate-[semanticGlow_2s_ease-in-out_infinite]">
                  <span className="absolute inset-0 animate-[semanticScan_1.4s_ease-in-out_infinite]">
                    <span className="block h-full w-[40%] bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--g-purple)_45%,transparent)] to-transparent" />
                  </span>
                  <span
                    key={phaseIdx}
                    className="relative whitespace-nowrap font-g text-[10px] font-[590] tracking-wide text-g-purple animate-[ghostSwap_1.8s_ease-in-out_both]"
                  >
                    {SEMANTIC_PHASES[phaseIdx]}
                  </span>
                </span>
              )}
            </span>
          }
          className="flex-1"
          inputClassName={cn(
            "font-g text-g-ui tracking-g-ui",
            searchMode === "semantic" &&
              (query.trim() ? "caret-g-ink" : "caret-transparent"),
          )}
        />
        <button
          type="button"
          aria-label={t("aiCanvas.closeSearch")}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-g-sm text-g-ink-3 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
          onClick={() => {
            if (searchResults.length > 0) {
              setSearchResults([]);
              setSearchTotal(0);
              setSearchSelectedIds(new Set());
              setQuery("");
            } else {
              setOpen(false);
            }
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </form>

      {searchError && (
        <div className="rounded-g-sm border border-g-red/40 bg-g-red-soft px-2 py-1.5 text-g-caption text-g-red">
          {searchError}
        </div>
      )}

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-g-out motion-reduce:transition-none",
          searchResults.length > 0
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex items-center justify-between px-1.5 pb-0.5 text-g-chip font-[510] tracking-[0.02em] text-g-ink-4">
            <span className="inline-flex items-center gap-2">
              <span>{t("aiCanvas.searchResults", { count: searchTotal })}</span>
              {searchSelectedIds.size < searchResults.length ? (
                <button
                  type="button"
                  className="text-g-accent transition-colors duration-[100ms] ease-g hover:text-g-accent/80 focus-visible:outline-none focus-visible:shadow-g-focus"
                  onClick={() =>
                    setSearchSelectedIds(
                      new Set(searchResults.map((a) => a.id)),
                    )
                  }
                >
                  {t("aiCanvas.selectAll")}
                </button>
              ) : (
                <button
                  type="button"
                  className="text-g-ink-3 transition-colors duration-[100ms] ease-g hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                  onClick={() => setSearchSelectedIds(new Set())}
                >
                  {t("aiCanvas.deselectAll")}
                </button>
              )}
            </span>
            {searchSelectedIds.size > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-g-pill bg-g-accent px-2 py-0.5 font-g text-[11px] font-[590] text-white transition-opacity duration-[100ms] ease-g hover:opacity-85 focus-visible:outline-none focus-visible:shadow-g-focus"
                onClick={() => {
                  searchResults
                    .filter((a) => searchSelectedIds.has(a.id))
                    .forEach(addAsset);
                  setSearchResults([]);
                  setSearchTotal(0);
                  setSearchActiveIndex(-1);
                  setSearchSelectedIds(new Set());
                }}
              >
                <Plus size={11} />
                {t("imageTools.addSelected", {
                  count: searchSelectedIds.size,
                })}
              </button>
            ) : (
              <span>{t("aiCanvas.addHint")}</span>
            )}
          </div>
          <div
            data-ai-canvas-scroll="true"
            className="max-h-[320px] overflow-y-auto"
          >
            {searchResults.map((asset, i) => {
              const selected = searchSelectedIds.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  data-active={searchActiveIndex === i || undefined}
                  className={cn(
                    "group flex w-full items-center gap-2.5 px-1.5 py-1.5 text-left transition-colors duration-[100ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus data-[active]:bg-g-surface-2",
                    selected && "bg-g-accent-soft",
                    i === 0 && "rounded-t-g-sm",
                    i === searchResults.length - 1 && "rounded-b-g-sm",
                    i < searchResults.length - 1 && "border-b border-g-line/50",
                  )}
                  onMouseEnter={() => setSearchActiveIndex(i)}
                  onClick={() => {
                    setSearchSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(asset.id)) next.delete(asset.id);
                      else next.add(asset.id);
                      return next;
                    });
                  }}
                >
                  <AssetThumbnail
                    src={asset.thumbnailUrl || asset.url}
                    size="sm"
                    className="size-8 rounded-g-sm"
                    imageClassName="select-none"
                    draggable={false}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-g-mono text-g-caption font-[510] tracking-g-mono text-g-ink">
                      {fileName(asset.repoPath)}
                    </span>
                    <span className="block truncate text-g-chip text-g-ink-3">
                      {asset.projectName} · {imageMeta(asset)}
                    </span>
                  </span>
                  {selected ? (
                    <Check size={14} className="shrink-0 text-g-accent" />
                  ) : (
                    <Plus
                      size={14}
                      className="shrink-0 text-g-ink-4 opacity-0 transition-opacity duration-[100ms] ease-g group-hover:opacity-100"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

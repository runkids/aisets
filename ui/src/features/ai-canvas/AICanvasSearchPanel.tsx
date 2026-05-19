import {
  Check,
  ChevronLeft,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  SearchX,
  WandSparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  const [batchMode, setBatchMode] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [everSearched, setEverSearched] = useState(false);
  const [prevQuery, setPrevQuery] = useState(query);
  const [prevSearchBusy, setPrevSearchBusy] = useState(searchBusy);
  const [prevResults, setPrevResults] = useState(searchResults);

  const isDraggingRef = useRef(false);
  const pendingDragRef = useRef(false);
  const dragStartIdx = useRef(-1);
  const didDragRef = useRef(false);
  const lastClickIdx = useRef(-1);

  if (query !== prevQuery) {
    setPrevQuery(query);
    setEverSearched(false);
  }
  if (searchBusy !== prevSearchBusy) {
    setPrevSearchBusy(searchBusy);
    if (searchBusy) setEverSearched(true);
  }
  if (searchResults !== prevResults) {
    setPrevResults(searchResults);
    if (addedIds.size > 0) setAddedIds(new Set());
  }

  useEffect(() => {
    if (!searchBusy || searchMode !== "semantic") return;
    const id = window.setInterval(() => {
      setPhaseIdx((i) => (i + 1) % SEMANTIC_PHASES.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [searchBusy, searchMode]);

  useEffect(() => {
    const handleUp = () => {
      pendingDragRef.current = false;
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
      dragStartIdx.current = -1;
    };
    document.addEventListener("pointerup", handleUp);
    return () => document.removeEventListener("pointerup", handleUp);
  }, []);

  const handleClose = useCallback(() => {
    setBatchMode(false);
    setSearchSelectedIds(new Set());
    setOpen(false);
  }, [setSearchSelectedIds, setOpen]);

  const handleItemClick = useCallback(
    (asset: AssetItem, index: number, event: React.MouseEvent) => {
      if (batchMode) {
        if (didDragRef.current) {
          didDragRef.current = false;
          return;
        }
        if (event.shiftKey && lastClickIdx.current >= 0) {
          const start = Math.min(lastClickIdx.current, index);
          const end = Math.max(lastClickIdx.current, index);
          setSearchSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
              next.add(searchResults[i].id);
            }
            return next;
          });
        } else {
          setSearchSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(asset.id)) next.delete(asset.id);
            else next.add(asset.id);
            return next;
          });
        }
        lastClickIdx.current = index;
      } else {
        if (addedIds.has(asset.id)) return;
        addAsset(asset);
        setAddedIds((prev) => new Set(prev).add(asset.id));
      }
      setSearchActiveIndex(index);
    },
    [
      batchMode,
      addedIds,
      searchResults,
      addAsset,
      setSearchSelectedIds,
      setSearchActiveIndex,
    ],
  );

  const handleBatchAdd = useCallback(() => {
    const toAdd = searchResults.filter((a) => searchSelectedIds.has(a.id));
    toAdd.forEach(addAsset);
    setAddedIds((prev) => {
      const next = new Set(prev);
      toAdd.forEach((a) => next.add(a.id));
      return next;
    });
    setSearchSelectedIds(new Set());
  }, [searchResults, searchSelectedIds, addAsset, setSearchSelectedIds]);

  if (!open) {
    return (
      <button
        data-ai-canvas-overlay="true"
        type="button"
        aria-label={t("aiCanvas.openSearch")}
        className="pointer-events-auto absolute left-[130px] top-3 z-50 inline-flex h-[40px] w-[40px] items-center justify-center rounded-g-lg border border-transparent bg-g-surface/75 shadow-g-pop backdrop-blur-xl animate-[canvasSearchIn_160ms_var(--g-ease-out)_both] transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus motion-reduce:animate-none [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80 [[data-theme='dark']_&]:hover:bg-g-surface-3"
        onClick={() => setOpen(true)}
      >
        <Search size={20} className="text-g-ink-2" />
      </button>
    );
  }

  const showEmptyState =
    everSearched &&
    !searchBusy &&
    searchResults.length === 0 &&
    !searchError &&
    query.trim();

  return (
    <aside
      data-ai-canvas-overlay="true"
      className="pointer-events-auto absolute left-[130px] top-3 z-50 flex w-[min(480px,calc(100%-142px))] origin-top-left flex-col rounded-g-lg border border-transparent bg-g-surface/75 p-1.5 shadow-g-pop backdrop-blur-xl animate-[canvasSearchIn_200ms_var(--g-ease-out)_both] motion-reduce:animate-none [[data-theme='dark']_&]:border-g-line [[data-theme='dark']_&]:bg-g-surface-3/80"
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
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setSearchActiveIndex(-1);
            if (!value.trim()) {
              setSearchResults([]);
              setSearchTotal(0);
              setSearchSelectedIds(new Set());
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && semanticAvailable) {
              e.preventDefault();
              setSearchMode((m) => (m === "catalog" ? "semantic" : "catalog"));
              return;
            }
            if (e.key === "ArrowDown" && searchResults.length > 0) {
              e.preventDefault();
              const next = Math.min(
                searchActiveIndex + 1,
                searchResults.length - 1,
              );
              setSearchActiveIndex(next);
              if (batchMode && e.shiftKey && searchResults[next]) {
                setSearchSelectedIds((prev) =>
                  new Set(prev).add(searchResults[next].id),
                );
              }
              return;
            }
            if (e.key === "ArrowUp" && searchResults.length > 0) {
              e.preventDefault();
              const next = Math.max(searchActiveIndex - 1, 0);
              setSearchActiveIndex(next);
              if (batchMode && e.shiftKey && searchResults[next]) {
                setSearchSelectedIds((prev) =>
                  new Set(prev).add(searchResults[next].id),
                );
              }
              return;
            }
            if (e.key === " " && batchMode && searchActiveIndex >= 0) {
              e.preventDefault();
              const asset = searchResults[searchActiveIndex];
              if (asset) {
                setSearchSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(asset.id)) next.delete(asset.id);
                  else next.add(asset.id);
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
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-g-sm text-g-ink-3 transition-[color,background] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
          onClick={handleClose}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      </form>

      {searchError && (
        <div className="mt-1 rounded-g-sm border border-g-red/40 bg-g-red-soft px-2 py-1.5 text-g-caption text-g-red">
          {searchError}
        </div>
      )}

      {showEmptyState && (
        <div className="flex flex-col items-center gap-1.5 py-5">
          <SearchX size={18} className="text-g-ink-4" />
          <span className="text-g-caption text-g-ink-3">
            {t("aiCanvas.noSearchResults")}
          </span>
        </div>
      )}

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-g-out motion-reduce:transition-none",
          searchResults.length > 0
            ? "mt-1 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex items-center justify-between px-1.5 pb-0.5 text-g-chip font-[510] tracking-[0.02em] text-g-ink-4">
            <span className="inline-flex items-center gap-2">
              <span>{t("aiCanvas.searchResults", { count: searchTotal })}</span>
              {batchMode &&
                (searchSelectedIds.size < searchResults.length ? (
                  <button
                    type="button"
                    className="text-g-purple transition-colors duration-[100ms] ease-g hover:text-g-purple/80 focus-visible:outline-none focus-visible:shadow-g-focus"
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
                ))}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {batchMode && searchSelectedIds.size > 0 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-g-pill bg-g-purple/12 px-2 py-0.5 font-g text-[11px] font-[590] text-g-purple transition-opacity duration-[100ms] ease-g hover:bg-g-purple/20 focus-visible:outline-none focus-visible:shadow-g-focus"
                  onClick={handleBatchAdd}
                >
                  <Plus size={11} />
                  {t("imageTools.addSelected", {
                    count: searchSelectedIds.size,
                  })}
                </button>
              )}
              {!batchMode && <span>{t("aiCanvas.addHint")}</span>}
              <button
                type="button"
                aria-label={t("aiCanvas.batchSelect")}
                className={cn(
                  "inline-flex size-[18px] items-center justify-center rounded-[4px] transition-colors duration-[120ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus",
                  batchMode
                    ? "bg-g-purple/12 text-g-purple"
                    : "text-g-ink-4 hover:bg-g-surface-3 hover:text-g-ink-3",
                )}
                onClick={() => {
                  const entering = !batchMode;
                  setBatchMode(entering);
                  if (!entering) {
                    setSearchSelectedIds(new Set());
                    lastClickIdx.current = -1;
                  }
                }}
              >
                <ListChecks size={11} />
              </button>
            </span>
          </div>
          <div
            data-ai-canvas-scroll="true"
            className={cn(
              "max-h-[320px] overflow-y-auto",
              isDragging && "select-none",
            )}
          >
            {searchResults.map((asset, i) => {
              const selected = searchSelectedIds.has(asset.id);
              const added = addedIds.has(asset.id);

              return (
                <button
                  key={asset.id}
                  type="button"
                  data-active={searchActiveIndex === i || undefined}
                  className={cn(
                    "group flex w-full items-center gap-2.5 py-1.5 text-left transition-colors duration-[100ms] ease-g focus-visible:outline-none focus-visible:shadow-g-focus data-[active]:bg-g-surface-2",
                    i === 0 && "rounded-t-g-sm",
                    i === searchResults.length - 1 && "rounded-b-g-sm",
                    i < searchResults.length - 1 && "border-b border-g-line/50",
                    batchMode
                      ? cn(
                          "border-l-2 px-1.5 hover:bg-g-surface-2",
                          selected
                            ? "border-l-g-purple bg-g-purple-soft"
                            : "border-l-transparent",
                        )
                      : cn(
                          "px-1.5",
                          added
                            ? "cursor-default opacity-50"
                            : "hover:bg-g-surface-2",
                        ),
                  )}
                  onClick={(e) => handleItemClick(asset, i, e)}
                  onPointerDown={(e) => {
                    if (!batchMode) return;
                    e.preventDefault();
                    pendingDragRef.current = true;
                    dragStartIdx.current = i;
                    didDragRef.current = false;
                  }}
                  onPointerEnter={() => {
                    setSearchActiveIndex(i);
                    if (!batchMode) return;
                    if (pendingDragRef.current && i !== dragStartIdx.current) {
                      pendingDragRef.current = false;
                      isDraggingRef.current = true;
                      setIsDragging(true);
                      didDragRef.current = true;
                      const start = Math.min(dragStartIdx.current, i);
                      const end = Math.max(dragStartIdx.current, i);
                      const ids = new Set<string>();
                      for (let j = start; j <= end; j++) {
                        ids.add(searchResults[j].id);
                      }
                      setSearchSelectedIds(ids);
                    } else if (isDraggingRef.current) {
                      didDragRef.current = true;
                      const start = Math.min(dragStartIdx.current, i);
                      const end = Math.max(dragStartIdx.current, i);
                      const ids = new Set<string>();
                      for (let j = start; j <= end; j++) {
                        ids.add(searchResults[j].id);
                      }
                      setSearchSelectedIds(ids);
                    }
                  }}
                >
                  <AssetThumbnail
                    src={asset.thumbnailUrl || asset.url}
                    size="sm"
                    className="size-10 rounded-g-sm"
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
                  {batchMode ? (
                    <span
                      className={cn(
                        "inline-flex size-[14px] shrink-0 items-center justify-center rounded-[3px] transition-colors duration-[100ms] ease-g",
                        selected
                          ? "bg-g-purple/75 text-white"
                          : "border border-g-line group-hover:border-g-ink-3",
                      )}
                    >
                      {selected && (
                        <Check size={10} strokeWidth={3} aria-hidden="true" />
                      )}
                    </span>
                  ) : added ? (
                    <Check size={14} className="shrink-0 text-g-purple" />
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

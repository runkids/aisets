import {
  Clock,
  FileWarning,
  Filter,
  FolderKanban,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Recycle,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Dialog as DialogPrimitive } from "radix-ui";
import type {
  AssetItem,
  CustomAssetFilter,
  SemanticSearchResult,
} from "../types";
import { cn } from "@/lib/cn";
import { semanticSearch, embeddingStats } from "../api";
import { useCatalogItemsInfiniteQuery } from "../queries";
import { useDebouncedValue } from "../useDebouncedValue";
import { useSearchHistory } from "../useSearchHistory";
import { fileName, type Mode } from "../ui";
import {
  AssetThumbnail,
  Badge,
  Keycap,
  TextInput,
  TextInputClearButton,
} from "./ui";
import { DialogOverlay, DialogSurface, DialogViewport } from "./ui/DialogShell";

type SearchMode = "catalog" | "semantic";

type Props = {
  open: boolean;
  scanId?: number;
  customFilters: CustomAssetFilter[];
  ocrEnabled: boolean;
  embedEnabled: boolean;
  onClose: () => void;
  onNavigate: (mode: Mode) => void;
  onOpenAsset: (asset: AssetItem) => void;
  onOpenCustomFilter: (id: string) => void;
};

type ModeItem = { id: Mode; labelKey: string; icon: ReactNode };
type AssetResult = {
  asset: AssetItem;
  matchedOCR: boolean;
  matchedAI: boolean;
};

const MODE_ITEMS: ModeItem[] = [
  {
    id: "projects",
    labelKey: "nav.projects",
    icon: <FolderKanban size={14} />,
  },
  { id: "browse", labelKey: "nav.browse", icon: <FolderOpen size={14} /> },
  { id: "tags", labelKey: "nav.tags", icon: <Tags size={14} /> },
  { id: "duplicates", labelKey: "nav.duplicates", icon: <Recycle size={14} /> },
  { id: "unused", labelKey: "nav.unused", icon: <Trash2 size={14} /> },
  { id: "optimize", labelKey: "nav.optimize", icon: <Gauge size={14} /> },
  { id: "lint", labelKey: "nav.lint", icon: <FileWarning size={14} /> },
  { id: "precheck", labelKey: "nav.precheck", icon: <ShieldCheck size={14} /> },
  { id: "settings", labelKey: "nav.settings", icon: <Settings size={14} /> },
];

function useSemanticSearchQuery(query: string, enabled: boolean) {
  const q = query.trim();
  return useQuery({
    queryKey: ["semantic-search", q],
    queryFn: () => semanticSearch({ q, limit: 20 }),
    enabled: enabled && q !== "",
    staleTime: 30_000,
    gcTime: 60_000,
  });
}

function useEmbedReady(open: boolean, embedEnabled: boolean) {
  const statsQuery = useQuery({
    queryKey: ["embed-stats"],
    queryFn: embeddingStats,
    enabled: open && embedEnabled,
    staleTime: 10_000,
  });
  return (
    (statsQuery.data?.textCount ?? 0) > 0 ||
    (statsQuery.data?.imageCount ?? 0) > 0
  );
}

function SimilarityBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <Badge
      tone={pct >= 80 ? "green" : pct >= 50 ? "blue" : "default"}
      className="ml-auto tabular-nums"
    >
      {pct}%
    </Badge>
  );
}

export function CommandPalette({
  open,
  scanId,
  customFilters,
  ocrEnabled,
  embedEnabled,
  onClose,
  onNavigate,
  onOpenAsset,
  onOpenCustomFilter,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode>("catalog");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const debouncedQuery = useDebouncedValue(query, 180);
  const searchPending = query.trim() !== debouncedQuery.trim();
  const searchHistory = useSearchHistory();
  const embedReady = useEmbedReady(open, embedEnabled);
  const isSemantic = searchMode === "semantic" && embedReady;

  const assetQuery = useCatalogItemsInfiniteQuery(
    scanId,
    { q: debouncedQuery.trim() || undefined, limit: 20 },
    open && debouncedQuery.trim() !== "" && !isSemantic,
  );
  const searchedAssets = useMemo(
    () => assetQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetQuery.data],
  );

  const semanticQuery = useSemanticSearchQuery(
    debouncedQuery,
    open && isSemantic,
  );

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [open]);

  const toggleMode = useCallback(() => {
    if (!embedReady) return;
    setSearchMode((m) => (m === "catalog" ? "semantic" : "catalog"));
    setActiveIndex(0);
  }, [embedReady]);

  const showHistory =
    query.trim() === "" && searchHistory.history.length > 0 && !isSemantic;

  const catalogResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const modesWithLabels = MODE_ITEMS.map((mode) => ({
      ...mode,
      label: t(mode.labelKey),
    }));
    if (!q)
      return {
        modes: modesWithLabels.slice(0, 5),
        filters: [],
        assets: [] as AssetResult[],
      };

    const modes = modesWithLabels.filter((mode) =>
      mode.label.toLowerCase().includes(q),
    );
    const filters = customFilters
      .filter(
        (filter) =>
          filter.enabled &&
          (filter.name.toLowerCase().includes(q) ||
            filter.id.toLowerCase().includes(q)),
      )
      .slice(0, 6);
    const matched: AssetResult[] = searchedAssets
      .map((asset) => ({
        asset,
        matchedOCR: ocrEnabled && asset.ocr?.status === "ready",
        matchedAI: asset.aiTag?.status === "ready",
      }))
      .slice(0, 8);
    return { modes, filters, assets: matched };
  }, [debouncedQuery, searchedAssets, customFilters, ocrEnabled, t]);

  const semanticResults: SemanticSearchResult[] = useMemo(
    () => semanticQuery.data?.results ?? [],
    [semanticQuery.data],
  );

  const historyCount = showHistory ? searchHistory.history.length : 0;
  const totalItems = isSemantic
    ? semanticResults.length
    : historyCount +
      catalogResults.modes.length +
      catalogResults.filters.length +
      catalogResults.assets.length;
  const activeItemIndex =
    totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1);

  useEffect(() => {
    itemRefs.current.length = totalItems;
  }, [totalItems]);

  useEffect(() => {
    if (!open || totalItems === 0) return;
    itemRefs.current[activeItemIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeItemIndex, open, totalItems]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Tab" && embedReady) {
      e.preventDefault();
      toggleMode();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalItems > 0)
        setActiveIndex((index) => Math.min(index + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalItems > 0) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (totalItems > 0) selectItem(activeItemIndex);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  function selectHistoryItem(entry: string) {
    setQuery(entry);
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  function selectItem(index: number) {
    if (index < 0 || index >= totalItems) return;

    if (isSemantic) {
      const result = semanticResults[index];
      if (result) {
        if (query.trim()) searchHistory.add(query.trim());
        onOpenAsset({
          id: result.assetId,
          projectId: result.projectId,
          repoPath: result.repoPath,
        } as AssetItem);
        onClose();
      }
      return;
    }

    if (index < historyCount) {
      selectHistoryItem(searchHistory.history[index]);
      return;
    }

    const adjusted = index - historyCount;
    if (query.trim()) searchHistory.add(query.trim());

    if (adjusted < catalogResults.modes.length) {
      onNavigate(catalogResults.modes[adjusted].id);
    } else if (
      adjusted <
      catalogResults.modes.length + catalogResults.filters.length
    ) {
      const filter =
        catalogResults.filters[adjusted - catalogResults.modes.length];
      if (filter) onOpenCustomFilter(filter.id);
    } else {
      const asset =
        catalogResults.assets[
          adjusted - catalogResults.modes.length - catalogResults.filters.length
        ];
      if (asset) onOpenAsset(asset.asset);
    }
    onClose();
  }

  if (!open) return null;

  const itemCls = cn(
    "flex items-center gap-2.5 w-full min-h-9 px-2.5 py-2 rounded-g-md text-g-ink-2 text-[13px] font-[510] tracking-[-0.012em] text-left",
    "transition-[background,color] duration-[120ms] ease-g active:scale-[0.99] active:transition-transform active:duration-[100ms] active:ease-g-spring",
    "hover:bg-g-surface-2 hover:text-g-ink",
    "data-[active=true]:bg-g-surface-2 data-[active=true]:text-g-ink data-[active=true]:font-[590] [[data-theme=dark]_&]:data-[active=true]:bg-g-surface-3",
    "focus-visible:outline-none focus-visible:shadow-g-focus",
  );

  const catalogFetching = assetQuery.isFetching || searchPending;
  const semanticFetching = semanticQuery.isFetching || searchPending;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay layer="command" />
        </DialogPrimitive.Overlay>
        <DialogViewport layer="command" placement="top">
          <DialogPrimitive.Content
            asChild
            aria-label={t("commandPalette.ariaLabel")}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <DialogSurface size="command" height="auto" motion="command">
              <DialogPrimitive.Title className="sr-only">
                {t("commandPalette.ariaLabel")}
              </DialogPrimitive.Title>
              <div className="flex items-center gap-3 px-4 py-3.5 bg-g-surface border-b border-g-line">
                <TextInput
                  ref={inputRef}
                  variant="command"
                  type="text"
                  icon={
                    isSemantic ? (
                      <Wand2
                        size={16}
                        className="text-g-purple"
                        aria-hidden="true"
                      />
                    ) : (
                      <Search size={16} aria-hidden="true" />
                    )
                  }
                  suffix={
                    <span className="inline-flex items-center gap-1.5">
                      {query && (
                        <TextInputClearButton
                          label={t("toolbar.clearSearch")}
                          onClick={() => {
                            setQuery("");
                            setActiveIndex(0);
                            inputRef.current?.focus();
                          }}
                        />
                      )}
                      {embedReady && (
                        <button
                          type="button"
                          aria-label={t("commandPalette.toggleSemantic")}
                          onClick={toggleMode}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-g-sm border border-solid px-2 py-0.5 font-g-mono text-g-caption font-[510] leading-[1.33] transition-[background,color,border-color] duration-[120ms] ease-g cursor-pointer",
                            isSemantic
                              ? "border-g-purple/30 bg-g-purple-soft text-g-purple"
                              : "border-g-line-strong bg-g-surface-2 text-g-ink-3 hover:bg-g-surface-3 hover:text-g-ink-2",
                          )}
                        >
                          <kbd className="font-g-mono text-[10px] opacity-60">
                            Tab
                          </kbd>
                          <Wand2 size={11} />
                          <span>AI</span>
                        </button>
                      )}
                      <Keycap>Esc</Keycap>
                    </span>
                  }
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKey}
                  placeholder={
                    isSemantic
                      ? t("commandPalette.semanticPlaceholder")
                      : t("commandPalette.placeholder")
                  }
                  aria-label={t("commandPalette.searchAriaLabel")}
                  inputClassName="font-g text-[15px] tracking-g-ui text-g-ink placeholder:text-g-ink-4"
                />
              </div>

              <div className="max-h-[480px] overflow-y-auto p-2">
                {isSemantic ? (
                  <>
                    {semanticFetching && debouncedQuery.trim() && (
                      <div className="flex items-center justify-center gap-2 px-4 py-5 text-g-ink-3 text-[13px]">
                        <LoaderCircle
                          size={14}
                          className="animate-spin text-g-purple"
                        />
                        <span>{t("commandPalette.semanticSearching")}</span>
                      </div>
                    )}

                    {!semanticFetching && semanticResults.length > 0 && (
                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                        <Wand2 size={10} className="text-g-purple" />
                        <span>
                          {t("commandPalette.semanticResults", {
                            count: semanticResults.length,
                          })}
                        </span>
                      </div>
                    )}
                    {semanticResults.map((result, i) => (
                      <button
                        key={`${result.assetId}-${i}`}
                        ref={(node) => {
                          itemRefs.current[i] = node;
                        }}
                        type="button"
                        className={itemCls}
                        data-active={activeItemIndex === i || undefined}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => selectItem(i)}
                      >
                        <AssetThumbnail
                          src={result.thumbnailUrl}
                          size="sm"
                          className="size-[34px] rounded-g-md"
                          imageClassName="max-w-[90%] max-h-[90%]"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-current font-g-mono text-xs font-[510]">
                            {fileName(result.repoPath)}
                          </span>
                          <span className="overflow-hidden text-current opacity-[0.62] font-g-mono text-[11px] tracking-[-0.015em] text-ellipsis whitespace-nowrap">
                            {result.repoPath}
                          </span>
                        </span>
                        <SimilarityBadge value={result.similarity} />
                      </button>
                    ))}

                    {!semanticFetching &&
                      semanticResults.length === 0 &&
                      debouncedQuery.trim() !== "" && (
                        <div className="px-4 py-5 text-g-ink-4 text-[13px] text-center">
                          {t("commandPalette.semanticNoResults")}
                        </div>
                      )}

                    {!debouncedQuery.trim() && (
                      <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
                        <Wand2 size={20} className="text-g-purple opacity-40" />
                        <span className="text-g-ink-3 text-[13px]">
                          {t("commandPalette.semanticHint")}
                        </span>
                        <span className="text-g-ink-4 text-[11px]">
                          <Keycap size="sm">Tab</Keycap>{" "}
                          {t("commandPalette.toggleHint")}
                        </span>
                      </div>
                    )}

                    {semanticQuery.data && semanticResults.length > 0 && (
                      <div className="flex items-center justify-between px-3 pt-2 pb-1 text-g-ink-4 text-[10px] font-[510] tracking-[-0.01em]">
                        <span>
                          {t("commandPalette.semanticMeta", {
                            total: semanticQuery.data.totalEmbeddings,
                            ms: semanticQuery.data.queryDurationMs,
                          })}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {showHistory && (
                      <>
                        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                          <span className="text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                            {t("commandPalette.recentSearches")}
                          </span>
                          <button
                            type="button"
                            className="text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[-0.01em] hover:text-g-ink-2 transition-colors duration-[120ms]"
                            onClick={searchHistory.clear}
                          >
                            {t("commandPalette.clearAll")}
                          </button>
                        </div>
                        {searchHistory.history.map((entry, index) => (
                          <div key={entry} className="flex items-center group">
                            <button
                              ref={(node) => {
                                itemRefs.current[index] = node;
                              }}
                              type="button"
                              className={cn(itemCls, "flex-1 min-w-0")}
                              data-active={
                                activeItemIndex === index || undefined
                              }
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => selectItem(index)}
                            >
                              <span
                                className="inline-flex text-current opacity-[0.52] shrink-0"
                                aria-hidden="true"
                              >
                                <Clock size={14} />
                              </span>
                              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                {entry}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="shrink-0 size-7 inline-flex items-center justify-center rounded-g-md text-g-ink-4 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-g-ink-2 hover:bg-g-surface-2 transition-[opacity,color,background] duration-[120ms] focus-visible:outline-none focus-visible:shadow-g-focus"
                              aria-label={t("commandPalette.removeHistory", {
                                query: entry,
                              })}
                              onClick={() => searchHistory.remove(entry)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    {catalogResults.modes.length > 0 && (
                      <div className="px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                        {t("commandPalette.pages")}
                      </div>
                    )}
                    {catalogResults.modes.map((mode, i) => {
                      const index = historyCount + i;
                      return (
                        <button
                          key={mode.id}
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          type="button"
                          className={itemCls}
                          data-active={activeItemIndex === index || undefined}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectItem(index)}
                        >
                          <span
                            className="inline-flex text-current opacity-[0.82] shrink-0"
                            aria-hidden="true"
                          >
                            {mode.icon}
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {mode.label}
                          </span>
                        </button>
                      );
                    })}

                    {catalogResults.filters.length > 0 && (
                      <>
                        <div className="px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                          {t("commandPalette.customFilters")}
                        </div>
                        {catalogResults.filters.map((filter, i) => {
                          const index =
                            historyCount + catalogResults.modes.length + i;
                          return (
                            <button
                              key={filter.id}
                              ref={(node) => {
                                itemRefs.current[index] = node;
                              }}
                              type="button"
                              className={itemCls}
                              data-active={
                                activeItemIndex === index || undefined
                              }
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => selectItem(index)}
                            >
                              <span
                                className="inline-flex text-current opacity-[0.82] shrink-0"
                                aria-hidden="true"
                              >
                                <Filter size={14} />
                              </span>
                              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                {filter.name}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {catalogResults.assets.length > 0 && (
                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-g-ink-4 text-[10px] font-[510] leading-[1.4] tracking-[0.06em] uppercase">
                        <span>{t("commandPalette.assets")}</span>
                        {catalogFetching && (
                          <LoaderCircle size={11} className="animate-spin" />
                        )}
                      </div>
                    )}
                    {catalogResults.assets.map((result, i) => {
                      const { asset } = result;
                      const index =
                        historyCount +
                        catalogResults.modes.length +
                        catalogResults.filters.length +
                        i;
                      return (
                        <button
                          key={asset.id}
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          type="button"
                          className={itemCls}
                          data-active={activeItemIndex === index || undefined}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectItem(index)}
                        >
                          <AssetThumbnail
                            src={asset.thumbnailUrl || asset.url}
                            size="sm"
                            className="size-[34px] rounded-g-md"
                            imageClassName="max-w-[90%] max-h-[90%]"
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-current font-g-mono text-xs font-[510]">
                              {fileName(asset.repoPath)}
                            </span>
                            <span className="overflow-hidden text-current opacity-[0.62] font-g-mono text-[11px] tracking-[-0.015em] text-ellipsis whitespace-nowrap">
                              {result.matchedOCR || result.matchedAI
                                ? [
                                    result.matchedOCR
                                      ? t("commandPalette.ocrMatch")
                                      : null,
                                    result.matchedAI
                                      ? t("commandPalette.aiMatch")
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")
                                : asset.repoPath}
                            </span>
                          </span>
                          <span className="ml-auto text-current opacity-60 font-g-mono text-[11px] font-[510] tracking-[-0.015em] whitespace-nowrap">
                            {asset.projectName}
                          </span>
                        </button>
                      );
                    })}

                    {totalItems === 0 && !catalogFetching && (
                      <div className="px-4 py-5 text-g-ink-4 text-[13px] text-center">
                        {t("common.noResults")}
                      </div>
                    )}
                  </>
                )}
              </div>
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

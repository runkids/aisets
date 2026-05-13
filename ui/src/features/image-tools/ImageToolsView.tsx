import {
  Check,
  Download,
  FileArchive,
  FolderOpen,
  ImagePlus,
  Images,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Trash2,
  TrendingDown,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/cn";
import {
  APIError,
  downloadImageToolResult,
  getCatalogItemDetail,
  processImageToolAssets,
  processImageToolUploads,
  type ImageToolResult,
  type ImageToolSettings,
} from "@/api";
import { useCatalogItemsInfiniteQuery, useSettingsQuery } from "@/queries";
import type { AssetItem } from "@/types";
import { fileName, formatBytes, formatExt } from "@/ui";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { useDebouncedValue } from "@/useDebouncedValue";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Range,
  Select,
  StatCard,
  TextInput,
} from "@/components/ui";

type Props = {
  scanId?: number;
  assetIds: string[];
  onAssetIdsChange: (assetIds: string[]) => void;
};

const FORMAT_OPTIONS = [
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
  { value: "jpg", label: "JPEG" },
  { value: "png", label: "PNG" },
];
const WALL_CARD_MIN = 132;
const WALL_GAP = 12;

export function ImageToolsView({ scanId, assetIds, onAssetIdsChange }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsDefaultsAppliedRef = useRef(false);
  const [settings, setSettings] = useState<ImageToolSettings>({
    outputFormat: "webp",
    quality: 80,
    maxDimensionPx: 0,
    outputMode: "safeVariants",
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 220);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ImageToolResult[]>([]);
  const [zipToken, setZipToken] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const wallScrollRef = useRef<HTMLDivElement>(null);
  const wallLoadMoreRef = useRef<HTMLDivElement>(null);
  const wallMeasureRef = useRef<HTMLDivElement | null>(null);
  const [wallWidth, setWallWidth] = useState(0);
  const settingsQuery = useSettingsQuery();
  const appSettings = settingsQuery.data?.settings;

  useEffect(() => {
    if (!appSettings || settingsDefaultsAppliedRef.current) return;
    settingsDefaultsAppliedRef.current = true;
    setSettings((prev) => ({
      ...prev,
      quality: appSettings.optimizationDefaultQuality || prev.quality,
      maxDimensionPx:
        appSettings.optimizationThresholds?.maxDimensionPx ||
        prev.maxDimensionPx,
    }));
  }, [appSettings]);

  const catalogQuery = useCatalogItemsInfiniteQuery(scanId, {
    q: debouncedSearch.trim() || undefined,
    limit: 60,
    sort: "recent",
  });
  const queuedAssetIdSet = useMemo(() => new Set(assetIds), [assetIds]);
  const rawPickerItems = useMemo(
    () => catalogQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogQuery.data],
  );
  const rawPickerItemById = useMemo(() => {
    const byId = new Map<string, AssetItem>();
    for (const item of rawPickerItems) byId.set(item.id, item);
    return byId;
  }, [rawPickerItems]);
  const basketHydrationIds = useMemo(
    () => assetIds.filter((id) => !rawPickerItemById.has(id)),
    [assetIds, rawPickerItemById],
  );
  const basketHydrationQueries = useQueries({
    queries: basketHydrationIds.map((assetId) => ({
      queryKey: ["imageTools", "basketItem", scanId ?? 0, assetId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getCatalogItemDetail(scanId, assetId, { signal }),
      enabled: scanId != null,
      retry: false,
      staleTime: 60_000,
    })),
  });
  const hydratedBasketItems = useMemo(
    () =>
      basketHydrationQueries
        .map((query) => query.data?.item)
        .filter(Boolean) as AssetItem[],
    [basketHydrationQueries],
  );
  const basketItemById = useMemo(() => {
    const byId = new Map(rawPickerItemById);
    for (const item of hydratedBasketItems) byId.set(item.id, item);
    return byId;
  }, [hydratedBasketItems, rawPickerItemById]);
  const hydratingBasket =
    basketHydrationIds.length > 0 &&
    basketHydrationQueries.some((query) => query.isPending);
  const staleBasketIds = useMemo(
    () =>
      basketHydrationIds.filter((id, index) => {
        const error = basketHydrationQueries[index]?.error;
        return (
          error instanceof APIError &&
          (error.code === "asset_not_found" || error.code === "not_found")
        );
      }),
    [basketHydrationIds, basketHydrationQueries],
  );

  useEffect(() => {
    if (staleBasketIds.length === 0) return;
    const stale = new Set(staleBasketIds);
    onAssetIdsChange(assetIds.filter((id) => !stale.has(id)));
    setError("");
  }, [assetIds, onAssetIdsChange, staleBasketIds]);

  const pickerItems = useMemo(
    () =>
      rawPickerItems
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
          const leftQueued = queuedAssetIdSet.has(left.item.id);
          const rightQueued = queuedAssetIdSet.has(right.item.id);
          if (leftQueued !== rightQueued) return leftQueued ? -1 : 1;
          return left.index - right.index;
        })
        .map(({ item }) => item),
    [queuedAssetIdSet, rawPickerItems],
  );
  const pickerTotal = catalogQuery.data?.pages[0]?.total ?? 0;
  const wallColumns = Math.max(
    1,
    Math.floor((wallWidth + WALL_GAP) / (WALL_CARD_MIN + WALL_GAP)),
  );
  const wallCardWidth =
    wallWidth > 0
      ? (wallWidth - WALL_GAP * (wallColumns - 1)) / wallColumns
      : WALL_CARD_MIN;
  const wallRowEstimate = Math.ceil(wallCardWidth + WALL_GAP);
  const wallRowCount = Math.ceil(pickerItems.length / wallColumns);
  const wallRows = useMemo(
    () =>
      Array.from({ length: wallRowCount }, (_, rowIndex) =>
        pickerItems.slice(
          rowIndex * wallColumns,
          rowIndex * wallColumns + wallColumns,
        ),
      ),
    [pickerItems, wallColumns, wallRowCount],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- The Image Tools wall can contain thousands of assets; row virtualization keeps the fixed-height workbench responsive.
  const wallVirtualizer = useVirtualizer({
    count: wallRowCount,
    getScrollElement: () => wallScrollRef.current,
    estimateSize: () => wallRowEstimate,
    overscan: 5,
  });

  const wallObserverRef = useRef<ResizeObserver | null>(null);
  const setWallMeasureNode = useCallback((node: HTMLDivElement | null) => {
    wallMeasureRef.current = node;
    wallObserverRef.current?.disconnect();
    wallObserverRef.current = null;
    if (!node) return;
    const update = () => {
      const nextWidth = Math.floor(node.getBoundingClientRect().width);
      setWallWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    wallObserverRef.current = observer;
  }, []);

  useEffect(() => {
    wallVirtualizer.measure();
  }, [wallRowEstimate, wallColumns, wallVirtualizer]);

  const loadMoreCatalogItems = useCallback(() => {
    void catalogQuery.fetchNextPage();
  }, [catalogQuery]);

  useInfiniteScrollSentinel({
    rootRef: wallScrollRef,
    sentinelRef: wallLoadMoreRef,
    enabled: Boolean(
      catalogQuery.hasNextPage && !catalogQuery.isFetchingNextPage,
    ),
    onLoadMore: loadMoreCatalogItems,
  });

  const queuedItems = useMemo(() => {
    return assetIds
      .map((id) => basketItemById.get(id))
      .filter(Boolean) as AssetItem[];
  }, [assetIds, basketItemById]);

  const hasWorkItems = assetIds.length + files.length > 0;
  const successResults = useMemo(
    () => results.filter((r) => !r.errorCode),
    [results],
  );
  const failedCount = results.length - successResults.length;
  const totalSavings = successResults.reduce(
    (sum, r) => sum + r.savingsBytes,
    0,
  );
  const [prevResultCount, setPrevResultCount] = useState(0);
  const [pulseStat, setPulseStat] = useState("");

  useEffect(() => {
    if (results.length > prevResultCount) {
      setPrevResultCount(results.length);
      setPulseStat("processed");
      const timer = setTimeout(() => setPulseStat(""), 300);
      return () => clearTimeout(timer);
    }
  }, [results.length, prevResultCount]);

  function toggleAsset(id: string) {
    if (queuedAssetIdSet.has(id)) {
      onAssetIdsChange(assetIds.filter((a) => a !== id));
    } else {
      onAssetIdsChange([...assetIds, id]);
    }
  }

  const appendFiles = useCallback((list: FileList | File[]) => {
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }, []);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        const isImage =
          file.type.startsWith("image/") ||
          item.type.startsWith("image/") ||
          file.name.toLowerCase().endsWith(".svg");
        if (isImage) pastedFiles.push(file);
      }
      if (pastedFiles.length === 0) return;
      event.preventDefault();
      appendFiles(pastedFiles);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [appendFiles]);

  async function runConvert() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      if (queuedItems.length > 0 && !hydratingBasket) {
        const body = await processImageToolAssets({
          assetIds: queuedItems.map((item) => item.id),
          settings,
        });
        setResults((prev) => [...body.results, ...prev]);
      }
      if (files.length > 0) {
        const body = await processImageToolUploads(files, settings);
        setResults((prev) => [...body.results, ...prev]);
        setZipToken(body.zipToken ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  const showFloatingBar = hasWorkItems || results.length > 0;
  const totalWorkCount = assetIds.length + files.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-g-canvas p-3 max-[768px]:p-2">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1540px] flex-col gap-3">
        {/* StatCards */}
        <div className="flex flex-wrap gap-2">
          <StatCard
            label={t("imageTools.statQueued")}
            value={totalWorkCount}
            icon={<Images size={14} />}
          />
          <StatCard
            label={t("imageTools.statUploads")}
            value={files.length}
            icon={<UploadCloud size={14} />}
          />
          <StatCard
            label={t("imageTools.statProcessed")}
            value={successResults.length}
            icon={<Check size={14} />}
            tone={successResults.length > 0 ? "green" : undefined}
            className={
              pulseStat === "processed"
                ? "animate-[countPulse_280ms_var(--g-ease)]"
                : ""
            }
          />
          <StatCard
            label={t("imageTools.statSaved")}
            value={totalSavings > 0 ? formatBytes(totalSavings) : "—"}
            icon={<TrendingDown size={14} />}
            tone={totalSavings > 0 ? "green" : undefined}
          />
        </div>

        {/* Dual-column content */}
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(320px,0.8fr)] gap-3 max-[1080px]:grid-cols-1",
            showFloatingBar && "pb-[60px]",
          )}
        >
          {/* LEFT: Catalog photo wall */}
          <Card className="min-h-0">
            <CardBody className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput
                    variant="search"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    placeholder={t("imageTools.catalogSearch")}
                  />
                </div>
                <span className="shrink-0 font-g-mono text-g-caption text-g-ink-4">
                  {pickerItems.length} / {pickerTotal}
                </span>
              </div>
              {!scanId ? (
                <EmptyState
                  icon={<Images size={20} />}
                  title={t("imageTools.catalog")}
                  description={t("imageTools.selectOrDrop")}
                  size="md"
                />
              ) : (
                <div className="min-h-0">
                  <div
                    ref={wallScrollRef}
                    className="h-full min-h-0 overflow-y-auto pr-1"
                  >
                    <div ref={setWallMeasureNode} className="relative w-full">
                      <div
                        className="relative w-full"
                        style={{ height: wallVirtualizer.getTotalSize() }}
                      >
                        {wallVirtualizer.getVirtualItems().map((virtualRow) => {
                          const row = wallRows[virtualRow.index] ?? [];
                          return (
                            <div
                              key={virtualRow.key}
                              ref={wallVirtualizer.measureElement}
                              data-index={virtualRow.index}
                              className="absolute left-0 top-0 grid w-full gap-2.5"
                              style={{
                                gridTemplateColumns: `repeat(${wallColumns}, minmax(0, 1fr))`,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              {row.map((item) => {
                                const queued = queuedAssetIdSet.has(item.id);
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                      "group relative aspect-square overflow-hidden rounded-g-md text-left focus-visible:shadow-g-focus",
                                      queued && "bg-g-accent",
                                    )}
                                    aria-pressed={queued}
                                    aria-label={t("imageTools.selectAsset", {
                                      name: fileName(item.repoPath),
                                    })}
                                    onClick={() => toggleAsset(item.id)}
                                  >
                                    <img
                                      src={item.thumbnailUrl || item.url}
                                      alt=""
                                      loading="lazy"
                                      className={cn(
                                        "absolute inset-0 h-full w-full bg-g-surface-2 object-cover transition-transform duration-[220ms] ease-g",
                                        queued
                                          ? "scale-[0.96] rounded-g-xs"
                                          : "group-hover:scale-[1.06]",
                                      )}
                                    />
                                    <span className="absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 pb-2 pt-8 opacity-0 transition-opacity duration-[160ms] ease-g group-hover:opacity-100">
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-g-mono text-g-chip font-[590] text-white">
                                          {fileName(item.repoPath)}
                                        </span>
                                        <span className="block font-g-mono text-[10px] text-white/70">
                                          {formatExt(
                                            item.ext ||
                                              item.repoPath.split(".").pop() ||
                                              "",
                                          ).toUpperCase()}{" "}
                                          · {formatBytes(item.bytes)}
                                        </span>
                                      </span>
                                    </span>
                                    <span
                                      className={cn(
                                        "absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full shadow-g-sm transition-[opacity,background] duration-[120ms]",
                                        queued
                                          ? "bg-white text-g-accent opacity-100"
                                          : "bg-black/40 text-white opacity-0 backdrop-blur group-hover:opacity-100",
                                      )}
                                      aria-hidden="true"
                                    >
                                      {queued ? (
                                        <Check size={14} strokeWidth={3} />
                                      ) : (
                                        <Plus size={13} />
                                      )}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {catalogQuery.hasNextPage && (
                      <div
                        ref={wallLoadMoreRef}
                        className="flex h-12 items-center justify-center gap-2 text-g-ui text-g-ink-4"
                      >
                        {catalogQuery.isFetchingNextPage && (
                          <>
                            <LoaderCircle size={14} className="animate-spin" />
                            {t("common.loading", {
                              defaultValue: "Loading",
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* RIGHT: Results + Drop zone */}
          <Card className="min-h-0">
            <CardBody className="flex h-full min-h-0 flex-col gap-2 p-2.5">
              {results.length > 0 && (
                <div className="flex items-center gap-2 border-b border-g-line pb-2">
                  <span className="font-g text-g-ui font-[590] text-g-ink">
                    {t("imageTools.results")}
                  </span>
                  <span className="flex-1" />
                  {zipToken && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        downloadImageToolResult(
                          zipToken,
                          "aisets-image-tools.zip",
                        )
                      }
                    >
                      <FileArchive size={14} />
                      {t("imageTools.downloadZip")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setResults([]);
                      setZipToken("");
                    }}
                  >
                    <RefreshCcw size={14} />
                    {t("action.clear")}
                  </Button>
                </div>
              )}

              {results.length === 0 ? (
                <button
                  type="button"
                  className={cn(
                    "grid min-h-0 flex-1 cursor-pointer place-items-center rounded-g-md border border-dashed border-g-line p-4 text-center transition-[background,border-color,box-shadow] hover:border-g-line-strong hover:bg-g-surface",
                    dragOver && "border-g-accent bg-g-accent-soft shadow-g-focus",
                  )}
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    appendFiles(event.dataTransfer.files);
                  }}
                >
                  <div className="grid gap-2">
                    <div className="mx-auto grid size-11 place-items-center rounded-g-md border border-g-line bg-g-surface-2 text-g-ink-4 shadow-g-inset">
                      <ImagePlus size={22} />
                    </div>
                    <div className="font-g text-g-ui font-[590] text-g-ink">
                      {t("imageTools.chooseUploads")}
                    </div>
                    <div className="text-g-ui text-g-ink-4">
                      {t("imageTools.dropHint")}
                    </div>
                  </div>
                </button>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="grid content-start gap-2">
                    {results.map((result, index) => {
                      const ratio =
                        result.currentBytes > 0
                          ? result.outputBytes / result.currentBytes
                          : 1;
                      const savingsPct =
                        result.currentBytes > 0
                          ? Math.round((1 - ratio) * 100)
                          : 0;
                      const barColor = result.errorCode
                        ? "bg-g-red"
                        : savingsPct > 20
                          ? "bg-g-green"
                          : savingsPct > 0
                            ? "bg-g-amber"
                            : "bg-g-ink-4";
                      const isProject = result.source === "project";

                      return (
                        <div
                          key={`${result.id}-${index}`}
                          className={cn(
                            "rounded-g-md border border-g-line bg-g-surface p-2.5 shadow-g-sm animate-[resultSlideIn_360ms_var(--g-ease-out)]",
                            result.errorCode && "border-l-[3px] border-l-g-red",
                          )}
                          style={{
                            animationDelay: `${Math.min(index, 8) * 50}ms`,
                          }}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-g-mono text-g-ui font-[590]">
                                {fileName(result.outputPath || result.name)}
                              </div>
                              <div className="mt-0.5 font-g-mono text-g-chip text-g-ink-4">
                                {result.inputFormat.toUpperCase()} →{" "}
                                {result.outputFormat.toUpperCase()}
                                {" · "}
                                {formatBytes(result.currentBytes)} →{" "}
                                {formatBytes(result.outputBytes)}
                              </div>
                              {result.errorCode ? (
                                <div className="mt-1.5 text-g-ui text-g-red">
                                  {result.errorMessage}
                                </div>
                              ) : (
                                <>
                                  <div className="mt-2 flex items-center gap-2">
                                    <div className="h-[6px] flex-1 overflow-hidden rounded-g-pill bg-g-surface-2">
                                      <div
                                        className={cn(
                                          "h-full rounded-g-pill transition-[width] duration-[600ms] ease-g-out",
                                          barColor,
                                        )}
                                        style={{
                                          width: `${Math.round(ratio * 100)}%`,
                                        }}
                                      />
                                    </div>
                                    <span
                                      className={cn(
                                        "shrink-0 font-g-mono text-g-chip font-[590]",
                                        savingsPct > 0
                                          ? "text-g-green"
                                          : savingsPct < 0
                                            ? "text-g-red"
                                            : "text-g-ink-4",
                                      )}
                                    >
                                      {savingsPct > 0
                                        ? `-${savingsPct}%`
                                        : savingsPct < 0
                                          ? `+${Math.abs(savingsPct)}%`
                                          : t("imageTools.noSavingsShort")}
                                    </span>
                                  </div>
                                  <div className="mt-1.5 flex items-center gap-1.5 font-g-mono text-g-chip text-g-ink-3">
                                    {isProject ? (
                                      <>
                                        <FolderOpen
                                          size={11}
                                          className="shrink-0 text-g-green"
                                        />
                                        <span className="truncate">
                                          {t("imageTools.savedTo")}
                                          {result.outputPath
                                            ? ` · ${result.outputPath}`
                                            : ""}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <Download
                                          size={11}
                                          className="shrink-0 text-g-amber"
                                        />
                                        <span>
                                          {t("imageTools.tempDownload")}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                            {result.errorCode ? (
                              <Badge tone="danger">
                                {t("imageTools.failed")}
                              </Badge>
                            ) : result.token ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  downloadImageToolResult(
                                    result.token!,
                                    result.downloadName,
                                  )
                                }
                              >
                                <Download size={14} />
                              </Button>
                            ) : (
                              <Badge tone="green">{t("imageTools.done")}</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Compact drop zone when results exist */}
              {results.length > 0 && (
                <div
                  className={cn(
                    "mt-auto grid min-h-[56px] shrink-0 place-items-center rounded-g-md border border-dashed border-g-line bg-g-canvas p-2 text-center transition-[background,border-color,box-shadow,transform]",
                    dragOver &&
                      "scale-[1.01] border-g-accent bg-g-accent-soft shadow-g-focus",
                  )}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    appendFiles(event.dataTransfer.files);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <ImagePlus size={14} className="text-g-ink-4" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => inputRef.current?.click()}
                    >
                      {t("imageTools.chooseUploads")}
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Floating Action Bar */}
      {showFloatingBar && (
        <div className="absolute inset-x-3 bottom-3 z-[10] mx-auto max-w-[1540px] animate-[imageToolCardIn_280ms_var(--g-ease-out)] rounded-g-lg border border-g-line bg-[color-mix(in_srgb,var(--g-surface)_94%,transparent)] px-3 py-2.5 shadow-g-pop backdrop-blur-[16px] [-webkit-backdrop-filter:blur(16px)]">
          <div className="flex flex-wrap items-center gap-2">
            {working ? (
              <>
                <LoaderCircle
                  size={14}
                  className="animate-spin text-g-accent"
                />
                <span className="font-g text-g-ui font-[590] text-g-ink">
                  {t("imageTools.processing")}
                </span>
                <div className="min-w-[120px] flex-1">
                  <div className="h-[4px] overflow-hidden rounded-g-pill bg-g-surface-2">
                    <div className="h-full w-1/2 rounded-g-pill bg-g-accent animate-[toolbarProgress_1.1s_var(--g-ease-out)_infinite]" />
                  </div>
                </div>
              </>
            ) : hasWorkItems ? (
              <>
                <span className="font-g text-g-ui font-[590] text-g-accent">
                  {t("imageTools.nSelected", { count: totalWorkCount })}
                </span>
                <span className="text-g-ink-5">·</span>
                <Select
                  value={settings.outputFormat}
                  options={FORMAT_OPTIONS}
                  onChange={(value) =>
                    setSettings((prev) => ({ ...prev, outputFormat: value }))
                  }
                  aria-label={t("imageTools.outputFormat")}
                  className="w-24"
                />
                <div className="flex h-g-btn-md items-center gap-1.5 rounded-g-md border border-g-line bg-g-surface px-2">
                  <span className="font-g text-g-chip text-g-ink-3">Q</span>
                  <Range
                    min={1}
                    max={100}
                    value={settings.quality}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        quality: Number(event.currentTarget.value),
                      }))
                    }
                  />
                  <span className="w-6 text-right font-g-mono text-g-chip text-g-ink-3">
                    {settings.quality}
                  </span>
                </div>
                <TextInput
                  value={settings.maxDimensionPx || ""}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      maxDimensionPx: Number(event.currentTarget.value) || 0,
                    }))
                  }
                  placeholder={t("imageTools.resizePlaceholder")}
                  className="w-32"
                />
                <span className="flex-1" />
                {results.length > 0 && zipToken && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      downloadImageToolResult(
                        zipToken,
                        "aisets-image-tools.zip",
                      )
                    }
                  >
                    <FileArchive size={14} />
                  </Button>
                )}
                {files.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                    aria-label={t("action.clear")}
                  >
                    <Trash2 size={13} />
                    <span className="text-g-ink-4">{files.length}</span>
                  </Button>
                )}
                <Button
                  disabled={working || hydratingBasket}
                  onClick={runConvert}
                >
                  <Wand2 size={14} />
                  {t("imageTools.convertN", { count: totalWorkCount })}
                </Button>
              </>
            ) : (
              <>
                <Check size={14} className="text-g-green" />
                <span className="font-g text-g-ui font-[590] text-g-ink">
                  {t("imageTools.processedCount", {
                    count: successResults.length,
                  })}
                </span>
                {failedCount > 0 && (
                  <span className="font-g text-g-ui text-g-red">
                    · {failedCount} {t("imageTools.failed")}
                  </span>
                )}
                {totalSavings > 0 && (
                  <span className="font-g-mono text-g-ui text-g-green">
                    · -{formatBytes(totalSavings)}
                  </span>
                )}
                <span className="flex-1" />
                {zipToken && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      downloadImageToolResult(
                        zipToken,
                        "aisets-image-tools.zip",
                      )
                    }
                  >
                    <FileArchive size={14} />
                    {t("imageTools.downloadZip")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setResults([]);
                    setZipToken("");
                  }}
                >
                  <X size={14} />
                  {t("action.clear")}
                </Button>
              </>
            )}
          </div>
          {error && (
            <div className="mt-1.5 rounded-g-md border border-g-red/30 bg-g-red-soft px-3 py-2 text-g-ui text-g-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files) appendFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

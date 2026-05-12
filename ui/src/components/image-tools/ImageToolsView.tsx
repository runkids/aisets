import {
  Check,
  Download,
  FileArchive,
  ImagePlus,
  Images,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Settings2,
  Trash2,
  UploadCloud,
  Wand2,
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
} from "../../api";
import { useCatalogItemsInfiniteQuery, useSettingsQuery } from "../../queries";
import type { AssetItem } from "../../types";
import { fileName, formatBytes, formatExt } from "../../ui";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";
import { useDebouncedValue } from "../../useDebouncedValue";
import {
  AssetThumbnail,
  Badge,
  Button,
  Card,
  CardBody,
  Range,
  Select,
  TextInput,
} from "../ui";

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
const WALL_GAP = 8;

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
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
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
  const wallRowEstimate = Math.ceil((wallCardWidth * 3) / 4 + 42 + WALL_GAP);
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

  const setWallMeasureNode = useCallback((node: HTMLDivElement | null) => {
    wallMeasureRef.current = node;
  }, []);

  useEffect(() => {
    const node = wallMeasureRef.current;
    if (!node) return;
    const update = () => {
      const nextWidth = Math.floor(node.getBoundingClientRect().width);
      setWallWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
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
  const queuedBytes = queuedItems.reduce((sum, item) => sum + item.bytes, 0);
  const uploadBytes = files.reduce((sum, file) => sum + file.size, 0);
  const hasWorkItems = assetIds.length + files.length > 0;
  function addPickerSelection() {
    const next = Array.from(new Set([...assetIds, ...pickerSelected]));
    onAssetIdsChange(next);
    setPickerSelected(new Set());
  }

  function removeAsset(id: string) {
    onAssetIdsChange(assetIds.filter((assetId) => assetId !== id));
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

  async function runProjectAssets() {
    const processableAssetIds = queuedItems.map((item) => item.id);
    if (processableAssetIds.length === 0 || hydratingBasket) return;
    setWorking(true);
    setError("");
    try {
      const body = await processImageToolAssets({
        assetIds: processableAssetIds,
        settings,
      });
      setResults((prev) => [...body.results, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  async function runUploads() {
    if (files.length === 0) return;
    setWorking(true);
    setError("");
    try {
      const body = await processImageToolUploads(files, settings);
      setResults((prev) => [...body.results, ...prev]);
      setZipToken(body.zipToken ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-g-canvas p-3 max-[768px]:p-2">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1540px] grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="rounded-g-md border border-g-line bg-g-surface-2 p-1.5 shadow-g-inset">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex min-h-[34px] items-center gap-1.5 rounded-g-sm px-2 font-g text-g-ui font-[510] text-g-ink-3">
              <Settings2 size={14} />
              {t("imageTools.outputFormat")}
            </span>
            <Select
              value={settings.outputFormat}
              options={FORMAT_OPTIONS}
              onChange={(value) =>
                setSettings((prev) => ({ ...prev, outputFormat: value }))
              }
              aria-label={t("imageTools.outputFormat")}
              className="w-28"
            />
            <div className="flex h-g-btn-md min-w-[220px] items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-2">
              <span className="font-g text-g-ui text-g-ink-3">
                {t("imageTools.quality")}
              </span>
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
              <span className="w-8 text-right font-g-mono text-g-chip text-g-ink-3">
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
              className="w-44"
            />
            <span className="min-h-[34px] flex-1" />
            <Button
              variant="secondary"
              disabled={working || hydratingBasket || queuedItems.length === 0}
              onClick={runProjectAssets}
            >
              {working ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )}
              {t("imageTools.processProject")}
            </Button>
            <Button
              disabled={working || files.length === 0}
              onClick={runUploads}
            >
              {working ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {t("imageTools.processUploads")}
            </Button>
          </div>
          {error && (
            <div className="mt-1.5 rounded-g-md border border-g-red/30 bg-g-red-soft px-3 py-2 text-g-ui text-g-red">
              {error}
            </div>
          )}
        </div>

        <div className="grid min-h-0 grid-cols-[minmax(0,1.25fr)_minmax(320px,0.8fr)] gap-3 max-[1080px]:grid-cols-1">
          <Card className="min-h-0">
            <CardBody className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 p-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-g text-g-ui font-[590] text-g-ink">
                    {t("imageTools.catalog")}
                  </div>
                  <div className="text-g-caption text-g-ink-4">
                    {t("imageTools.catalogCount", {
                      loaded: pickerItems.length,
                      total: pickerTotal,
                    })}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pickerSelected.size === 0}
                  onClick={addPickerSelection}
                >
                  <Plus size={14} />
                  {t("imageTools.addSelected", { count: pickerSelected.size })}
                </Button>
              </div>
              <TextInput
                variant="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={t("imageTools.catalogSearch")}
              />
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
                            className="absolute left-0 top-0 grid w-full gap-2"
                            style={{
                              gridTemplateColumns: `repeat(${wallColumns}, minmax(0, 1fr))`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {row.map((item) => {
                              const queued = queuedAssetIdSet.has(item.id);
                              const checked =
                                pickerSelected.has(item.id) || queued;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className="group grid overflow-hidden rounded-g-md border border-g-line bg-g-surface text-left shadow-g-sm transition-[border-color,box-shadow,transform,background] duration-[160ms] ease-g hover:-translate-y-0.5 hover:border-g-line-strong hover:shadow-g-md focus-visible:border-g-accent focus-visible:shadow-g-focus data-[selected=true]:border-g-line-strong data-[selected=true]:bg-g-accent-soft data-[selected=true]:shadow-[inset_4px_0_0_var(--g-accent),var(--g-shadow-sm)]"
                                  data-selected={checked || undefined}
                                  aria-pressed={checked}
                                  aria-label={t("imageTools.selectAsset", {
                                    name: fileName(item.repoPath),
                                  })}
                                  onClick={() => {
                                    if (queued) {
                                      removeAsset(item.id);
                                      setPickerSelected((prev) => {
                                        if (!prev.has(item.id)) return prev;
                                        const next = new Set(prev);
                                        next.delete(item.id);
                                        return next;
                                      });
                                      return;
                                    }
                                    setPickerSelected((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.id))
                                        next.delete(item.id);
                                      else next.add(item.id);
                                      return next;
                                    });
                                  }}
                                >
                                  <span className="relative block aspect-[4/3] w-full overflow-hidden border-b border-g-line bg-g-canvas">
                                    <img
                                      src={item.thumbnailUrl || item.url}
                                      alt=""
                                      loading="lazy"
                                      className="absolute inset-0 m-auto h-full w-full object-contain p-2.5 transition-transform duration-[180ms] ease-g group-hover:scale-[1.03]"
                                    />
                                  </span>
                                  <div className="grid min-h-[42px] gap-1 px-2 py-1.5">
                                    <div className="truncate font-g-mono text-g-chip font-[590] text-g-ink">
                                      {fileName(item.repoPath)}
                                    </div>
                                    <div className="flex min-w-0 items-center gap-1">
                                      <Badge>
                                        {formatExt(
                                          item.ext ||
                                            item.repoPath.split(".").pop() ||
                                            "",
                                        )}
                                      </Badge>
                                      <span className="truncate font-g-mono text-[10px] text-g-ink-4">
                                        {formatBytes(item.bytes)}
                                      </span>
                                    </div>
                                  </div>
                                  <span
                                    className="absolute right-2 top-2 grid size-6 place-items-center rounded-g-sm border border-g-line-strong bg-[color-mix(in_srgb,var(--g-surface)_88%,transparent)] text-[12px] font-[800] text-g-ink-4 opacity-0 shadow-g-sm backdrop-blur data-[checked=true]:border-g-accent data-[checked=true]:bg-g-surface data-[checked=true]:text-g-accent data-[checked=true]:opacity-100 group-hover:opacity-100"
                                    data-checked={checked || undefined}
                                    aria-hidden="true"
                                  >
                                    {checked ? (
                                      <Check size={14} />
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
            </CardBody>
          </Card>

          <Card className="min-h-0">
            <CardBody
              className={cn(
                "grid h-full min-h-0 gap-3 p-3",
                hasWorkItems
                  ? "grid-rows-[auto_minmax(0,1fr)_auto_minmax(0,0.72fr)]"
                  : "grid-rows-[auto_minmax(0,1fr)_minmax(0,0.72fr)]",
              )}
            >
              <div className="flex items-center gap-2 border-b border-g-line pb-2">
                <div className="grid size-8 place-items-center rounded-g-md bg-g-accent-soft text-g-accent">
                  <Images size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-g text-g-ui font-[590] text-g-ink">
                    {t("imageTools.queue")}
                  </div>
                  <div className="font-g-mono text-g-caption text-g-ink-4">
                    {queuedItems.length + files.length} ·{" "}
                    {formatBytes(queuedBytes + uploadBytes)}
                  </div>
                </div>
                <Badge tone={working ? "green" : "line"}>
                  {settings.outputFormat.toUpperCase()}
                </Badge>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,.svg"
                multiple
                className="sr-only"
                onChange={(event) => {
                  if (event.currentTarget.files)
                    appendFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />

              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-g-md border border-g-line bg-g-canvas shadow-g-inset">
                <div className="relative h-8 overflow-hidden border-b border-g-line bg-g-surface-2">
                  <div
                    className={cn(
                      "absolute inset-0 opacity-45 [background-image:repeating-linear-gradient(90deg,color-mix(in_srgb,var(--g-accent)_20%,transparent)_0_10px,transparent_10px_20px)]",
                      working &&
                        "opacity-85 animate-[imageToolConveyor_680ms_linear_infinite]",
                    )}
                  />
                  <div className="absolute inset-y-2 left-3 right-3 overflow-hidden rounded-g-pill bg-g-canvas shadow-g-inset">
                    <span
                      className={cn(
                        "block h-full w-1/4 rounded-g-pill bg-[linear-gradient(90deg,transparent,var(--g-accent),transparent)] opacity-40",
                        working &&
                          "w-1/3 opacity-100 animate-[imageToolBeam_1.1s_var(--g-ease-out)_infinite]",
                      )}
                    />
                  </div>
                </div>

                {hydratingBasket ? (
                  <div className="grid min-h-0 place-items-center p-4 text-center text-g-ui text-g-ink-4">
                    <div className="inline-flex items-center gap-2">
                      <LoaderCircle size={14} className="animate-spin" />
                      {t("common.loading", { defaultValue: "Loading" })}
                    </div>
                  </div>
                ) : !hasWorkItems ? (
                  <div
                    className={cn(
                      "grid min-h-0 place-items-center p-4 text-center transition-[background,border-color,box-shadow]",
                      dragOver && "bg-g-accent-soft",
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
                    <div
                      className={cn(
                        "grid w-full max-w-[420px] gap-3 rounded-g-md border border-dashed border-g-line bg-g-surface p-5 shadow-g-sm transition-[border-color,box-shadow,transform]",
                        dragOver &&
                          "scale-[1.01] border-g-accent shadow-g-focus",
                      )}
                    >
                      <div className="mx-auto grid size-11 place-items-center rounded-g-md border border-g-line bg-g-surface-2 text-g-ink-4 shadow-g-inset">
                        <ImagePlus size={22} />
                      </div>
                      <div className="font-g text-g-ui font-[590] text-g-ink">
                        {t("imageTools.emptyQueue")}
                      </div>
                      <div className="text-g-ui text-g-ink-4">
                        {t("imageTools.dropHint")}
                      </div>
                      <div>
                        <Button
                          variant="secondary"
                          onClick={() => inputRef.current?.click()}
                        >
                          {t("imageTools.chooseUploads")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-0 auto-rows-[64px] content-start gap-2 overflow-y-auto p-2">
                    {queuedItems.map((item, index) => (
                      <div
                        key={item.id}
                        className={cn(
                          "relative h-16 overflow-hidden rounded-g-md border border-g-line bg-g-surface p-2 shadow-g-sm animate-[imageToolCardIn_360ms_var(--g-ease-out)]",
                          working &&
                            index === 0 &&
                            "border-g-accent bg-g-accent-soft shadow-[inset_4px_0_0_var(--g-accent),var(--g-shadow-sm)]",
                          working &&
                            "after:absolute after:inset-y-0 after:left-[-35%] after:w-1/3 after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--g-accent)_24%,transparent),transparent)] after:animate-[imageToolScan_1.35s_var(--g-ease-out)_infinite]",
                        )}
                        style={{
                          animationDelay: `${Math.min(index, 8) * 36}ms`,
                        }}
                      >
                        <div className="flex h-full items-center gap-2">
                          <AssetThumbnail
                            src={item.thumbnailUrl || item.url}
                            size="md"
                            className="size-11"
                            imageClassName="max-h-9 max-w-9"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-g-mono text-g-ui font-[590] text-g-ink">
                              {fileName(item.repoPath)}
                            </div>
                            <div className="truncate font-g-mono text-g-chip text-g-ink-4">
                              {item.projectName} · {formatBytes(item.bytes)}
                            </div>
                          </div>
                          <Badge>{formatExt(item.ext || "")}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeAsset(item.id)}
                            aria-label={t("action.delete")}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {files.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className={cn(
                          "relative h-16 overflow-hidden rounded-g-md border border-g-line bg-g-surface p-2 shadow-g-sm animate-[imageToolCardIn_360ms_var(--g-ease-out)]",
                          working &&
                            queuedItems.length === 0 &&
                            index === 0 &&
                            "border-g-accent bg-g-accent-soft shadow-[inset_4px_0_0_var(--g-accent),var(--g-shadow-sm)]",
                          working &&
                            "after:absolute after:inset-y-0 after:left-[-35%] after:w-1/3 after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--g-accent)_24%,transparent),transparent)] after:animate-[imageToolScan_1.35s_var(--g-ease-out)_infinite]",
                        )}
                        style={{
                          animationDelay: `${Math.min(index + queuedItems.length, 8) * 36}ms`,
                        }}
                      >
                        <div className="flex h-full items-center gap-2">
                          <div className="grid size-11 shrink-0 place-items-center rounded-g-md border border-g-line bg-g-surface-2 text-g-ink-4">
                            <UploadCloud size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-g-mono text-g-ui font-[590] text-g-ink">
                              {file.name}
                            </div>
                            <div className="font-g-mono text-g-chip text-g-ink-4">
                              {formatBytes(file.size)}
                            </div>
                          </div>
                          <Badge>{t("imageTools.uploadSource")}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setFiles((prev) =>
                                prev.filter((_, i) => i !== index),
                              )
                            }
                            aria-label={t("action.delete")}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {hasWorkItems && (
                <div className="grid gap-2">
                  <div
                    className={cn(
                      "grid min-h-[92px] place-items-center rounded-g-md border border-dashed border-g-line bg-g-canvas p-3 text-center transition-[background,border-color,box-shadow,transform]",
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
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <div className="grid size-8 place-items-center rounded-g-md border border-g-line bg-g-surface-2 text-g-ink-4 shadow-g-inset">
                        <ImagePlus size={17} />
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => inputRef.current?.click()}
                      >
                        {t("imageTools.chooseUploads")}
                      </Button>
                      <div className="text-g-ui text-g-ink-4">
                        {t("imageTools.dropHint")}
                      </div>
                    </div>
                  </div>
                  {files.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Badge tone="blue">
                        {t("imageTools.uploadCount", { count: files.length })}
                      </Badge>
                      <span className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFiles([])}
                      >
                        <Trash2 size={13} />
                        {t("action.clear")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-g-md border border-g-line bg-g-canvas shadow-g-inset">
                <div className="flex items-center gap-2 border-b border-g-line bg-g-surface-2 px-2 py-1.5">
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
                    onClick={() => setResults([])}
                  >
                    <RefreshCcw size={14} />
                    {t("action.clear")}
                  </Button>
                </div>
                {results.length === 0 ? (
                  <div className="grid min-h-0 place-items-center p-4 text-center text-g-ui text-g-ink-4">
                    <div className="grid gap-2">
                      <div className="mx-auto grid size-10 place-items-center rounded-g-md border border-g-line bg-g-surface text-g-ink-4 shadow-g-inset">
                        <FileArchive size={20} />
                      </div>
                      <div>{t("imageTools.emptyResults")}</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-0 content-start gap-2 overflow-y-auto p-2">
                    {results.map((result, index) => (
                      <div
                        key={`${result.id}-${index}`}
                        className="rounded-g-md border border-g-line bg-g-surface p-2 shadow-g-sm animate-[imageToolPackageIn_520ms_var(--g-ease-out)]"
                        style={{
                          animationDelay: `${Math.min(index, 8) * 42}ms`,
                        }}
                      >
                        <div className="grid gap-2">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-g-mono text-g-ui font-[510]">
                                {fileName(result.outputPath || result.name)}
                              </div>
                              <div className="font-g-mono text-g-chip text-g-ink-4">
                                {result.inputFormat.toUpperCase()} →{" "}
                                {result.outputFormat.toUpperCase()}
                              </div>
                              {(result.outputPath || result.repoPath) && (
                                <div className="mt-1 truncate font-g-mono text-g-chip text-g-ink-3">
                                  {t("imageTools.outputPath")}:{" "}
                                  {result.outputPath || result.repoPath}
                                </div>
                              )}
                            </div>
                            <Badge tone={result.errorCode ? "danger" : "green"}>
                              {result.errorCode
                                ? t("imageTools.failed")
                                : t("imageTools.done")}
                            </Badge>
                          </div>
                          {result.errorCode ? (
                            <div className="text-g-ui text-g-red">
                              {result.errorMessage}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge>{formatBytes(result.currentBytes)}</Badge>
                              <Badge>{formatBytes(result.outputBytes)}</Badge>
                              <Badge>
                                {result.savingsBytes > 0
                                  ? `-${formatBytes(result.savingsBytes)}`
                                  : t("imageTools.noSavings")}
                              </Badge>
                              {result.token && (
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
                                  {t("action.download", {
                                    defaultValue: "Download",
                                  })}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

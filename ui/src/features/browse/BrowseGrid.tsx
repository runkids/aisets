import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CircleOff,
  CircleSlash,
  Copy,
  Gauge,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImageBackgroundMode } from "@/imageBackground";
import { imageBackgroundClassName } from "@/imageBackground";
import type { AssetItem } from "@/types";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { ocrStatusLabel } from "@/ocrStatus";
import {
  notApplicableUsageLabel,
  usageClassification,
} from "@/projectScanIntent";
import { fileName, formatBytes, formatExt, hasDuplicates } from "@/ui";
import { AITagBadge } from "@/features/tags/AITagBadge";
import { OCRStatusBadge } from "@/components/shared/OCRStatusBadge";
import { TagPickerPopover } from "@/features/tags/TagPickerPopover";
import { FavoriteButton } from "@/components/shared/FavoriteButton";
import { Badge, Checkbox, ImagePreview, Tooltip } from "@/components/ui";

type BrowseGridProps = {
  items: AssetItem[];
  gridSize: "s" | "m" | "l";
  bgMode: ImageBackgroundMode;
  bulkMode: boolean;
  selected: Set<string>;
  activeAssetId: string;
  autoScrollAssetId: string;
  imagePreviewEnabled: boolean;
  imagePreviewDelayMs: number;
  imagePreviewSize: { width: number; height: number };
  onAutoScrollDone: () => void;
  onSelect: (item: AssetItem) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (item: AssetItem) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  semanticMetaById?: Record<
    string,
    { similarity: number; matchType?: string; label?: string }
  >;
  favoritePending?: boolean;
};

const SIZE_CONFIG: Record<
  BrowseGridProps["gridSize"],
  { min: number; gap: number; meta: number; thumbHeight: number }
> = {
  s: { min: 140, gap: 8, meta: 68, thumbHeight: 140 },
  m: { min: 200, gap: 12, meta: 100, thumbHeight: 180 },
  l: { min: 300, gap: 16, meta: 112, thumbHeight: 220 },
};
const CARD_HOVER_BLEED = 12;
const CARD_FLAG_CLASS_NAME =
  "inline-flex items-center gap-[3px] rounded-g-sm border px-1.5 py-[3px] text-[10px] font-[590] leading-none tracking-[0.02em] shadow-g-sm";
const CARD_FLAG_DUPLICATE_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-[color-mix(in_srgb,var(--g-amber)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-amber)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-amber)_78%,var(--g-ink)_22%)]`;
const CARD_FLAG_UNUSED_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-[color-mix(in_srgb,var(--g-red)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-red)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-red)_78%,var(--g-ink)_22%)]`;
const CARD_FLAG_POSSIBLY_UNUSED_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-[color-mix(in_srgb,var(--g-amber)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-amber)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-amber)_78%,var(--g-ink)_22%)]`;
const CARD_FLAG_NOT_APPLICABLE_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-g-line bg-g-surface-2 text-g-ink-3`;
const CARD_FLAG_OPTIMIZE_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-[color-mix(in_srgb,var(--g-blue)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-blue)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-blue)_78%,var(--g-ink)_22%)]`;
const CARD_FLAG_OPTIMIZED_CLASS_NAME = `${CARD_FLAG_CLASS_NAME} border-[color-mix(in_srgb,var(--g-green)_52%,var(--g-surface)_48%)] bg-[color-mix(in_srgb,var(--g-green)_18%,var(--g-surface)_82%)] text-[color-mix(in_srgb,var(--g-green)_78%,var(--g-ink)_22%)]`;

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width);
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export function BrowseGrid({
  items,
  gridSize,
  bgMode,
  bulkMode,
  selected,
  activeAssetId,
  autoScrollAssetId,
  imagePreviewEnabled,
  imagePreviewDelayMs,
  imagePreviewSize,
  onAutoScrollDone,
  onSelect,
  onToggleSelect,
  onToggleFavorite,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  semanticMetaById,
  favoritePending = false,
}: BrowseGridProps) {
  const { t } = useTranslation();
  const cfg = SIZE_CONFIG[gridSize];
  const [tagPickerAsset, setTagPickerAsset] = useState<AssetItem | null>(null);
  const tagPickerTriggerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [gridRef, gridWidth] = useElementWidth<HTMLElement>();
  const columnCount = Math.max(
    1,
    Math.floor((gridWidth + cfg.gap) / (cfg.min + cfg.gap)),
  );
  const rowCount = Math.ceil(items.length / columnCount);
  const rowHeight = Math.ceil(cfg.thumbHeight + cfg.meta + cfg.gap);
  const rows = useMemo(
    () =>
      Array.from({ length: rowCount }, (_, rowIndex) =>
        items.slice(
          rowIndex * columnCount,
          rowIndex * columnCount + columnCount,
        ),
      ),
    [columnCount, items, rowCount],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for every Browse grid so large image catalogs stay responsive.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    paddingStart: CARD_HOVER_BLEED,
    paddingEnd: CARD_HOVER_BLEED,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  const toRowIndex = useCallback(
    (index: number) => Math.floor(index / columnCount),
    [columnCount],
  );

  useAutoScroll({
    items,
    activeAssetId,
    autoScrollAssetId,
    scrollRef,
    virtualizer: rowVirtualizer,
    toIndex: toRowIndex,
    enabled: gridWidth > 0,
    onDone: onAutoScrollDone,
  });

  useInfiniteScrollSentinel({
    rootRef: scrollRef,
    sentinelRef: loadMoreRef,
    enabled: hasMore && !loadingMore,
    onLoadMore,
  });

  function renderCard(item: AssetItem) {
    const isActive = activeAssetId === item.id;
    const isSelected = selected.has(item.id);
    const isVisuallySelected = isSelected || isActive;
    const usage = usageClassification(item);
    const isUnused = usage === "unused";
    const isPossiblyUnused = usage === "possiblyUnused";
    const isNotApplicable = usage === "notApplicable";
    const duplicate = hasDuplicates(item);
    const optimizable = item.optimizationRecommendations.length > 0;
    const optimized =
      optimizable &&
      item.optimizationRecommendations.every((r) => r.hasExistingVariant);
    const statusLabels = [
      duplicate ? t("browse.flagDuplicate") : "",
      isUnused ? t("browse.flagUnused") : "",
      isPossiblyUnused ? t("browse.flagPossiblyUnused") : "",
      isNotApplicable ? notApplicableUsageLabel(t, item) : "",
      optimized
        ? t("browse.flagOptimized")
        : optimizable
          ? t("browse.flagOptimizable")
          : "",
      ocrStatusLabel(t, item),
      item.favorite ? t("favorites.saved") : "",
    ].filter(Boolean);
    const referenceLabel = t("asset.refs", { count: item.usedBy.length });
    const ariaLabel = [item.repoPath, referenceLabel, ...statusLabels].join(
      " · ",
    );

    const imgSrc = item.thumbnailUrl || item.url;
    const semanticMeta = semanticMetaById?.[item.id];

    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        className="group/card relative flex flex-col overflow-hidden rounded-g-md border border-g-line bg-g-surface text-left transition-[border-color,box-shadow,transform,background] duration-[160ms] ease-[var(--g-ease)] hover:z-[1] hover:translate-y-[-2px] hover:border-g-line-strong hover:shadow-g-md focus-visible:z-[2] focus-visible:border-g-accent focus-visible:shadow-g-focus data-[selected=true]:z-[2] data-[selected=true]:translate-y-[-2px] data-[selected=true]:border-g-accent data-[selected=true]:shadow-[0_0_0_2px_var(--g-accent),var(--g-shadow-md)] data-[selected=true]:after:absolute data-[selected=true]:after:inset-[6px] data-[selected=true]:after:rounded-[calc(var(--g-r-md)-2px)] data-[selected=true]:after:pointer-events-none data-[selected=true]:after:animate-[selectedPulse_1000ms_var(--g-ease-out)] cursor-pointer"
        data-image-tool-asset-id={item.id}
        data-selected={isVisuallySelected || undefined}
        onClick={() => (bulkMode ? onToggleSelect(item.id) : onSelect(item))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (bulkMode) {
            onToggleSelect(item.id);
          } else {
            onSelect(item);
          }
        }}
        aria-label={ariaLabel}
      >
        <ImagePreview
          src={item.url}
          alt={fileName(item.repoPath)}
          enabled={imagePreviewEnabled}
          delayMs={imagePreviewDelayMs}
          size={imagePreviewSize}
        >
          <div
            className={cn(
              "relative grid place-items-center overflow-hidden border-b border-g-line",
              imageBackgroundClassName(bgMode),
            )}
            style={{
              height: `${cfg.thumbHeight}px`,
            }}
          >
            <img
              src={imgSrc}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full p-3 object-contain"
              onError={(event) => {
                if (
                  imgSrc !== item.url &&
                  event.currentTarget.getAttribute("src") !== item.url
                ) {
                  event.currentTarget.src = item.url;
                }
              }}
            />
            {(duplicate ||
              isUnused ||
              isPossiblyUnused ||
              isNotApplicable ||
              optimizable) && (
              <div
                className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-44px)]"
                aria-hidden="true"
              >
                {duplicate && (
                  <span className={CARD_FLAG_DUPLICATE_CLASS_NAME}>
                    <Copy size={10} />
                    {t("browse.flagDuplicate")}
                  </span>
                )}
                {isUnused && (
                  <span className={CARD_FLAG_UNUSED_CLASS_NAME}>
                    <CircleOff size={10} />
                    {t("browse.flagUnused")}
                  </span>
                )}
                {isPossiblyUnused && (
                  <span className={CARD_FLAG_POSSIBLY_UNUSED_CLASS_NAME}>
                    <CircleOff size={10} />
                    {t("browse.flagPossiblyUnused")}
                  </span>
                )}
                {isNotApplicable && (
                  <span className={CARD_FLAG_NOT_APPLICABLE_CLASS_NAME}>
                    <CircleSlash size={10} />
                    {notApplicableUsageLabel(t, item)}
                  </span>
                )}
                {optimized ? (
                  <span className={CARD_FLAG_OPTIMIZED_CLASS_NAME}>
                    <Gauge size={10} />
                    {t("browse.flagOptimized")}
                  </span>
                ) : optimizable ? (
                  <span className={CARD_FLAG_OPTIMIZE_CLASS_NAME}>
                    <Gauge size={10} />
                    {t("browse.flagOptimizable")}
                  </span>
                ) : null}
              </div>
            )}
            <Checkbox
              asChild
              checked={isSelected || (!bulkMode && isActive)}
              tabIndex={-1}
              size="md"
              className={cn(
                "absolute top-2 right-2 pointer-events-none shadow-g-sm opacity-0 transition-opacity duration-[120ms] ease-[var(--g-ease)] data-[state=checked]:!opacity-100 group-data-[selected=true]/card:!opacity-100",
                bulkMode && "group-hover/card:opacity-100",
              )}
              aria-hidden="true"
            />
          </div>
        </ImagePreview>
        <div className="flex flex-col gap-1 px-3 py-2.5 transition-[background] duration-[160ms] ease-[var(--g-ease)] group-data-[selected=true]/card:bg-g-accent-soft">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip label={item.repoPath} placement="top">
              <div className="block min-w-0 flex-1 truncate text-left font-g-mono text-[12px] font-[510] text-g-ink">
                {fileName(item.repoPath)}
              </div>
            </Tooltip>
            {!bulkMode && (
              <FavoriteButton
                favorite={Boolean(item.favorite)}
                pending={favoritePending}
                label={
                  item.favorite ? t("favorites.remove") : t("favorites.add")
                }
                className={cn(
                  "shrink-0 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
                  item.favorite && "opacity-100",
                )}
                onToggle={() => onToggleFavorite(item)}
              />
            )}
          </div>
          <Tooltip label={item.repoPath} placement="top">
            <div className="block w-full truncate text-left font-g-mono text-[10px] text-g-ink-4">
              {item.repoPath}
            </div>
          </Tooltip>
          <div className="mt-1.5 flex items-center gap-1 font-g-mono text-[10px] tracking-[-0.01em] text-g-ink-3">
            <span className="uppercase">{formatExt(item.ext)}</span>
            <span className="text-g-ink-4">·</span>
            <span>{formatBytes(item.bytes)}</span>
            {!isNotApplicable && (
              <Tooltip label={referenceLabel} placement="top">
                <span className={cn("ml-auto", isUnused && "text-g-red")}>
                  {item.usedBy.length}↗
                </span>
              </Tooltip>
            )}
          </div>
          {gridSize !== "s" && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <OCRStatusBadge item={item} />
              <AITagBadge item={item} />
              {semanticMeta && (
                <Badge tone="purple">
                  {Math.round(semanticMeta.similarity * 100)}%
                  {semanticMeta.matchType ? ` · ${semanticMeta.matchType}` : ""}
                </Badge>
              )}
              <div
                ref={
                  tagPickerAsset?.id === item.id
                    ? tagPickerTriggerRef
                    : undefined
                }
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center size-5 rounded-g-pill border border-dashed border-g-line text-g-ink-4 hover:border-g-accent hover:text-g-accent transition-colors cursor-pointer opacity-0 group-hover/card:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setTagPickerAsset((prev) =>
                    prev?.id === item.id ? null : item,
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setTagPickerAsset((prev) =>
                      prev?.id === item.id ? null : item,
                    );
                  }
                }}
                aria-label={t("tags.addTag")}
              >
                <Plus size={10} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="content-scroll h-full overflow-auto scroll-thin"
    >
      <section
        ref={gridRef}
        className="relative block w-full p-1 align-content-start"
        data-size={gridSize}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        aria-label={t("browse.gridAriaLabel")}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 z-0 w-full grid gap-[var(--row-gap,16px)] grid-cols-[repeat(var(--row-cols,3),minmax(0,1fr))] translate-y-[var(--row-y,0)] hover:z-[3] focus-within:z-[3]"
            style={
              {
                "--row-y": `${virtualRow.start}px`,
                "--row-cols": columnCount,
                "--row-gap": `${cfg.gap}px`,
                height: `${rowHeight}px`,
                paddingBottom: cfg.gap,
              } as CSSProperties
            }
          >
            {rows[virtualRow.index]?.map(renderCard)}
          </div>
        ))}
      </section>
      {hasMore && (
        <div
          ref={loadMoreRef}
          className="flex h-12 items-center justify-center gap-2 font-g-mono text-g-caption text-g-ink-3"
        >
          {loadingMore && <LoaderCircle size={13} className="animate-spin" />}
          {loadingMore ? t("common.loading") : null}
        </div>
      )}
      {tagPickerAsset && (
        <TagPickerPopover
          asset={tagPickerAsset}
          triggerRef={tagPickerTriggerRef}
          onClose={() => setTagPickerAsset(null)}
        />
      )}
    </div>
  );
}

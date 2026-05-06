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
import { Check, CircleOff, Copy, Sparkles, Square } from "lucide-react";
import type { AssetItem } from "../types";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { fileName, formatBytes } from "../ui";
import { Badge, ImagePreview, Tooltip } from "./ui";

type BrowseGridProps = {
  items: AssetItem[];
  gridSize: "s" | "m" | "l";
  bgMode: "checker" | "light" | "dark";
  bulkMode: boolean;
  selected: Set<string>;
  activeAssetId: string;
  autoScrollAssetId: string;
  imagePreviewEnabled: boolean;
  onAutoScrollDone: () => void;
  onSelect: (item: AssetItem) => void;
  onToggleSelect: (id: string) => void;
};

const SIZE_CONFIG: Record<
  BrowseGridProps["gridSize"],
  { min: number; gap: number; meta: number; thumbRatio: number }
> = {
  s: { min: 140, gap: 8, meta: 68, thumbRatio: 1 },
  m: { min: 200, gap: 12, meta: 84, thumbRatio: 3 / 4 },
  l: { min: 300, gap: 16, meta: 96, thumbRatio: 2 / 3 },
};
const CARD_HOVER_BLEED = 12;

function formatExt(ext: string) {
  return ext.replace(/^\./, "").toUpperCase();
}

function hasDuplicates(item: AssetItem) {
  return (
    item.duplicates.length > 0 ||
    item.similar.length > 0 ||
    item.duplicateGroupId != null
  );
}

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
  onAutoScrollDone,
  onSelect,
  onToggleSelect,
}: BrowseGridProps) {
  const { t } = useTranslation();
  const cfg = SIZE_CONFIG[gridSize];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridRef, gridWidth] = useElementWidth<HTMLElement>();
  const columnCount = Math.max(
    1,
    Math.floor((gridWidth + cfg.gap) / (cfg.min + cfg.gap)),
  );
  const rowCount = Math.ceil(items.length / columnCount);
  const cardWidth =
    gridWidth > 0
      ? (gridWidth - cfg.gap * (columnCount - 1)) / columnCount
      : cfg.min;
  const rowHeight = Math.ceil(cardWidth * cfg.thumbRatio + cfg.meta + cfg.gap);
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

  function renderCard(item: AssetItem) {
    const isActive = activeAssetId === item.id;
    const isSelected = selected.has(item.id);
    const isVisuallySelected = isSelected || isActive;
    const isUnused = item.usedBy.length === 0;
    const duplicate = hasDuplicates(item);
    const optimizable = item.optimizationRecommendations.length > 0;
    const statusLabels = [
      duplicate ? t("browse.flagDuplicate") : "",
      isUnused ? t("browse.flagUnused") : "",
      optimizable ? t("browse.flagOptimizable") : "",
    ].filter(Boolean);
    const referenceLabel = t("asset.refs", { count: item.usedBy.length });
    const ariaLabel = [item.repoPath, referenceLabel, ...statusLabels].join(
      " · ",
    );

    const imgSrc = item.thumbnailUrl || item.url;

    return (
      <button
        key={item.id}
        type="button"
        className="group/card relative flex flex-col overflow-hidden rounded-g-md border border-g-line bg-g-surface text-left transition-[border-color,box-shadow,transform,background] duration-[160ms] ease-[var(--g-ease)] hover:z-[1] hover:translate-y-[-2px] hover:border-g-line-strong hover:shadow-g-md focus-visible:z-[2] focus-visible:border-g-accent focus-visible:shadow-g-focus data-[selected=true]:z-[2] data-[selected=true]:translate-y-[-2px] data-[selected=true]:border-g-accent data-[selected=true]:shadow-[0_0_0_2px_var(--g-accent),var(--g-shadow-md)] data-[selected=true]:after:absolute data-[selected=true]:after:inset-[6px] data-[selected=true]:after:rounded-[calc(var(--g-r-md)-2px)] data-[selected=true]:after:pointer-events-none data-[selected=true]:after:animate-[selectedPulse_1000ms_var(--g-ease-out)] cursor-pointer"
        data-selected={isVisuallySelected || undefined}
        onClick={() => (bulkMode ? onToggleSelect(item.id) : onSelect(item))}
        aria-label={ariaLabel}
      >
        <ImagePreview
          src={imgSrc}
          alt={fileName(item.repoPath)}
          enabled={imagePreviewEnabled}
        >
          <div
            className="relative grid place-items-center overflow-hidden border-b border-g-line bg-g-surface-2 data-[bg=dark]:bg-g-ink [[data-theme=dark]_&]:data-[bg=dark]:bg-g-canvas data-[bg=light]:bg-g-surface [[data-theme=dark]_&]:data-[bg=light]:bg-g-ink"
            data-bg={bgMode}
            style={{
              aspectRatio:
                cfg.thumbRatio === 1
                  ? "1"
                  : cfg.thumbRatio === 3 / 4
                    ? "4/3"
                    : "3/2",
            }}
          >
            <img
              src={imgSrc}
              alt=""
              loading="lazy"
              className="absolute inset-3 m-auto max-w-[calc(100%-24px)] max-h-[calc(100%-24px)] object-contain"
            />
            {(duplicate || isUnused || optimizable) && (
              <div
                className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-44px)]"
                aria-hidden="true"
              >
                {duplicate && (
                  <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-amber)_35%,transparent)] bg-g-amber-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-amber">
                    <Copy size={10} />
                    {t("browse.flagDuplicate")}
                  </span>
                )}
                {isUnused && (
                  <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-red)_35%,transparent)] bg-g-red-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-red">
                    <CircleOff size={10} />
                    {t("browse.flagUnused")}
                  </span>
                )}
                {optimizable && (
                  <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-blue)_35%,transparent)] bg-g-blue-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-blue">
                    <Sparkles size={10} />
                    {t("browse.flagOptimizable")}
                  </span>
                )}
              </div>
            )}
            <span
              className="absolute top-2 right-2 grid size-[22px] place-items-center rounded-g-md border border-g-line-strong bg-g-surface text-g-ink-3 opacity-0 transition-[opacity,background,color,border-color] duration-[120ms] ease-[var(--g-ease)] pointer-events-none group-hover/card:opacity-100 group-data-[selected=true]/card:opacity-100 group-data-[selected=true]/card:bg-g-accent group-data-[selected=true]/card:border-g-accent group-data-[selected=true]/card:text-g-accent-ink"
              role={bulkMode ? "checkbox" : undefined}
              aria-checked={bulkMode ? isSelected : undefined}
              aria-label={
                bulkMode
                  ? isSelected
                    ? t("action.deselect")
                    : t("action.select")
                  : undefined
              }
            >
              {isSelected || (!bulkMode && isActive) ? (
                <Check size={12} />
              ) : (
                <Square size={10} />
              )}
            </span>
          </div>
        </ImagePreview>
        <div className="flex flex-col gap-1 px-3 py-2.5 transition-[background] duration-[160ms] ease-[var(--g-ease)] group-data-[selected=true]/card:bg-g-accent-soft">
          <Tooltip label={item.repoPath} placement="top">
            <div className="block w-full truncate text-left font-g-mono text-[12px] font-[510] text-g-ink">
              {fileName(item.repoPath)}
            </div>
          </Tooltip>
          <Tooltip label={item.repoPath} placement="top">
            <div className="block w-full truncate text-left font-g-mono text-[10px] text-g-ink-4">
              {item.repoPath}
            </div>
          </Tooltip>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="line">{formatExt(item.ext)}</Badge>
            <Badge>{formatBytes(item.bytes)}</Badge>
            <Tooltip label={referenceLabel} placement="top">
              <span className="ml-auto inline-flex">
                <Badge tone={isUnused ? "red" : "line"}>
                  {item.usedBy.length}↗
                </Badge>
              </span>
            </Tooltip>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto scroll-thin">
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
    </div>
  );
}

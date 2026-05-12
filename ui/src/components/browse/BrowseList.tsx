import { useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CircleOff,
  CircleSlash,
  Copy,
  Gauge,
  LoaderCircle,
  Square,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImageBackgroundMode } from "../../imageBackground";
import { imageBackgroundClassName } from "../../imageBackground";
import type { AssetItem } from "../../types";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";
import { ocrStatusLabel } from "../../ocrStatus";
import {
  notApplicableUsageLabel,
  usageClassification,
} from "../../projectScanIntent";
import { fileName, formatBytes, formatExt, hasDuplicates } from "../../ui";
import { AITagBadge } from "../tags/AITagBadge";
import { OCRStatusBadge } from "../shared/OCRStatusBadge";
import { Badge, ImagePreview, Tooltip } from "../ui";

type BrowseListProps = {
  items: AssetItem[];
  bgMode: ImageBackgroundMode;
  bulkMode: boolean;
  selected: Set<string>;
  activeAssetId: string;
  autoScrollAssetId: string;
  imagePreviewEnabled: boolean;
  onAutoScrollDone: () => void;
  onSelect: (item: AssetItem) => void;
  onToggleSelect: (id: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
};

const ROW_HEIGHT = 60;
const listGridClassName =
  "grid-cols-[48px_minmax(140px,360px)_92px_52px_112px_minmax(300px,1fr)] max-[768px]:grid-cols-[40px_1fr_68px]";
const listResponsiveClassName =
  "max-[768px]:gap-3 max-[768px]:px-3 max-[768px]:[&>:nth-child(n+4)]:hidden";
const listRowClassName = `grid cursor-pointer ${listGridClassName} items-center gap-4 min-h-[56px] border-b border-g-line px-4 py-2 text-left transition-[background,box-shadow] duration-[120ms] ease-[var(--g-ease)] hover:bg-g-surface-2 focus-visible:shadow-g-focus data-[active=true]:bg-g-accent-soft data-[active=true]:shadow-[inset_4px_0_0_var(--g-accent)] ${listResponsiveClassName}`;
const listHeaderClassName = `sticky top-0 z-[2] grid ${listGridClassName} items-center gap-4 min-h-[36px] border-b border-g-line bg-g-surface-2 px-4 py-2 text-left text-[10px] font-[510] uppercase tracking-[0.06em] text-g-ink-3 ${listResponsiveClassName}`;

export function BrowseList({
  items,
  bgMode,
  bulkMode,
  selected,
  activeAssetId,
  autoScrollAssetId,
  imagePreviewEnabled,
  onAutoScrollDone,
  onSelect,
  onToggleSelect,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: BrowseListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for every Browse list so large image catalogs stay responsive.
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 12,
  });

  useAutoScroll({
    items,
    activeAssetId,
    autoScrollAssetId,
    scrollRef,
    virtualizer: rowVirtualizer,
    onDone: onAutoScrollDone,
  });

  useInfiniteScrollSentinel({
    rootRef: scrollRef,
    sentinelRef: loadMoreRef,
    enabled: hasMore && !loadingMore,
    onLoadMore,
  });

  function renderRow(item: AssetItem, style?: CSSProperties) {
    const isActive = activeAssetId === item.id;
    const isSelected = selected.has(item.id);
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
    ].filter(Boolean);
    const ariaLabel = [item.repoPath, ...statusLabels].join(" · ");

    const imgSrc = item.thumbnailUrl || item.url;

    return (
      <button
        key={item.id}
        type="button"
        className={
          style
            ? `${listRowClassName} absolute left-0 top-0 w-full translate-y-[var(--row-y,0)]`
            : listRowClassName
        }
        data-image-tool-asset-id={item.id}
        data-active={isSelected || isActive || undefined}
        style={style}
        onClick={() => (bulkMode ? onToggleSelect(item.id) : onSelect(item))}
        aria-label={ariaLabel}
      >
        <ImagePreview
          src={item.url}
          alt={fileName(item.repoPath)}
          enabled={imagePreviewEnabled}
        >
          <div
            className={cn(
              "relative grid size-10 place-items-center overflow-hidden rounded-g-md border border-g-line p-1",
              imageBackgroundClassName(bgMode),
            )}
          >
            <img
              src={imgSrc}
              alt=""
              loading="lazy"
              className="max-w-full max-h-full object-contain"
            />
            {bulkMode && (
              <span
                className="absolute inset-auto right-[3px] bottom-[3px] grid size-[18px] place-items-center rounded-g-sm border border-g-line-strong bg-g-surface text-g-ink-3"
                role="checkbox"
                aria-checked={isSelected}
              >
                {isSelected ? <Check size={12} /> : <Square size={10} />}
              </span>
            )}
          </div>
        </ImagePreview>
        <div className="min-w-0 flex flex-col justify-self-stretch">
          <Tooltip label={item.repoPath} placement="top">
            <div className="truncate font-g-mono text-[12px] text-g-ink">
              {fileName(item.repoPath)}
            </div>
          </Tooltip>
          <Tooltip label={item.repoPath} placement="top">
            <div className="truncate font-g-mono text-[10px] text-g-ink-4">
              {item.repoPath}
            </div>
          </Tooltip>
        </div>
        <span className="text-right font-g-mono text-[12px] text-g-ink-2">
          {formatBytes(item.bytes)}
        </span>
        <span
          className="text-right font-g-mono text-[12px] text-g-ink-2 data-[tone=danger]:text-g-red"
          data-tone={isUnused ? "danger" : undefined}
        >
          {item.usedBy.length}
        </span>
        <span className="min-w-0 truncate font-g-mono text-[12px] text-g-ink-3">
          {item.projectName}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <Badge tone="line">{formatExt(item.ext)}</Badge>
          <OCRStatusBadge item={item} />
          <AITagBadge item={item} />
          {duplicate && (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-amber)_35%,transparent)] bg-g-amber-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-amber">
              <Copy size={10} />
              {t("browse.flagDuplicate")}
            </span>
          )}
          {isUnused && (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-red)_35%,transparent)] bg-g-red-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-red">
              <CircleOff size={10} />
              {t("browse.flagUnusedShort")}
            </span>
          )}
          {isPossiblyUnused && (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-amber)_35%,transparent)] bg-g-amber-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-amber">
              <CircleOff size={10} />
              {t("browse.flagPossiblyUnusedShort")}
            </span>
          )}
          {isNotApplicable && (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-g-line bg-g-surface-2 px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-ink-3">
              <CircleSlash size={10} />
              {notApplicableUsageLabel(t, item, { short: true })}
            </span>
          )}
          {optimized ? (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-green)_35%,transparent)] bg-g-green-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-green">
              <Gauge size={10} />
              {t("browse.flagOptimizedShort")}
            </span>
          ) : optimizable ? (
            <span className="inline-flex items-center gap-[3px] rounded-g-sm border border-[color-mix(in_srgb,var(--g-blue)_35%,transparent)] bg-g-blue-soft px-1.5 py-[3px] text-[10px] font-[510] leading-none tracking-[0.02em] text-g-blue">
              <Gauge size={10} />
              {t("browse.flagOptimizableShort")}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="content-scroll h-full overflow-auto scroll-thin"
    >
      <div
        className="overflow-clip rounded-g-md border border-g-line bg-g-surface"
        aria-label={t("browse.listAriaLabel")}
      >
        <div className={listHeaderClassName}>
          <span />
          <span>{t("browse.listHeaderFile")}</span>
          <span className="text-right font-g-mono text-[12px] text-g-ink-3">
            {t("browse.listHeaderSize")}
          </span>
          <span className="text-right font-g-mono text-[12px] text-g-ink-3">
            {t("browse.listHeaderRefs")}
          </span>
          <span>{t("browse.listHeaderProject")}</span>
          <span>{t("browse.listHeaderStatus")}</span>
        </div>
        <div
          className="relative"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            if (!item) return null;
            return renderRow(item, {
              "--row-y": `${virtualRow.start}px`,
            } as CSSProperties);
          })}
        </div>
      </div>
      {hasMore && (
        <div
          ref={loadMoreRef}
          className="flex h-12 items-center justify-center gap-2 font-g-mono text-g-caption text-g-ink-3"
        >
          {loadingMore && <LoaderCircle size={13} className="animate-spin" />}
          {loadingMore ? t("common.loading") : null}
        </div>
      )}
    </div>
  );
}

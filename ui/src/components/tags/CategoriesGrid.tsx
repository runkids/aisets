import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpRight, Layers } from "lucide-react";
import { Badge, Checkbox, EmptyState, Tooltip } from "../ui";
import type { AICategoryItem } from "../../types";

type Props = {
  categories: AICategoryItem[];
  maxCount: number;
  isLoading: boolean;
  selected: Set<string>;
  translations?: Record<string, string>;
  topTagTranslations?: Record<string, string>;
  displayLocale?: string;
  highlightMissing?: boolean;
  onCategoryClick: (category: string) => void;
  onToggleSelect: (category: string) => void;
  bulkMode?: boolean;
};

const ROW_HEIGHT = 52;
const GAP = 2;

export function CategoriesGrid({
  categories,
  maxCount,
  isLoading,
  selected,
  translations,
  topTagTranslations,
  displayLocale,
  highlightMissing = false,
  onCategoryClick,
  onToggleSelect,
  bulkMode = false,
}: Props) {
  const { t } = useTranslation();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  const displayLabel = (raw: string, translated?: string) => {
    if (!translated || translated === raw) return raw;
    return displayLocale === "en" ? translated : `${translated} (${raw})`;
  };

  const categoryLabel = (category: string) => {
    return displayLabel(category, translations?.[category]);
  };
  const topTagLabel = (tag: string) => {
    return displayLabel(tag, topTagTranslations?.[tag]);
  };

  const isMissing = (category: string) =>
    highlightMissing && !translations?.[category];

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setScrollEl(node.closest(".content-scroll") as HTMLElement);
    }
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for category grid performance.
  const rowVirtualizer = useVirtualizer({
    count: categories.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT + GAP,
    overscan: 12,
  });

  if (isLoading && categories.length === 0) {
    return (
      <div className="space-y-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[52px] rounded-g-md bg-g-surface-2 animate-pulse"
            style={{ opacity: 1 - i * 0.08 }}
          />
        ))}
      </div>
    );
  }

  if (!isLoading && categories.length === 0) {
    return (
      <EmptyState
        icon={<Layers size={32} />}
        title={t("tags.emptyCategoriesTitle")}
        description={t("tags.emptyCategoriesDesc")}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex-1">
      <div
        className="relative w-full"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = categories[virtualRow.index];
          const ratio = maxCount > 0 ? item.assetCount / maxCount : 0;
          const isSelected = selected.has(item.category);

          return (
            <div
              key={item.category}
              className={`absolute left-0 right-0 group flex items-center gap-2 px-2 rounded-g-md transition-[background,border-color] duration-[120ms] ease-g ${isSelected ? "bg-g-accent/8" : "hover:bg-g-surface-2"}`}
              style={{
                top: virtualRow.start,
                height: ROW_HEIGHT,
              }}
            >
              {bulkMode && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(item.category)}
                  aria-label={t("tags.selectCategory", {
                    category: item.category,
                  })}
                />
              )}

              <Tooltip label={categoryLabel(item.category)}>
                <button
                  type="button"
                  className={`flex-shrink-0 w-[240px] max-[768px]:w-[120px] text-g-body font-medium truncate text-left cursor-pointer transition-colors ${isMissing(item.category) ? "text-g-amber" : "text-g-ink hover:text-g-accent"}`}
                  onClick={() =>
                    bulkMode
                      ? onToggleSelect(item.category)
                      : onCategoryClick(item.category)
                  }
                >
                  {categoryLabel(item.category)}
                </button>
              </Tooltip>

              <div className="flex-1 flex items-center gap-2.5 min-w-0">
                <div className="flex-1 h-1 rounded-full bg-g-surface-3 overflow-hidden max-w-[280px]">
                  <div
                    className="h-full rounded-full bg-g-accent transition-[width] duration-300 ease-g"
                    style={{ width: `${Math.max(ratio * 100, 3)}%` }}
                  />
                </div>
                <span className="flex-shrink-0 min-w-[2ch] text-right tabular-nums text-g-caption text-g-ink-3 font-[510]">
                  {item.assetCount}
                </span>
              </div>

              <div className="hidden min-[860px]:flex items-center gap-1.5 flex-shrink-0">
                <Badge tone="line">
                  {t("tags.uniqueTagsValue", { count: item.tagCount })}
                </Badge>
                <Badge tone="line">
                  {t("tags.projectsValue", { count: item.projectCount })}
                </Badge>
              </div>

              <div className="hidden min-[1180px]:flex items-center justify-end flex-shrink-0 min-w-0 max-w-[360px] overflow-hidden">
                {item.topTags.length > 0 && (
                  <div className="min-w-0 truncate text-g-caption text-g-ink-3">
                    <span className="text-g-ink-4">{t("tags.topTags")}</span>
                    <span className="px-1 text-g-ink-4">·</span>
                    <span>
                      {item.topTags.slice(0, 4).map(topTagLabel).join(" · ")}
                    </span>
                    {item.topTags.length > 4 && (
                      <Tooltip
                        label={t("tags.moreTopTags", {
                          tags: item.topTags.slice(4).map(topTagLabel).join(", "),
                        })}
                      >
                        <span className="ml-1 inline-flex cursor-help text-g-ink-4">
                          +{item.topTags.length - 4}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-[120ms]">
                <Tooltip label={t("tags.browseCategory")}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center size-7 rounded-g-sm text-g-ink-4 hover:text-g-ink hover:bg-g-surface-3 transition-colors cursor-pointer"
                    onClick={() => onCategoryClick(item.category)}
                    aria-label={t("tags.browseCategory")}
                  >
                    <ArrowUpRight size={13} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

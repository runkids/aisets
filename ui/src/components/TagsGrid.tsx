import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpRight, Tags } from "lucide-react";
import { Badge, Checkbox, EmptyState, Tooltip } from "./ui";
import type { TagItem } from "../types";

const CATEGORY_TONES: Record<
  string,
  "purple" | "blue" | "green" | "amber" | "red" | "info" | "default"
> = {
  icon: "purple",
  photo: "blue",
  screenshot: "info",
  diagram: "green",
  illustration: "amber",
  pattern: "default",
  logo: "red",
  banner: "blue",
  texture: "default",
  sprite: "green",
  mockup: "amber",
  artwork: "purple",
};

type Props = {
  tags: TagItem[];
  maxCount: number;
  isLoading: boolean;
  selected: Set<string>;
  translations?: Record<string, string>;
  onTagClick: (tag: string) => void;
  onToggleSelect: (tag: string) => void;
  bulkMode?: boolean;
};

const ROW_HEIGHT = 44;
const GAP = 2;

export function TagsGrid({
  tags,
  maxCount,
  isLoading,
  selected,
  translations,
  onTagClick,
  onToggleSelect,
  bulkMode = false,
}: Props) {
  const { t } = useTranslation();

  const tagLabel = (tag: string) => {
    const tr = translations?.[tag];
    return tr && tr !== tag ? `${tr} (${tag})` : tag;
  };

  const categoryLabel = (cat: string) => {
    const tr = t(`settings.aiCategory.${cat}`, { defaultValue: cat });
    return tr !== cat ? `${tr} (${cat})` : cat;
  };
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setScrollEl(node.closest(".content-scroll") as HTMLElement);
    }
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally used for tag grid performance.
  const rowVirtualizer = useVirtualizer({
    count: tags.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT + GAP,
    overscan: 12,
  });

  if (isLoading && tags.length === 0) {
    return (
      <div className="space-y-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-[44px] rounded-g-md bg-g-surface-2 animate-pulse"
            style={{ opacity: 1 - i * 0.08 }}
          />
        ))}
      </div>
    );
  }

  if (!isLoading && tags.length === 0) {
    return (
      <EmptyState
        icon={<Tags size={32} />}
        title={t("tags.emptyTitle")}
        description={t("tags.emptyDesc")}
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
          const item = tags[virtualRow.index];
          const ratio = maxCount > 0 ? item.count / maxCount : 0;
          const isSelected = selected.has(item.tag);

          return (
            <div
              key={item.tag}
              className={`absolute left-0 right-0 group flex items-center gap-2 px-2 rounded-g-md transition-[background,border-color] duration-[120ms] ease-g ${isSelected ? "bg-g-accent/8" : "hover:bg-g-surface-2"}`}
              style={{
                top: virtualRow.start,
                height: ROW_HEIGHT,
              }}
            >
              {/* Checkbox — only in bulk mode */}
              {bulkMode && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(item.tag)}
                  aria-label={t("tags.selectTag", { tag: item.tag })}
                />
              )}

              {/* Tag name — clickable to browse */}
              <button
                type="button"
                className="flex-shrink-0 w-[160px] max-[768px]:w-[100px] text-g-body font-medium text-g-ink truncate text-left cursor-pointer hover:text-g-accent transition-colors"
                onClick={() =>
                  bulkMode ? onToggleSelect(item.tag) : onTagClick(item.tag)
                }
              >
                {tagLabel(item.tag)}
              </button>

              {/* Count bar + number */}
              <div className="flex-1 flex items-center gap-2.5 min-w-0">
                <div className="flex-1 h-1 rounded-full bg-g-surface-3 overflow-hidden max-w-[280px]">
                  <div
                    className="h-full rounded-full bg-g-accent transition-[width] duration-300 ease-g"
                    style={{ width: `${Math.max(ratio * 100, 3)}%` }}
                  />
                </div>
                <span className="flex-shrink-0 min-w-[2ch] text-right tabular-nums text-g-caption text-g-ink-3 font-[510]">
                  {item.count}
                </span>
              </div>

              {/* Category badges — desktop only */}
              <div className="hidden min-[1024px]:flex items-center gap-1 w-[130px] justify-end">
                {item.categories.slice(0, 2).map((cat) => (
                  <Badge key={cat} tone={CATEGORY_TONES[cat] ?? "default"}>
                    {categoryLabel(cat)}
                  </Badge>
                ))}
                {item.categories.length > 2 && (
                  <Badge tone="default">+{item.categories.length - 2}</Badge>
                )}
              </div>

              {/* Browse action — appears on hover */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-[120ms]">
                <Tooltip label={t("tags.browseTag")}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center size-7 rounded-g-sm text-g-ink-4 hover:text-g-ink hover:bg-g-surface-3 transition-colors cursor-pointer"
                    onClick={() => onTagClick(item.tag)}
                    aria-label={t("tags.browseTag")}
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

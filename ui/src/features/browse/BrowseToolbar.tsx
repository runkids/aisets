import { HoverCard } from "radix-ui";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Grid3X3,
  List,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
  Trees,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { ImageBackgroundMode } from "@/imageBackground";
import { BulkSelectButton } from "@/components/shared/BulkSelectButton";
import {
  Select,
  TextInput,
  TextInputClearButton,
  Tooltip,
  type SegmentedControlItem,
} from "@/components/ui";
import {
  BrowseIconToggleGroup,
  BrowseSizeToggleGroup,
  BrowseStatusBar,
} from "./BrowseToolbarParts";

export type ViewMode = "grid" | "list" | "tree";
export type SortMode = "name" | "size" | "recent";
export type SearchMode = "catalog" | "semantic";

type StatusFilter =
  | ""
  | "unused"
  | "possiblyUnused"
  | "notApplicable"
  | "duplicate"
  | "optimize"
  | "optimized"
  | "referenced";

type CustomFilterSelectOption = {
  value: string;
  label: string;
};

const DISPLAY_CONTROLS_OPEN_STORAGE_KEY = "aisets-browse-display-controls-open";

function readDisplayControlsOpen() {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.localStorage.getItem(DISPLAY_CONTROLS_OPEN_STORAGE_KEY) !== "false"
    );
  } catch {
    return true;
  }
}

function writeDisplayControlsOpen(open: boolean) {
  try {
    window.localStorage.setItem(
      DISPLAY_CONTROLS_OPEN_STORAGE_KEY,
      open ? "true" : "false",
    );
  } catch {
    // Ignore browser storage failures; the control still works for this session.
  }
}

type BrowseToolbarProps = {
  view: ViewMode;
  gridSize: "s" | "m" | "l";
  bgMode: ImageBackgroundMode;
  searchMode: SearchMode;
  semanticAvailable: boolean;
  searchQuery: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  aiCategory: string;
  aiCategoryOptions: Array<{ value: string; label: string }>;
  customFilter: string;
  customFilterOptions: CustomFilterSelectOption[];
  bulkMode: boolean;
  allSelected: boolean;
  onViewChange: (view: ViewMode) => void;
  onGridSizeChange: (size: "s" | "m" | "l") => void;
  onBgModeChange: (mode: ImageBackgroundMode) => void;
  onSearchModeChange: (mode: SearchMode) => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit: () => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onSortChange: (sort: SortMode) => void;
  onAICategoryChange: (category: string) => void;
  onCustomFilterChange: (id: string) => void;
  onBulkToggle: () => void;
  onBulkCancel: () => void;
};

export function BrowseToolbar({
  view,
  gridSize,
  bgMode,
  searchMode,
  semanticAvailable,
  searchQuery,
  statusFilter,
  sortMode,
  aiCategory,
  aiCategoryOptions,
  customFilter,
  customFilterOptions,
  bulkMode,
  allSelected,
  onViewChange,
  onGridSizeChange,
  onBgModeChange,
  onSearchModeChange,
  onSearchChange,
  onSearchSubmit,
  onStatusFilterChange,
  onSortChange,
  onAICategoryChange,
  onCustomFilterChange,
  onBulkToggle,
  onBulkCancel,
}: BrowseToolbarProps) {
  const { t } = useTranslation();
  const [displayControlsOpen, setDisplayControlsOpen] = useState(
    readDisplayControlsOpen,
  );
  const toggleDisplayControls = () => {
    setDisplayControlsOpen((open) => {
      const nextOpen = !open;
      writeDisplayControlsOpen(nextOpen);
      return nextOpen;
    });
  };

  const viewItems: Array<SegmentedControlItem<ViewMode>> = [
    {
      value: "grid",
      label: t("toolbar.gridView"),
      icon: <Grid3X3 size={16} />,
    },
    { value: "list", label: t("toolbar.listView"), icon: <List size={16} /> },
    { value: "tree", label: t("toolbar.treeView"), icon: <Trees size={16} /> },
  ];
  const sizeItems = [
    { value: "s" as const, label: "S" },
    { value: "m" as const, label: "M" },
    { value: "l" as const, label: "L" },
  ];
  const bgItems = [
    {
      value: "checker" as const,
      label: t("toolbar.checkerBg"),
      icon: <Grid3X3 size={16} />,
    },
    {
      value: "light" as const,
      label: t("toolbar.lightBg"),
      icon: <Sun size={16} />,
    },
    {
      value: "dark" as const,
      label: t("toolbar.darkBg"),
      icon: <Moon size={16} />,
    },
  ];
  const statusItems = [
    { value: "" as const, label: t("status.all") },
    { value: "unused" as const, label: t("status.unused") },
    { value: "possiblyUnused" as const, label: t("status.possiblyUnused") },
    { value: "notApplicable" as const, label: t("status.notApplicable") },
    { value: "duplicate" as const, label: t("status.duplicate") },
    { value: "optimize" as const, label: t("status.optimizable") },
    { value: "optimized" as const, label: t("status.optimized") },
    { value: "referenced" as const, label: t("status.referenced") },
  ];
  const statusHelpItems = [
    {
      label: t("status.unused"),
      description: t("status.help.unused"),
      dot: "bg-g-red",
    },
    {
      label: t("status.possiblyUnused"),
      description: t("status.help.possiblyUnused"),
      dot: "bg-g-amber",
    },
    {
      label: t("status.notApplicable"),
      description: t("status.help.notApplicable"),
      dot: "bg-g-ink-4",
    },
    {
      label: t("status.duplicate"),
      description: t("status.help.duplicate"),
      dot: "bg-g-purple",
    },
    {
      label: t("status.optimizable"),
      description: t("status.help.optimizable"),
      dot: "bg-g-blue",
    },
    {
      label: t("status.optimized"),
      description: t("status.help.optimized"),
      dot: "bg-g-green",
    },
    {
      label: t("status.referenced"),
      description: t("status.help.referenced"),
      dot: "bg-g-green",
    },
  ];
  const sortItems = [
    { value: "name", label: t("toolbar.sortName") },
    { value: "size", label: t("toolbar.sortSize") },
    { value: "recent", label: t("toolbar.sortRecent") },
  ];
  const nextSearchMode = searchMode === "semantic" ? "catalog" : "semantic";

  return (
    <div className="sticky top-0 z-[4] grid gap-2.5 mb-1 pb-1 bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)]">
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto pb-0.5">
        <TextInput
          variant="search"
          placeholder={
            searchMode === "semantic"
              ? t("toolbar.semanticSearch")
              : t("toolbar.search")
          }
          icon={
            searchMode === "semantic" ? (
              <WandSparkles size={16} className="text-g-purple" />
            ) : (
              <Search size={16} />
            )
          }
          suffix={
            <span className="-mr-1 inline-flex h-full items-center gap-1">
              {searchQuery && (
                <TextInputClearButton
                  label={t("toolbar.clearSearch")}
                  onClick={() => onSearchChange("")}
                  className="mr-0.5"
                />
              )}
              {semanticAvailable && (
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-5 items-center gap-1 border-l border-g-line px-2 pr-1 font-g text-[12px] font-[650] tracking-g-ui transition-colors duration-[140ms] ease-g hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus",
                    searchMode === "semantic"
                      ? "text-g-purple"
                      : "text-g-ink-3",
                  )}
                  aria-label={t("toolbar.searchMode")}
                  onClick={() => onSearchModeChange(nextSearchMode)}
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
            </span>
          }
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && semanticAvailable) {
              e.preventDefault();
              onSearchModeChange(nextSearchMode);
              return;
            }
            if (e.key === "Enter" && searchMode === "semantic") {
              e.preventDefault();
              onSearchSubmit();
            }
          }}
          className="min-w-[260px] flex-1"
          inputClassName="font-g text-g-ui tracking-g-ui"
        />

        <Select
          value={sortMode}
          options={sortItems}
          onChange={(value) => onSortChange(value as SortMode)}
          aria-label={t("toolbar.sort")}
          className="w-[150px] flex-none"
        />

        {aiCategoryOptions.length > 0 && (
          <Select
            value={aiCategory}
            options={aiCategoryOptions}
            onChange={onAICategoryChange}
            aria-label={t("filterRail.aiCategory")}
            className="w-[190px] flex-none"
          />
        )}

        {customFilterOptions.length > 0 && (
          <Select
            value={customFilter}
            options={customFilterOptions}
            onChange={onCustomFilterChange}
            aria-label={t("filter.customFilters")}
            className="w-[220px] flex-none"
          />
        )}

        <BulkSelectButton
          bulkMode={bulkMode}
          allSelected={allSelected}
          onToggle={onBulkToggle}
          onCancel={onBulkCancel}
        />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <BrowseStatusBar
            value={statusFilter}
            items={statusItems}
            onChange={onStatusFilterChange}
            ariaLabel={t("toolbar.statusFilter")}
          />
        </div>

        <div
          className={cn(
            "ml-auto flex h-g-btn-md max-w-[480px] shrink-0 flex-row-reverse items-center gap-1.5 overflow-hidden transition-[max-width] duration-200 ease-g-out motion-reduce:transition-none",
            !displayControlsOpen && "max-w-[70px]",
          )}
        >
          <Tooltip
            label={
              displayControlsOpen
                ? t("toolbar.collapseDisplayControls")
                : t("toolbar.expandDisplayControls")
            }
          >
            <button
              type="button"
              aria-label={
                displayControlsOpen
                  ? t("toolbar.collapseDisplayControls")
                  : t("toolbar.expandDisplayControls")
              }
              aria-expanded={displayControlsOpen}
              onClick={toggleDisplayControls}
              className="inline-flex size-g-btn-md shrink-0 cursor-pointer items-center justify-center gap-px rounded-g-md border border-g-line bg-g-surface-2 text-g-ink-3 shadow-g-inset transition-[background,border-color,color,box-shadow,transform] duration-[120ms] ease-g hover:border-g-line-strong hover:bg-g-surface hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus [&:active]:scale-[0.97] motion-reduce:[&:active]:scale-100"
            >
              <span className="relative inline-grid size-5 place-items-center">
                <SlidersHorizontal size={15} aria-hidden="true" />
                {displayControlsOpen ? (
                  <ChevronRight
                    size={10}
                    className="absolute -right-1 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronLeft
                    size={10}
                    className="absolute -left-1 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                )}
              </span>
            </button>
          </Tooltip>

          <HoverCard.Root openDelay={120} closeDelay={120}>
            <HoverCard.Trigger asChild>
              <button
                type="button"
                className="inline-flex h-g-btn-md shrink-0 cursor-pointer items-center justify-center self-center rounded-g-sm px-1.5 text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                aria-label={t("status.helpTitle")}
              >
                <CircleHelp size={15} aria-hidden="true" />
              </button>
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content
                side="top"
                align="end"
                sideOffset={4}
                collisionPadding={16}
                className={cn(
                  "z-[200] w-[480px] rounded-g-lg border border-g-line-strong bg-g-canvas shadow-g-pop",
                  "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                )}
              >
                <div className="border-b border-g-line px-3.5 py-2.5">
                  <h3 className="font-g text-g-ui font-[590] text-g-ink">
                    {t("status.helpTitle")}
                  </h3>
                </div>

                <div className="max-h-[min(420px,60vh)] overflow-y-auto scroll-thin px-3.5 py-3">
                  <p className="mb-3 font-g text-g-caption font-normal leading-relaxed text-g-ink-3">
                    {t("status.helpIntro")}
                  </p>
                  <dl className="grid gap-2.5">
                    {statusHelpItems.map((item) => (
                      <div
                        key={item.label}
                        className="grid grid-cols-[8px_1fr] items-start gap-x-2.5 gap-y-0.5"
                      >
                        <span
                          className={cn(
                            "mt-[5px] h-2 w-2 shrink-0 rounded-full",
                            item.dot,
                          )}
                          aria-hidden="true"
                        />
                        <dt className="font-g text-g-caption font-[590] text-g-ink">
                          {item.label}
                        </dt>
                        <span aria-hidden="true" />
                        <dd className="font-g text-g-caption font-normal leading-relaxed text-g-ink-3">
                          {item.description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>

          <div
            aria-hidden={!displayControlsOpen}
            className={cn(
              "flex min-w-0 shrink-0 items-center gap-1.5 transition-[opacity,transform] duration-200 ease-g-out motion-reduce:transition-none",
              displayControlsOpen
                ? "translate-x-0 opacity-100 delay-75"
                : "pointer-events-none translate-x-3 opacity-0",
            )}
          >
            <BrowseIconToggleGroup
              value={view}
              items={viewItems}
              onChange={onViewChange}
              ariaLabel={t("tabs.viewAriaLabel")}
            />

            {view !== "list" && (
              <BrowseSizeToggleGroup
                value={gridSize}
                items={sizeItems}
                onChange={onGridSizeChange}
                ariaLabel={t("toolbar.gridSize")}
              />
            )}

            <BrowseIconToggleGroup
              value={bgMode}
              items={bgItems}
              onChange={onBgModeChange}
              ariaLabel={t("toolbar.backgroundMode")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

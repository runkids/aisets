import {
  ArrowDownAZ,
  CheckSquare,
  Grid3X3,
  List,
  Moon,
  Search,
  Sun,
  Trees,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImageBackgroundMode } from "../imageBackground";
import { Button, Select, TextInput, type SegmentedControlItem } from "./ui";
import {
  BrowseIconToggleGroup,
  BrowseSizeToggleGroup,
  BrowseStatusBar,
} from "./BrowseToolbarParts";

export type ViewMode = "grid" | "list" | "tree";
export type SortMode = "name" | "size" | "recent";

type StatusFilter =
  | ""
  | "unused"
  | "possiblyUnused"
  | "duplicate"
  | "optimize"
  | "referenced";

type BrowseToolbarProps = {
  view: ViewMode;
  gridSize: "s" | "m" | "l";
  bgMode: ImageBackgroundMode;
  searchQuery: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  bulkMode: boolean;
  onViewChange: (view: ViewMode) => void;
  onGridSizeChange: (size: "s" | "m" | "l") => void;
  onBgModeChange: (mode: ImageBackgroundMode) => void;
  onSearchChange: (query: string) => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onSortChange: (sort: SortMode) => void;
  onBulkToggle: () => void;
};

export function BrowseToolbar({
  view,
  gridSize,
  bgMode,
  searchQuery,
  statusFilter,
  sortMode,
  bulkMode,
  onViewChange,
  onGridSizeChange,
  onBgModeChange,
  onSearchChange,
  onStatusFilterChange,
  onSortChange,
  onBulkToggle,
}: BrowseToolbarProps) {
  const { t } = useTranslation();

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
    { value: "duplicate" as const, label: t("status.duplicate") },
    { value: "optimize" as const, label: t("status.optimizable") },
    { value: "referenced" as const, label: t("status.referenced") },
  ];
  const sortItems = [
    { value: "name", label: t("toolbar.sortName") },
    { value: "size", label: t("toolbar.sortSize") },
    { value: "recent", label: t("toolbar.sortRecent") },
  ];

  return (
    <div className="sticky top-0 z-[4] grid gap-2.5 mb-1 pb-1 bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)]">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          variant="search"
          placeholder={t("toolbar.search")}
          icon={<Search size={16} />}
          suffix={
            <span className="inline-flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t("toolbar.clearSearch")}
                  className="inline-flex shrink-0 cursor-pointer rounded-full p-0.5 text-g-ink-3 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink"
                  onClick={() => onSearchChange("")}
                >
                  <X size={14} />
                </button>
              )}
              <ArrowDownAZ size={14} aria-hidden="true" />
            </span>
          }
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          className="flex-[1_1_360px] min-w-[min(320px,100%)] max-w-[640px] max-md:flex-[1_1_100%] max-md:max-w-none"
          inputClassName="font-g text-g-ui tracking-g-ui"
        />

        <Select
          value={sortMode}
          options={sortItems}
          onChange={(value) => onSortChange(value as SortMode)}
          aria-label={t("toolbar.sort")}
          className="w-36 flex-none"
        />

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

        <Button
          variant={bulkMode ? "primary" : "secondary"}
          size="md"
          leadingIcon={<CheckSquare size={14} />}
          onClick={onBulkToggle}
        >
          {bulkMode ? t("action.deselectAll") : t("toolbar.bulkSelect")}
        </Button>
      </div>

      <BrowseStatusBar
        value={statusFilter}
        items={statusItems}
        onChange={onStatusFilterChange}
        ariaLabel={t("toolbar.statusFilter")}
      />
    </div>
  );
}

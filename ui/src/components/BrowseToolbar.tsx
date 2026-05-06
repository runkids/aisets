import {
  ArrowDownAZ,
  CheckSquare,
  Grid3X3,
  List,
  Moon,
  Search,
  Sun,
  Trees,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select, TextInput, type SegmentedControlItem } from "./ui";
import {
  BrowseActionToggle,
  BrowseIconToggleGroup,
  BrowseSizeToggleGroup,
  BrowseStatusBar,
} from "./BrowseToolbarParts";

export type ViewMode = "grid" | "list" | "tree";
export type SortMode = "name" | "size" | "recent";

type StatusFilter = "" | "unused" | "duplicate" | "optimize" | "referenced";

type BrowseToolbarProps = {
  view: ViewMode;
  gridSize: "s" | "m" | "l";
  bgMode: "checker" | "light" | "dark";
  searchQuery: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  bulkMode: boolean;
  onViewChange: (view: ViewMode) => void;
  onGridSizeChange: (size: "s" | "m" | "l") => void;
  onBgModeChange: (mode: "checker" | "light" | "dark") => void;
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

        <Select
          value={sortMode}
          options={sortItems}
          onChange={(value) => onSortChange(value as SortMode)}
          aria-label={t("toolbar.sort")}
          className="w-36 flex-none"
        />

        <BrowseActionToggle
          active={bulkMode}
          label={t("toolbar.bulkSelect")}
          onToggle={onBulkToggle}
        >
          <CheckSquare size={16} />
        </BrowseActionToggle>

        <TextInput
          variant="search"
          placeholder={t("toolbar.search")}
          icon={<Search size={16} />}
          suffix={<ArrowDownAZ size={14} aria-hidden="true" />}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          className="ml-auto flex-[1_1_360px] min-w-[min(320px,100%)] max-w-[640px] max-md:ml-0 max-md:flex-[1_1_100%] max-md:max-w-none"
          inputClassName="font-g text-g-ui tracking-g-ui"
        />
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

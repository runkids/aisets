import { Popover } from "radix-ui";
import {
  ArrowDownAZ,
  CheckSquare,
  CircleHelp,
  Grid3X3,
  List,
  Moon,
  Search,
  Sun,
  Trees,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { ImageBackgroundMode } from "../imageBackground";
import {
  Button,
  Select,
  TextInput,
  TextInputClearButton,
  type SegmentedControlItem,
} from "./ui";
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
  | "notApplicable"
  | "duplicate"
  | "optimize"
  | "optimized"
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
                <TextInputClearButton
                  label={t("toolbar.clearSearch")}
                  onClick={() => onSearchChange("")}
                />
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

      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <BrowseStatusBar
            value={statusFilter}
            items={statusItems}
            onChange={onStatusFilterChange}
            ariaLabel={t("toolbar.statusFilter")}
          />
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="ml-auto inline-flex h-g-btn-md shrink-0 cursor-pointer items-center justify-center self-center rounded-g-sm px-1.5 text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
              aria-label={t("status.helpTitle")}
            >
              <CircleHelp size={15} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={8}
              collisionPadding={16}
              className={cn(
                "z-[200] w-[480px] rounded-g-lg border border-g-line-strong bg-g-canvas shadow-g-pop",
                "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              )}
            >
              <div className="flex items-center justify-between border-b border-g-line px-3.5 py-2.5">
                <h3 className="font-g text-g-ui font-[590] text-g-ink">
                  {t("status.helpTitle")}
                </h3>
                <Popover.Close asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-g-sm p-0.5 text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                    aria-label="Close"
                  >
                    <X size={14} />
                  </button>
                </Popover.Close>
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
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

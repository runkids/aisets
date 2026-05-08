import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { Rail, RailItem, RailSection, Tooltip } from "./ui";

type FilterOption = {
  id: string;
  count: number;
};

type CustomFilterOption = FilterOption & {
  label: string;
  usesOCR?: boolean;
};

type FilterState = {
  project: string;
  ext: string;
  customFilter: string;
};

type FilterRailProps = {
  items: AssetItem[];
  filters: FilterState;
  projectOptions?: FilterOption[];
  projectTotal?: number;
  projectScopeName?: string;
  extensionOptions?: FilterOption[];
  extensionTotal?: number;
  extensionHeading?: string;
  extensionAllLabel?: string;
  customFilterOptions?: CustomFilterOption[];
  customFilterTotal?: number;
  ocrEnabled?: boolean;
  onFiltersChange: (filters: FilterState) => void;
};

function countBy(items: AssetItem[], key: "projectName" | "ext") {
  const map = new Map<string, number>();
  for (const item of items) {
    const value = item[key];
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function FilterRail({
  items,
  filters,
  projectOptions,
  projectTotal,
  projectScopeName,
  extensionOptions,
  extensionTotal,
  extensionHeading,
  extensionAllLabel,
  customFilterOptions,
  customFilterTotal,
  ocrEnabled = true,
  onFiltersChange,
}: FilterRailProps) {
  const { t } = useTranslation();
  const projects = projectOptions ?? countBy(items, "projectName");
  const extensions = extensionOptions ?? countBy(items, "ext");
  const customFilters = customFilterOptions ?? [];
  const allProjectsCount = projectTotal ?? items.length;
  const allExtensionsCount = extensionTotal ?? items.length;
  const allCustomFiltersCount = customFilterTotal ?? items.length;
  const projectScopeLocked = Boolean(projectScopeName);

  function toggle(key: keyof FilterState, value: string) {
    onFiltersChange({
      ...filters,
      [key]:
        filters[key] === value && !(key === "project" && projectScopeLocked)
          ? ""
          : value,
    });
  }

  return (
    <Rail className="ml-3 px-0">
      <RailSection heading={t("filter.project")}>
        {!projectScopeLocked && (
          <RailItem
            active={filters.project === ""}
            label={t("filter.allProjects")}
            count={allProjectsCount}
            onClick={() => onFiltersChange({ ...filters, project: "" })}
          />
        )}
        {projects.map((option) => (
          <RailItem
            key={option.id}
            active={filters.project === option.id}
            label={option.id}
            count={option.count}
            onClick={() => toggle("project", option.id)}
          />
        ))}
      </RailSection>

      <RailSection heading={extensionHeading || t("filter.extension")}>
        <RailItem
          active={filters.ext === ""}
          label={extensionAllLabel || t("filter.allExtensions")}
          count={allExtensionsCount}
          onClick={() => onFiltersChange({ ...filters, ext: "" })}
        />
        {extensions.map((option) => (
          <RailItem
            key={option.id}
            active={filters.ext === option.id}
            label={option.id}
            count={option.count}
            onClick={() => toggle("ext", option.id)}
          />
        ))}
      </RailSection>

      {customFilters.length > 0 && (
        <RailSection heading={t("filter.customFilters")}>
          <RailItem
            active={filters.customFilter === ""}
            label={t("filter.allCustomFilters")}
            count={allCustomFiltersCount}
            onClick={() => onFiltersChange({ ...filters, customFilter: "" })}
          />
          {customFilters.map((option) => {
            const ocrUnavailable = option.usesOCR && !ocrEnabled;
            return (
              <RailItem
                key={option.id}
                active={filters.customFilter === option.id}
                label={option.label}
                count={
                  ocrUnavailable ? (
                    <span className="inline-flex items-center gap-1">
                      <Tooltip
                        label={t("filter.requiresOCRHint")}
                        placement="top"
                      >
                        <span
                          className="inline-grid size-[18px] place-items-center rounded-g-sm text-g-amber"
                          aria-label={t("filter.requiresOCR")}
                        >
                          <TriangleAlert size={13} />
                        </span>
                      </Tooltip>
                      <span>{option.count}</span>
                    </span>
                  ) : (
                    option.count
                  )
                }
                onClick={() => toggle("customFilter", option.id)}
              />
            );
          })}
        </RailSection>
      )}
    </Rail>
  );
}

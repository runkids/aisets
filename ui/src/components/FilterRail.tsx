import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { Rail, RailItem, RailSection } from "./ui";

type FilterOption = {
  id: string;
  count: number;
};

type FilterRailProps = {
  items: AssetItem[];
  filters: { project: string; ext: string };
  projectOptions?: FilterOption[];
  projectTotal?: number;
  projectScopeName?: string;
  extensionOptions?: FilterOption[];
  extensionTotal?: number;
  onFiltersChange: (filters: { project: string; ext: string }) => void;
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
  onFiltersChange,
}: FilterRailProps) {
  const { t } = useTranslation();
  const projects = projectOptions ?? countBy(items, "projectName");
  const extensions = extensionOptions ?? countBy(items, "ext");
  const allProjectsCount = projectTotal ?? items.length;
  const allExtensionsCount = extensionTotal ?? items.length;
  const projectScopeLocked = Boolean(projectScopeName);

  function toggle(key: "project" | "ext", value: string) {
    onFiltersChange({
      ...filters,
      [key]:
        filters[key] === value && !(key === "project" && projectScopeLocked)
          ? ""
          : value,
    });
  }

  return (
    <Rail>
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

      <RailSection heading={t("filter.extension")}>
        <RailItem
          active={filters.ext === ""}
          label={t("filter.allExtensions")}
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
    </Rail>
  );
}

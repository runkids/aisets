import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { Rail, RailItem, RailSection } from "./ui";

type FilterOption = {
  id: string;
  count: number;
};

type FilterState = {
  project: string;
  ext: string;
  customFilter: string;
  aiCategory: string;
  aiOcrStatus: string;
  hasGPS: string;
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
  ocrReadyCount?: number;
  vlmOcrReadyCount?: number;
  aiTagReadyCount?: number;
  totalCount?: number;
  exifHasGpsCount?: number;
  ocrEnabled?: boolean;
  aiEnabled?: boolean;
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
  ocrReadyCount,
  vlmOcrReadyCount,
  aiTagReadyCount,
  totalCount,
  exifHasGpsCount,
  ocrEnabled = true,
  aiEnabled = false,
  onFiltersChange,
}: FilterRailProps) {
  const { t } = useTranslation();
  const allProjects = projectOptions ?? countBy(items, "projectName");
  const projects = projectScopeName
    ? allProjects.filter((p) => p.id === projectScopeName)
    : allProjects;
  const extensions = extensionOptions ?? countBy(items, "ext");
  const allProjectsCount = projectTotal ?? items.length;
  const allExtensionsCount = extensionTotal ?? items.length;
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
    <Rail className="ml-3 max-h-full px-0">
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

      {(exifHasGpsCount ?? 0) > 0 && (
        <RailSection heading={t("drawer.exif.title")}>
          <RailItem
            active={filters.hasGPS === "true"}
            label={t("filter.hasGps")}
            count={exifHasGpsCount ?? 0}
            onClick={() =>
              onFiltersChange({
                ...filters,
                hasGPS: filters.hasGPS === "true" ? "" : "true",
              })
            }
          />
        </RailSection>
      )}

      {ocrEnabled || aiEnabled ? (
        <RailSection heading={t("filterRail.aiStatus")}>
          <RailItem
            active={filters.aiOcrStatus === ""}
            label={t("filter.all")}
            count={totalCount ?? 0}
            onClick={() => onFiltersChange({ ...filters, aiOcrStatus: "" })}
          />
          {ocrEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "ocrReady"}
              label={t("filterRail.ocrReady")}
              count={ocrReadyCount ?? 0}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "ocrReady" })
              }
            />
          )}
          {ocrEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "ocrPending"}
              label={t("filterRail.ocrPending")}
              count={(totalCount ?? 0) - (ocrReadyCount ?? 0)}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "ocrPending" })
              }
            />
          )}
          {aiEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "vlmOcrReady"}
              label={t("filterRail.vlmOcrReady")}
              count={vlmOcrReadyCount ?? 0}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "vlmOcrReady" })
              }
            />
          )}
          {aiEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "vlmOcrPending"}
              label={t("filterRail.vlmOcrPending")}
              count={(totalCount ?? 0) - (vlmOcrReadyCount ?? 0)}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "vlmOcrPending" })
              }
            />
          )}
          {aiEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "aiTagReady"}
              label={t("filterRail.aiTagReady")}
              count={aiTagReadyCount ?? 0}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "aiTagReady" })
              }
            />
          )}
          {aiEnabled && (
            <RailItem
              active={filters.aiOcrStatus === "aiTagPending"}
              label={t("filterRail.aiTagPending")}
              count={(totalCount ?? 0) - (aiTagReadyCount ?? 0)}
              onClick={() =>
                onFiltersChange({ ...filters, aiOcrStatus: "aiTagPending" })
              }
            />
          )}
        </RailSection>
      ) : null}
    </Rail>
  );
}

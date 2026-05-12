import type { TFunction } from "i18next";
import { matchesCustomAssetFilter } from "@/customAssetFilters";
import { matchesOCRSearchText } from "@/ocrSearch";
import { usageClassification } from "@/projectScanIntent";
import type { AssetItem, CustomAssetFilter } from "@/types";
import { fileName } from "@/ui";
import type {
  SearchMode,
  SortMode,
  ViewMode,
} from "@/components/browse/BrowseToolbar";

export type BrowseStats = {
  totalFiles: number;
  unusedFiles: number;
  possiblyUnusedFiles?: number;
  usageNotApplicableFiles?: number;
};

export type StatusFilter =
  | ""
  | "unused"
  | "possiblyUnused"
  | "notApplicable"
  | "duplicate"
  | "optimize"
  | "optimized"
  | "referenced";
export type BrowseFilters = {
  project: string;
  ext: string;
  customFilter: string;
  aiCategory: string;
  aiOcrStatus: string;
  hasGPS: string;
  favorite: string;
};
export type BrowseStoredState = {
  filters: BrowseFilters;
  view: ViewMode;
  gridSize: "s" | "m" | "l";
  searchMode: SearchMode;
  searchQuery: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
};

const BROWSE_STATE_STORAGE_KEY = "aisets-browse-state";
const viewModes: ViewMode[] = ["grid", "list", "tree"];
const gridSizes: BrowseStoredState["gridSize"][] = ["s", "m", "l"];
const statusFilters: StatusFilter[] = [
  "",
  "unused",
  "possiblyUnused",
  "notApplicable",
  "duplicate",
  "optimize",
  "optimized",
  "referenced",
];
const sortModes: SortMode[] = ["name", "size", "recent"];

export function defaultBrowseStoredState(
  projectFilterName: string,
  initialCustomFilterId: string,
  initialSearchQuery = "",
  initialAICategory = "",
): BrowseStoredState {
  return {
    filters: {
      project: projectFilterName,
      ext: "",
      customFilter: initialCustomFilterId,
      aiCategory: initialAICategory,
      aiOcrStatus: "",
      hasGPS: "",
      favorite: "",
    },
    view: "grid",
    gridSize: "m",
    searchMode: "catalog",
    searchQuery: initialSearchQuery,
    statusFilter: "",
    sortMode: "name",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function optionOrDefault<T extends string>(
  value: unknown,
  options: T[],
  fallback: T,
) {
  return typeof value === "string" && options.includes(value as T)
    ? (value as T)
    : fallback;
}

export function normalizeBrowseStoredState(
  value: unknown,
  defaults: BrowseStoredState,
  pinned?: {
    project?: string;
    customFilter?: string;
    searchQuery?: string;
    aiCategory?: string;
    favorite?: string;
  },
): BrowseStoredState {
  const state = isRecord(value) ? value : {};
  const rawFilters = isRecord(state.filters) ? state.filters : {};
  const filters = {
    project: stringOrDefault(rawFilters.project, defaults.filters.project),
    ext: stringOrDefault(rawFilters.ext, defaults.filters.ext),
    customFilter: stringOrDefault(
      rawFilters.customFilter,
      defaults.filters.customFilter,
    ),
    aiCategory: stringOrDefault(
      rawFilters.aiCategory,
      defaults.filters.aiCategory,
    ),
    aiOcrStatus: stringOrDefault(
      rawFilters.aiOcrStatus,
      defaults.filters.aiOcrStatus,
    ),
    hasGPS: stringOrDefault(rawFilters.hasGPS, defaults.filters.hasGPS),
    favorite: stringOrDefault(rawFilters.favorite, defaults.filters.favorite),
  };

  if (pinned?.project) filters.project = pinned.project;
  if (pinned?.customFilter) filters.customFilter = pinned.customFilter;
  if (pinned?.aiCategory) filters.aiCategory = pinned.aiCategory;
  if (pinned?.favorite) filters.favorite = pinned.favorite;
  const searchQuery =
    pinned?.searchQuery != null ? pinned.searchQuery : defaults.searchQuery;

  return {
    filters,
    view: optionOrDefault(state.view, viewModes, defaults.view),
    gridSize: optionOrDefault(state.gridSize, gridSizes, defaults.gridSize),
    searchMode: defaults.searchMode,
    searchQuery,
    statusFilter: optionOrDefault(
      state.statusFilter,
      statusFilters,
      defaults.statusFilter,
    ),
    sortMode: optionOrDefault(state.sortMode, sortModes, defaults.sortMode),
  };
}

export function readBrowseStoredState(
  defaults: BrowseStoredState,
  pinned?: {
    project?: string;
    customFilter?: string;
    searchQuery?: string;
    aiCategory?: string;
    favorite?: string;
  },
) {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(BROWSE_STATE_STORAGE_KEY);
    return normalizeBrowseStoredState(
      raw ? JSON.parse(raw) : null,
      defaults,
      pinned,
    );
  } catch {
    return defaults;
  }
}

export function writeBrowseStoredState(state: BrowseStoredState) {
  try {
    window.localStorage.setItem(
      BROWSE_STATE_STORAGE_KEY,
      JSON.stringify({
        ...state,
        searchQuery: "",
      }),
    );
  } catch {
    // Ignore browser storage failures; filters still work for this session.
  }
}

export function resetBrowseFiltersForStatusChange(
  projectScopeName = "",
  favorite = "",
): BrowseFilters {
  return {
    project: projectScopeName,
    ext: "",
    customFilter: "",
    aiCategory: "",
    aiOcrStatus: "",
    hasGPS: "",
    favorite,
  };
}

function matchesStatus(item: AssetItem, status: StatusFilter): boolean {
  switch (status) {
    case "unused":
      return usageClassification(item) === "unused";
    case "possiblyUnused":
      return usageClassification(item) === "possiblyUnused";
    case "notApplicable":
      return usageClassification(item) === "notApplicable";
    case "duplicate":
      return Boolean(item.duplicateGroupId) || item.similar.length > 0;
    case "optimize":
      return item.optimizationRecommendations.length > 0;
    case "optimized":
      return (
        item.optimizationRecommendations.length > 0 &&
        item.optimizationRecommendations.every((r) => r.hasExistingVariant)
      );
    case "referenced":
      return item.usedBy.length > 0;
    default:
      return true;
  }
}

export function apiStatus(status: StatusFilter) {
  if (status === "optimize") return "optimizable";
  if (status === "optimized") return "optimized";
  if (
    status === "unused" ||
    status === "possiblyUnused" ||
    status === "notApplicable" ||
    status === "duplicate" ||
    status === "referenced"
  )
    return status;
  return "";
}

export function apiSort(sort: SortMode) {
  if (sort === "size") return "bytes-desc";
  if (sort === "recent") return "recent";
  if (sort === "name") return "path";
  return "";
}

function hasEmptyOCRText(item: AssetItem): boolean {
  return Boolean(
    item.ocr?.status === "ready" &&
    (item.ocr.emptyText ||
      (!(item.ocr.normalizedText ?? item.ocr.text ?? "").trim() &&
        item.ocr.textStatus === "empty")),
  );
}

export function browseEmptyCopy(
  statusFilter: StatusFilter,
  stats: BrowseStats | undefined,
  t: TFunction,
) {
  const hasAssets = (stats?.totalFiles ?? 0) > 0;
  const safeUnused = stats?.unusedFiles ?? 0;
  const possiblyUnused = stats?.possiblyUnusedFiles ?? 0;
  const notApplicable = stats?.usageNotApplicableFiles ?? 0;

  if (statusFilter === "unused" && hasAssets && safeUnused === 0) {
    if (notApplicable > 0) {
      return {
        title: t("browse.unusedNotApplicableEmpty"),
        description: t("browse.unusedNotApplicableDesc", {
          count: notApplicable,
        }),
        tone: "neutral" as const,
      };
    }
    if (possiblyUnused > 0) {
      return {
        title: t("browse.unusedAdvisoryEmpty"),
        description: t("browse.unusedAdvisoryDesc", {
          count: possiblyUnused,
        }),
        tone: "neutral" as const,
      };
    }
  }

  if (statusFilter === "notApplicable" && notApplicable > 0) {
    return {
      title: t("browse.notApplicableTitle"),
      description: t("browse.notApplicableDesc", { count: notApplicable }),
      tone: "neutral" as const,
    };
  }

  return {
    title: t("browse.empty"),
    description: undefined,
    tone: "neutral" as const,
  };
}

export function applyBrowseFilters({
  items,
  filters,
  searchQuery,
  statusFilter,
  customFilters,
  ocrEnabled = true,
  ocrFuzzySearch = true,
}: {
  items: AssetItem[];
  filters: BrowseFilters;
  searchQuery: string;
  statusFilter: StatusFilter;
  customFilters: CustomAssetFilter[];
  ocrEnabled?: boolean;
  ocrFuzzySearch?: boolean;
}) {
  const q = searchQuery.trim().toLowerCase();
  const facetBaseItems = items.filter((item) => {
    const rawOCRText =
      item.ocr?.status === "ready"
        ? (item.ocr.normalizedText ?? item.ocr.text ?? "")
        : "";
    const ocrText = rawOCRText.trim() ? rawOCRText : "";
    if (!matchesStatus(item, statusFilter)) return false;
    if (
      q &&
      !fileName(item.repoPath).toLowerCase().includes(q) &&
      !item.repoPath.toLowerCase().includes(q) &&
      (!ocrEnabled ||
        !matchesOCRSearchText(ocrText, q, { fuzzy: ocrFuzzySearch }))
    )
      return false;
    return true;
  });
  const filteredWithoutCustom = facetBaseItems.filter((item) => {
    if (filters.project && item.projectName !== filters.project) return false;
    if (filters.ext && item.ext !== filters.ext) return false;
    if (filters.favorite === "true" && !item.favorite) return false;
    return true;
  });
  const selectedCustomFilter =
    customFilters.find(
      (filter) => filter.enabled && filter.id === filters.customFilter,
    ) ?? null;
  const filtered = selectedCustomFilter
    ? filteredWithoutCustom.filter((item) =>
        matchesCustomAssetFilter(item, selectedCustomFilter),
      )
    : filteredWithoutCustom;
  const emptyOCRTextCount = items.filter((item) => {
    if (!matchesStatus(item, statusFilter)) return false;
    if (filters.project && item.projectName !== filters.project) return false;
    if (filters.ext && item.ext !== filters.ext) return false;
    if (filters.favorite === "true" && !item.favorite) return false;
    if (
      selectedCustomFilter &&
      !matchesCustomAssetFilter(item, selectedCustomFilter)
    ) {
      return false;
    }
    return ocrEnabled && hasEmptyOCRText(item);
  }).length;
  return { facetBaseItems, filteredWithoutCustom, filtered, emptyOCRTextCount };
}

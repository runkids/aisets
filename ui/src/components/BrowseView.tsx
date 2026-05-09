import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  FolderOutput,
  LoaderCircle,
  PenLine,
  Trash2,
} from "lucide-react";
import { matchesCustomAssetFilter } from "../customAssetFilters";
import {
  useBatchDeleteMutation,
  useBatchCopyMutation,
  useBatchMovePreviewMutation,
  useBatchRenamePreviewMutation,
  useBatchApplyMutation,
  useCatalogFoldersQuery,
  useCatalogItemsInfiniteQuery,
  useRunAITagMutation,
  useSettingsQuery,
} from "../queries";
import type { AITagRunCounts } from "../types";
import {
  batchExport,
  type BatchPreviewResponse,
  type CatalogFoldersParams,
  type CatalogItemsParams,
} from "../api";
import { BatchConfirmModal } from "./BatchConfirmModal";
import { BatchPreviewModal } from "./BatchPreviewModal";
import { RenameRuleModal } from "./RenameRuleModal";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import { matchesOCRSearchText } from "../ocrSearch";
import { usageClassification } from "../projectScanIntent";
import type {
  AssetItem,
  CatalogFolderNode,
  CustomAssetFilter,
  RenameRules,
} from "../types";
import { useDebouncedValue } from "../useDebouncedValue";
import { fileName, formatBytes } from "../ui";
import { BrowseGrid } from "./BrowseGrid";
import { BrowseList } from "./BrowseList";
import { BrowseToolbar, type SortMode, type ViewMode } from "./BrowseToolbar";
import { useImageBackgroundControls } from "../imageBackground";
import { FilterRail } from "./FilterRail";
import { Button, EmptyState, Tooltip } from "./ui";

type StatusFilter =
  | ""
  | "unused"
  | "possiblyUnused"
  | "notApplicable"
  | "duplicate"
  | "optimize"
  | "optimized"
  | "referenced";
type BrowseFilters = {
  project: string;
  ext: string;
  customFilter: string;
  aiCategory: string;
};
type BrowseStoredState = {
  filters: BrowseFilters;
  view: ViewMode;
  gridSize: "s" | "m" | "l";
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

type Props = {
  activeAssetId: string;
  autoScrollAssetId: string;
  initialCustomFilterId: string;
  customFilters: CustomAssetFilter[];
  scanId?: number;
  projectFilterId?: string;
  projectFilterName: string;
  stats?: {
    totalFiles: number;
    unusedFiles: number;
    possiblyUnusedFiles?: number;
    usageNotApplicableFiles?: number;
  };
  initialSearchQuery: string;
  initialFocusAssetId: string;
  imagePreviewEnabled: boolean;
  ocrEnabled: boolean;
  ocrFuzzySearch: boolean;
  onAutoScrollDone: () => void;
  onOpenAsset: (id: string) => void;
};

function defaultBrowseStoredState(
  projectFilterName: string,
  initialCustomFilterId: string,
  initialSearchQuery = "",
): BrowseStoredState {
  return {
    filters: {
      project: projectFilterName,
      ext: "",
      customFilter: initialCustomFilterId,
      aiCategory: "",
    },
    view: "grid",
    gridSize: "m",
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

// eslint-disable-next-line react-refresh/only-export-components
export function normalizeBrowseStoredState(
  value: unknown,
  defaults: BrowseStoredState,
  pinned?: { project?: string; customFilter?: string; searchQuery?: string },
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
  };

  if (pinned?.project) filters.project = pinned.project;
  if (pinned?.customFilter) filters.customFilter = pinned.customFilter;
  const searchQuery =
    pinned?.searchQuery != null
      ? pinned.searchQuery
      : stringOrDefault(state.searchQuery, defaults.searchQuery);

  return {
    filters,
    view: optionOrDefault(state.view, viewModes, defaults.view),
    gridSize: optionOrDefault(state.gridSize, gridSizes, defaults.gridSize),
    searchQuery,
    statusFilter: optionOrDefault(
      state.statusFilter,
      statusFilters,
      defaults.statusFilter,
    ),
    sortMode: optionOrDefault(state.sortMode, sortModes, defaults.sortMode),
  };
}

function readBrowseStoredState(
  defaults: BrowseStoredState,
  pinned?: { project?: string; customFilter?: string; searchQuery?: string },
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

function writeBrowseStoredState(state: BrowseStoredState) {
  try {
    window.localStorage.setItem(
      BROWSE_STATE_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore browser storage failures; filters still work for this session.
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function resetBrowseFiltersForStatusChange(
  projectScopeName = "",
): BrowseFilters {
  return {
    project: projectScopeName,
    ext: "",
    customFilter: "",
    aiCategory: "",
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

function apiStatus(status: StatusFilter) {
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

function apiSort(sort: SortMode) {
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

function browseEmptyCopy(
  statusFilter: StatusFilter,
  stats: Props["stats"] | undefined,
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

// eslint-disable-next-line react-refresh/only-export-components
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

type TreeQueryBase = Omit<CatalogFoldersParams, "scanId" | "folder">;

type TreePanelProps = {
  scanId?: number;
  rootFolders: CatalogFolderNode[];
  rootLoading: boolean;
  queryBase: TreeQueryBase;
  selectedFolder: string;
  expanded: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
  allLabel: string;
  totalCount: number;
};

function TreePanel({
  scanId,
  rootFolders,
  rootLoading,
  queryBase,
  selectedFolder,
  expanded,
  onSelectFolder,
  onToggleExpand,
  allLabel,
  totalCount,
}: TreePanelProps) {
  return (
    <div className="w-[220px] shrink-0 overflow-auto border border-g-line rounded-g-md bg-g-surface scroll-thin">
      <div className="p-2">
        <button
          type="button"
          className="group flex w-full items-center gap-1 min-h-7 rounded-g-md font-g font-normal text-g-ui leading-[1.4] tracking-g-ui text-left text-g-ink-2 transition-[background,color] duration-[120ms] ease-g pl-[calc(8px+var(--tree-depth,0)*14px)] pr-2 py-[5px] hover:bg-g-surface-2 hover:text-g-ink focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[var(--g-active-weight)]"
          data-active={selectedFolder === "" || undefined}
          onClick={() => onSelectFolder("")}
        >
          <FolderOpen size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          <span className="shrink-0 font-g-mono text-[11px] tracking-[-0.015em] text-g-ink-3 tabular-nums group-data-[active=true]:text-current group-data-[active=true]:opacity-70">
            {totalCount}
          </span>
        </button>

        {rootLoading && (
          <div className="flex min-h-7 items-center gap-1 rounded-g-md px-2 py-[5px] font-g-mono text-[12px] text-g-ink-3">
            <span className="grid size-4 place-items-center">
              <LoaderCircle size={12} className="animate-spin" />
            </span>
            {allLabel}
          </div>
        )}

        {rootFolders.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={1}
            scanId={scanId}
            queryBase={queryBase}
            selectedFolder={selectedFolder}
            expanded={expanded}
            onSelectFolder={onSelectFolder}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  scanId,
  queryBase,
  selectedFolder,
  expanded,
  onSelectFolder,
  onToggleExpand,
}: {
  node: CatalogFolderNode;
  depth: number;
  scanId?: number;
  queryBase: TreeQueryBase;
  selectedFolder: string;
  expanded: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedFolder === node.path;
  const hasChildren = node.hasChildren;
  const childrenQuery = useCatalogFoldersQuery(
    scanId,
    { ...queryBase, folder: node.path },
    isExpanded && hasChildren,
  );
  const children = childrenQuery.data?.folders ?? [];

  return (
    <>
      <button
        type="button"
        className="group flex w-full items-center gap-1 min-h-7 rounded-g-md font-g font-normal text-g-ui leading-[1.4] tracking-g-ui text-left text-g-ink-2 transition-[background,color] duration-[120ms] ease-g pl-[calc(8px+var(--tree-depth,0)*14px)] pr-2 py-[5px] hover:bg-g-surface-2 hover:text-g-ink focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[var(--g-active-weight)]"
        data-active={isSelected || undefined}
        style={{ "--tree-depth": depth } as CSSProperties}
        onClick={() => {
          onSelectFolder(node.path);
          if (hasChildren && !isExpanded) onToggleExpand(node.path);
        }}
      >
        {hasChildren ? (
          <span
            className="grid size-4 shrink-0 place-items-center"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.path);
            }}
          >
            {isExpanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
          </span>
        ) : (
          <span className="grid size-4 shrink-0 place-items-center" />
        )}
        {isExpanded ? (
          <FolderOpen size={13} className="shrink-0" />
        ) : (
          <Folder size={13} className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 font-g-mono text-[11px] tracking-[-0.015em] text-g-ink-3 tabular-nums group-data-[active=true]:text-current group-data-[active=true]:opacity-70">
          {node.count}
        </span>
      </button>
      {isExpanded && hasChildren && childrenQuery.isLoading && (
        <div
          className="flex min-h-7 items-center gap-1 rounded-g-md pl-[calc(8px+var(--tree-depth,0)*14px)] pr-2 py-[5px] font-g font-normal text-g-ui tracking-g-ui text-g-ink-3"
          style={{ "--tree-depth": depth + 1 } as CSSProperties}
        >
          <span className="grid size-4 shrink-0 place-items-center">
            <LoaderCircle size={12} className="animate-spin" />
          </span>
          {node.name}
        </div>
      )}
      {isExpanded &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            scanId={scanId}
            queryBase={queryBase}
            selectedFolder={selectedFolder}
            expanded={expanded}
            onSelectFolder={onSelectFolder}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}

export function BrowseView({
  activeAssetId,
  autoScrollAssetId,
  initialCustomFilterId,
  customFilters,
  scanId,
  projectFilterId,
  projectFilterName,
  stats,
  initialSearchQuery,
  initialFocusAssetId,
  imagePreviewEnabled,
  ocrEnabled,
  ocrFuzzySearch,
  onAutoScrollDone,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const [initialBrowseState] = useState(() =>
    readBrowseStoredState(
      defaultBrowseStoredState(projectFilterName, initialCustomFilterId),
      {
        project: projectFilterName || undefined,
        customFilter: initialCustomFilterId || undefined,
        searchQuery: initialSearchQuery || undefined,
      },
    ),
  );
  const [focusAssetId, setFocusAssetId] = useState(initialFocusAssetId);
  const [filters, setFilters] = useState(initialBrowseState.filters);
  const [view, setView] = useState<ViewMode>(initialBrowseState.view);
  const [gridSize, setGridSize] = useState<"s" | "m" | "l">(
    initialBrowseState.gridSize,
  );
  const { mode: bgMode, setMode: setBgMode } = useImageBackgroundControls();
  const [searchQuery, setSearchQuery] = useState(
    initialBrowseState.searchQuery,
  );
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialBrowseState.statusFilter,
  );
  const [sortMode, setSortMode] = useState<SortMode>(
    initialBrowseState.sortMode,
  );
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMoveDir, setShowMoveDir] = useState(false);
  const [showCopyDir, setShowCopyDir] = useState(false);
  const [showRenameRules, setShowRenameRules] = useState(false);
  const [pathsCopied, setPathsCopied] = useState(false);
  const [batchPreview, setBatchPreview] = useState<{
    endpoint: string;
    data: BatchPreviewResponse;
  } | null>(null);

  const batchDeleteMut = useBatchDeleteMutation();
  const batchCopyMut = useBatchCopyMutation();
  const movePreviewMut = useBatchMovePreviewMutation();
  const renamePreviewMut = useBatchRenamePreviewMutation();
  const batchApplyMut = useBatchApplyMutation();

  const settingsQuery = useSettingsQuery();
  const llmConfigured = Boolean(
    settingsQuery.data?.settings.llmProvider &&
    settingsQuery.data?.settings.llmVisionModel,
  );
  const [aiTagProgress, setAITagProgress] = useState<AITagRunCounts | null>(
    null,
  );
  const aiTagMutation = useRunAITagMutation({
    onEvent: (event) => {
      if ("counts" in event && event.counts != null)
        setAITagProgress(event.counts);
    },
  });
  const aiTagRunning = aiTagMutation.isPending;

  const activeSelectedFolder = view === "tree" ? selectedFolder : "";
  const folderQueryBase = useMemo<TreeQueryBase>(
    () => ({
      projectId: projectFilterId || undefined,
      projectName: projectFilterId
        ? undefined
        : projectFilterName || filters.project || undefined,
      ext: filters.ext || undefined,
      q: debouncedSearchQuery.trim() || undefined,
      status: apiStatus(statusFilter) || undefined,
      customFilter: filters.customFilter || undefined,
    }),
    [
      debouncedSearchQuery,
      filters.customFilter,
      filters.ext,
      filters.project,
      projectFilterId,
      projectFilterName,
      statusFilter,
    ],
  );
  const rootFoldersQuery = useCatalogFoldersQuery(
    scanId,
    { ...folderQueryBase, folder: "" },
    view === "tree",
  );
  const catalogItemsParams = useMemo<CatalogItemsParams>(
    () => ({
      assetId: focusAssetId || undefined,
      projectId: projectFilterId || undefined,
      projectName: projectFilterId
        ? undefined
        : projectFilterName || filters.project || undefined,
      ext: filters.ext || undefined,
      q: debouncedSearchQuery.trim() || undefined,
      status: apiStatus(statusFilter) || undefined,
      sort: apiSort(sortMode) || undefined,
      customFilter: filters.customFilter || undefined,
      aiCategory: filters.aiCategory || undefined,
      folder: activeSelectedFolder || undefined,
      limit: 100,
    }),
    [
      activeSelectedFolder,
      debouncedSearchQuery,
      filters.aiCategory,
      filters.customFilter,
      filters.ext,
      filters.project,
      focusAssetId,
      projectFilterId,
      projectFilterName,
      sortMode,
      statusFilter,
    ],
  );
  const catalogItemsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    catalogItemsParams,
  );
  const items = useMemo(
    () => catalogItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogItemsQuery.data],
  );
  const facets = catalogItemsQuery.data?.pages[0]?.facets;

  function clearFocusedAssetQuery() {
    if (focusAssetId) setFocusAssetId("");
  }

  function handleFiltersChange(next: BrowseFilters) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setFilters(next);
  }

  function handleSearchChange(next: string) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setSearchQuery(next);
  }

  function handleStatusFilterChange(next: StatusFilter) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setFilters(resetBrowseFiltersForStatusChange(projectFilterName));
    setStatusFilter(next);
  }

  function handleSortChange(next: SortMode) {
    clearFocusedAssetQuery();
    setSortMode(next);
  }

  useEffect(() => {
    writeBrowseStoredState({
      filters: {
        ...filters,
        project: projectFilterName ? "" : filters.project,
      },
      view,
      gridSize,
      searchQuery: focusAssetId ? "" : searchQuery,
      statusFilter,
      sortMode,
    });
  }, [
    filters,
    gridSize,
    projectFilterName,
    searchQuery,
    focusAssetId,
    sortMode,
    statusFilter,
    view,
  ]);

  useEffect(() => {
    if (!autoScrollAssetId) return undefined;
    const resetId = window.setTimeout(() => {
      setFilters({
        project: projectFilterName,
        ext: "",
        customFilter: "",
        aiCategory: "",
      });
      setSearchQuery(initialSearchQuery);
      setStatusFilter("");
      setSelectedFolder("");
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [autoScrollAssetId, initialSearchQuery, projectFilterName]);

  const { filteredWithoutCustom, emptyOCRTextCount } = useMemo(
    () =>
      applyBrowseFilters({
        items,
        filters,
        searchQuery: debouncedSearchQuery,
        statusFilter,
        customFilters,
        ocrEnabled,
        ocrFuzzySearch,
      }),
    [
      customFilters,
      debouncedSearchQuery,
      filters,
      items,
      ocrEnabled,
      ocrFuzzySearch,
      statusFilter,
    ],
  );

  const projectFacet = useMemo(
    () => ({
      options: facets?.projects,
      total: facets?.projectTotal ?? items.length,
    }),
    [facets?.projectTotal, facets?.projects, items.length],
  );
  const extensionFacet = useMemo(
    () => ({
      options: facets?.extensions,
      total: facets?.extensionTotal ?? items.length,
    }),
    [facets?.extensionTotal, facets?.extensions, items.length],
  );

  const customFilterFacet = useMemo(
    () => facets?.customFilters ?? [],
    [facets?.customFilters],
  );

  const aiCategoryFacet = useMemo(
    () => ({
      options: facets?.aiCategories,
      total: facets?.aiCategoryTotal,
    }),
    [facets?.aiCategories, facets?.aiCategoryTotal],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBulkMode = useCallback(() => {
    setBulkMode((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
  }, []);

  const selectedBytes = useMemo(
    () =>
      items
        .filter((i) => selected.has(i.id))
        .reduce((sum, i) => sum + i.bytes, 0),
    [items, selected],
  );

  function handleBatchDelete() {
    const ids = Array.from(selected);
    batchDeleteMut.mutate(ids, {
      onSuccess: () => {
        setSelected(new Set());
        setBulkMode(false);
        setShowDeleteConfirm(false);
      },
      onError: () => {
        setShowDeleteConfirm(false);
      },
    });
  }

  function handleCopySelect(targetDir: string) {
    setShowCopyDir(false);
    batchCopyMut.mutate(
      { assetIds: Array.from(selected), targetDir },
      {
        onSuccess: () => {
          setSelected(new Set());
          setBulkMode(false);
        },
      },
    );
  }

  function handleMoveSelect(targetDir: string) {
    setShowMoveDir(false);
    movePreviewMut.mutate(
      { assetIds: Array.from(selected), targetDir },
      {
        onSuccess: (data) => {
          setBatchPreview({ endpoint: "/api/actions/batch/move/apply", data });
        },
      },
    );
  }

  function handleRenameConfirm(rules: RenameRules) {
    setShowRenameRules(false);
    renamePreviewMut.mutate(
      { assetIds: Array.from(selected), rules },
      {
        onSuccess: (data) => {
          setBatchPreview({
            endpoint: "/api/actions/batch/rename/apply",
            data,
          });
        },
      },
    );
  }

  function handleBatchApply() {
    if (!batchPreview) return;
    batchApplyMut.mutate(
      { endpoint: batchPreview.endpoint, token: batchPreview.data.token },
      {
        onSuccess: () => {
          setBatchPreview(null);
          setSelected(new Set());
          setBulkMode(false);
        },
      },
    );
  }

  useEffect(() => {
    if (!pathsCopied) return;
    const timer = window.setTimeout(() => setPathsCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [pathsCopied]);

  function copyPaths() {
    const paths = items
      .filter((i) => selected.has(i.id))
      .map((i) => i.repoPath);
    navigator.clipboard?.writeText(paths.join("\n"));
    setPathsCopied(true);
  }

  function handleToggleExpand(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const pending =
    catalogItemsQuery.isFetching && !catalogItemsQuery.isFetchingNextPage;
  const showInitialLoading =
    catalogItemsQuery.isLoading || (pending && items.length === 0);
  const emptyCopy = browseEmptyCopy(statusFilter, stats, t);

  return (
    <>
      <FilterRail
        items={items}
        filters={filters}
        projectOptions={projectFacet.options}
        projectTotal={projectFacet.total}
        projectScopeName={projectFilterName}
        extensionOptions={extensionFacet.options}
        extensionTotal={extensionFacet.total}
        customFilterOptions={customFilterFacet}
        customFilterTotal={
          facets?.customFilterTotal ?? filteredWithoutCustom.length
        }
        aiCategoryOptions={aiCategoryFacet.options}
        aiCategoryTotal={aiCategoryFacet.total}
        ocrEnabled={ocrEnabled}
        onFiltersChange={handleFiltersChange}
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0">
        <div className="max-w-none p-0 flex h-full flex-col">
          <BrowseToolbar
            view={view}
            gridSize={gridSize}
            bgMode={bgMode}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            sortMode={sortMode}
            bulkMode={bulkMode}
            onViewChange={setView}
            onGridSizeChange={setGridSize}
            onBgModeChange={setBgMode}
            onSearchChange={handleSearchChange}
            onStatusFilterChange={handleStatusFilterChange}
            onSortChange={handleSortChange}
            onBulkToggle={toggleBulkMode}
          />

          {llmConfigured && (
            <div className="flex items-center gap-2 py-1">
              <Tooltip
                label={
                  aiTagRunning ? t("browse.aiTagRunning") : t("browse.runAITag")
                }
              >
                <Button
                  variant="secondary"
                  size="md"
                  leadingIcon={<BrainCircuit size={14} />}
                  disabled={aiTagRunning}
                  onClick={() => {
                    setAITagProgress(null);
                    aiTagMutation.mutate(undefined);
                  }}
                >
                  {aiTagRunning && aiTagProgress
                    ? t("browse.aiTagProgress", {
                        processed: aiTagProgress.processed,
                        queued: aiTagProgress.queued,
                        ready: aiTagProgress.ready,
                        failed: aiTagProgress.failed,
                        skipped: aiTagProgress.skipped,
                        cacheHit: aiTagProgress.cacheHit,
                      })
                    : t("browse.runAITag")}
                </Button>
              </Tooltip>
            </div>
          )}

          {bulkMode && selected.size > 0 && (
            <div className="sticky top-0 z-[5] mb-2 flex w-full min-h-[44px] items-center gap-0.5 rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
              <span className="inline-flex min-h-[34px] items-center px-2.5 font-g-mono text-g-body text-g-ink-2">
                {t("selection.summary", {
                  count: selected.size,
                  size: formatBytes(selectedBytes),
                })}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={copyPaths}
              >
                {pathsCopied ? <Check size={14} /> : <Copy size={14} />}
                {pathsCopied ? t("toast.copied") : t("action.copyPaths")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={() => setShowCopyDir(true)}
              >
                <FolderOutput size={14} />
                {t("action.batchCopy")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={() => setShowMoveDir(true)}
              >
                <FolderInput size={14} />
                {t("action.batchMove")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={() => setShowRenameRules(true)}
              >
                <PenLine size={14} />
                {t("action.batchRename")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={() => batchExport(Array.from(selected))}
              >
                <Download size={14} />
                {t("action.batchExport")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[calc(var(--g-r-md)-2px)] px-2.5 font-[510] text-g-body text-g-ink-2 transition-[background,color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink hover:shadow-g-sm focus-visible:shadow-g-focus"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={14} />
                {t("action.deleteSelected")}
              </button>
            </div>
          )}

          {showInitialLoading ? (
            <div className="mt-1 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {Array.from({ length: 18 }).map((_, index) => (
                <div
                  key={index}
                  className="min-h-[188px] rounded-g-md border border-g-line bg-g-surface shadow-g-sm"
                >
                  <div className="aspect-square animate-pulse rounded-t-g-md bg-g-surface-2" />
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-3/4 animate-pulse rounded-full bg-g-surface-2" />
                    <div className="h-3 w-1/2 animate-pulse rounded-full bg-g-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={emptyCopy.title}
              description={
                searchQuery.trim() && emptyOCRTextCount > 0
                  ? t("browse.emptyOCRTextHint", {
                      count: emptyOCRTextCount,
                    })
                  : emptyCopy.description
              }
              tone="neutral"
            />
          ) : view === "tree" ? (
            <div className="mt-1 flex min-h-0 flex-1 gap-4">
              <TreePanel
                scanId={scanId}
                rootFolders={rootFoldersQuery.data?.folders ?? []}
                rootLoading={rootFoldersQuery.isLoading}
                queryBase={folderQueryBase}
                selectedFolder={activeSelectedFolder}
                expanded={expandedFolders}
                onSelectFolder={setSelectedFolder}
                onToggleExpand={handleToggleExpand}
                allLabel={t("browse.allFolders")}
                totalCount={rootFoldersQuery.data?.total ?? items.length}
              />
              <div className="min-h-0 min-w-0 flex-1">
                <BrowseGrid
                  items={items}
                  gridSize={gridSize}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  ocrEnabled={ocrEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                />
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              {view === "list" ? (
                <BrowseList
                  items={items}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  ocrEnabled={ocrEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                  hasMore={catalogItemsQuery.hasNextPage}
                  loadingMore={catalogItemsQuery.isFetchingNextPage}
                  onLoadMore={() => {
                    void catalogItemsQuery.fetchNextPage();
                  }}
                />
              ) : (
                <BrowseGrid
                  items={items}
                  gridSize={gridSize}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  ocrEnabled={ocrEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                  hasMore={catalogItemsQuery.hasNextPage}
                  loadingMore={catalogItemsQuery.isFetchingNextPage}
                  onLoadMore={() => {
                    void catalogItemsQuery.fetchNextPage();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {showDeleteConfirm && (
        <BatchConfirmModal
          count={selected.size}
          sizeLabel={formatBytes(selectedBytes)}
          working={batchDeleteMut.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleBatchDelete}
        />
      )}

      {showMoveDir && (
        <DirectoryPickerModal
          open={showMoveDir}
          mode="move"
          working={movePreviewMut.isPending}
          onClose={() => setShowMoveDir(false)}
          onSelect={handleMoveSelect}
        />
      )}

      {showCopyDir && (
        <DirectoryPickerModal
          open={showCopyDir}
          mode="copy"
          working={batchCopyMut.isPending}
          onClose={() => setShowCopyDir(false)}
          onSelect={handleCopySelect}
        />
      )}

      {showRenameRules && (
        <RenameRuleModal
          filePaths={items
            .filter((i) => selected.has(i.id))
            .map((i) => i.repoPath)}
          onCancel={() => setShowRenameRules(false)}
          onConfirm={handleRenameConfirm}
        />
      )}

      {batchPreview && (
        <BatchPreviewModal
          title={
            batchPreview.endpoint.includes("move")
              ? t("action.batchMove")
              : t("action.batchRename")
          }
          moves={batchPreview.data.preview.moves}
          changes={batchPreview.data.preview.changes}
          blockers={batchPreview.data.preview.blockers}
          canApply={batchPreview.data.preview.canApply}
          working={batchApplyMut.isPending}
          onCancel={() => setBatchPreview(null)}
          onApply={handleBatchApply}
        />
      )}
    </>
  );
}

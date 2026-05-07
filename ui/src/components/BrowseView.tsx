import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  PenLine,
  Trash2,
} from "lucide-react";
import {
  customFilterOptions,
  matchesCustomAssetFilter,
} from "../customAssetFilters";
import {
  useBatchDeleteMutation,
  useBatchMovePreviewMutation,
  useBatchRenamePreviewMutation,
  useBatchApplyMutation,
} from "../queries";
import type { RenameRules } from "../types";
import { batchExport, type BatchPreviewResponse } from "../api";
import { BatchConfirmModal } from "./BatchConfirmModal";
import { BatchPreviewModal } from "./BatchPreviewModal";
import { RenameRuleModal } from "./RenameRuleModal";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import { matchesOCRSearchText } from "../ocrSearch";
import type { AssetItem, CustomAssetFilter } from "../types";
import { fileName, formatBytes } from "../ui";
import { BrowseGrid } from "./BrowseGrid";
import { BrowseList } from "./BrowseList";
import { BrowseToolbar, type SortMode, type ViewMode } from "./BrowseToolbar";
import { FilterRail } from "./FilterRail";
import { facetOptions, projectFacetIds } from "./browseFacets";
import { EmptyState } from "./ui";

type StatusFilter = "" | "unused" | "duplicate" | "optimize" | "referenced";
type BrowseFilters = { project: string; ext: string; customFilter: string };
type BrowseStoredState = {
  filters: BrowseFilters;
  view: ViewMode;
  gridSize: "s" | "m" | "l";
  bgMode: "checker" | "light" | "dark";
  searchQuery: string;
  statusFilter: StatusFilter;
  sortMode: SortMode;
};

const BROWSE_STATE_STORAGE_KEY = "asset-studio-browse-state";
const viewModes: ViewMode[] = ["grid", "list", "tree"];
const gridSizes: BrowseStoredState["gridSize"][] = ["s", "m", "l"];
const bgModes: BrowseStoredState["bgMode"][] = ["checker", "light", "dark"];
const statusFilters: StatusFilter[] = [
  "",
  "unused",
  "duplicate",
  "optimize",
  "referenced",
];
const sortModes: SortMode[] = ["name", "size", "recent"];

type Props = {
  items: AssetItem[];
  activeAssetId: string;
  autoScrollAssetId: string;
  initialCustomFilterId: string;
  customFilters: CustomAssetFilter[];
  projectNames: string[];
  projectFilterName: string;
  imagePreviewEnabled: boolean;
  onAutoScrollDone: () => void;
  onOpenAsset: (id: string) => void;
};

function defaultBrowseStoredState(
  projectFilterName: string,
  initialCustomFilterId: string,
): BrowseStoredState {
  return {
    filters: {
      project: projectFilterName,
      ext: "",
      customFilter: initialCustomFilterId,
    },
    view: "grid",
    gridSize: "m",
    bgMode: "checker",
    searchQuery: "",
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
  pinned?: { project?: string; customFilter?: string },
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
  };

  if (pinned?.project) filters.project = pinned.project;
  if (pinned?.customFilter) filters.customFilter = pinned.customFilter;

  return {
    filters,
    view: optionOrDefault(state.view, viewModes, defaults.view),
    gridSize: optionOrDefault(state.gridSize, gridSizes, defaults.gridSize),
    bgMode: optionOrDefault(state.bgMode, bgModes, defaults.bgMode),
    searchQuery: stringOrDefault(state.searchQuery, defaults.searchQuery),
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
  pinned?: { project?: string; customFilter?: string },
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

function matchesStatus(item: AssetItem, status: StatusFilter): boolean {
  switch (status) {
    case "unused":
      return item.usedBy.length === 0;
    case "duplicate":
      return item.duplicates.length > 0 || item.similar.length > 0;
    case "optimize":
      return item.optimizationRecommendations.length > 0;
    case "referenced":
      return item.usedBy.length > 0;
    default:
      return true;
  }
}

function hasEmptyOCRText(item: AssetItem): boolean {
  return Boolean(
    item.ocr?.status === "ready" &&
    (item.ocr.emptyText ||
      (!(item.ocr.normalizedText ?? item.ocr.text ?? "").trim() &&
        item.ocr.textStatus === "empty")),
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function applyBrowseFilters({
  items,
  filters,
  searchQuery,
  statusFilter,
  customFilters,
}: {
  items: AssetItem[];
  filters: BrowseFilters;
  searchQuery: string;
  statusFilter: StatusFilter;
  customFilters: CustomAssetFilter[];
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
      !matchesOCRSearchText(ocrText, q)
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
    return hasEmptyOCRText(item);
  }).length;
  return { facetBaseItems, filteredWithoutCustom, filtered, emptyOCRTextCount };
}

type FolderNode = {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
};

function buildFolderTree(items: AssetItem[]): FolderNode {
  const root: FolderNode = {
    name: "",
    path: "",
    count: items.length,
    children: [],
  };
  const map = new Map<string, FolderNode>();
  map.set("", root);

  for (const item of items) {
    const parts = item.repoPath.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const parent = current;
      current = current ? `${current}/${parts[i]}` : parts[i];
      if (!map.has(current)) {
        const node: FolderNode = {
          name: parts[i],
          path: current,
          count: 0,
          children: [],
        };
        map.set(current, node);
        map.get(parent)!.children.push(node);
      }
    }
  }

  for (const item of items) {
    const parts = item.repoPath.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      const node = map.get(current);
      if (node) node.count++;
    }
  }

  function sortChildren(node: FolderNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) sortChildren(child);
  }
  sortChildren(root);

  return root;
}

type TreePanelProps = {
  root: FolderNode;
  selectedFolder: string;
  expanded: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
  allLabel: string;
  totalCount: number;
};

function TreePanel({
  root,
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
          className="flex w-full items-center gap-1 min-h-7 rounded-g-md font-g-mono text-[12px] leading-[1.4] text-left text-g-ink-2 transition-[background,color] duration-[120ms] ease-g pl-[calc(8px+var(--tree-depth,0)*14px)] pr-2 py-[5px] hover:bg-g-surface-2 hover:text-g-ink focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[var(--g-active-weight)]"
          data-active={selectedFolder === "" || undefined}
          onClick={() => onSelectFolder("")}
        >
          <FolderOpen size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          <span className="shrink-0 font-g-mono text-[11px] tracking-[-0.015em] text-g-ink-3 tabular-nums">
            {totalCount}
          </span>
        </button>

        {root.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={1}
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
  selectedFolder,
  expanded,
  onSelectFolder,
  onToggleExpand,
}: {
  node: FolderNode;
  depth: number;
  selectedFolder: string;
  expanded: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedFolder === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-1 min-h-7 rounded-g-md font-g-mono text-[12px] leading-[1.4] text-left text-g-ink-2 transition-[background,color] duration-[120ms] ease-g pl-[calc(8px+var(--tree-depth,0)*14px)] pr-2 py-[5px] hover:bg-g-surface-2 hover:text-g-ink focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[var(--g-active-weight)]"
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
        <span className="shrink-0 text-[10px] opacity-60">{node.count}</span>
      </button>
      {isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFolder={selectedFolder}
            expanded={expanded}
            onSelectFolder={onSelectFolder}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}

function sortItems(items: AssetItem[], mode: SortMode): AssetItem[] {
  const sorted = [...items];
  switch (mode) {
    case "name":
      sorted.sort((a, b) =>
        fileName(a.repoPath).localeCompare(fileName(b.repoPath)),
      );
      break;
    case "size":
      sorted.sort((a, b) => b.bytes - a.bytes);
      break;
    case "recent":
      break;
  }
  return sorted;
}

function treeHasPath(node: FolderNode, path: string): boolean {
  if (node.path === path) return true;
  return node.children.some((child) => treeHasPath(child, path));
}

export function BrowseView({
  items,
  activeAssetId,
  autoScrollAssetId,
  initialCustomFilterId,
  customFilters,
  projectNames,
  projectFilterName,
  imagePreviewEnabled,
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
      },
    ),
  );
  const [filters, setFilters] = useState(initialBrowseState.filters);
  const [view, setView] = useState<ViewMode>(initialBrowseState.view);
  const [gridSize, setGridSize] = useState<"s" | "m" | "l">(
    initialBrowseState.gridSize,
  );
  const [bgMode, setBgMode] = useState<"checker" | "light" | "dark">(
    initialBrowseState.bgMode,
  );
  const [searchQuery, setSearchQuery] = useState(
    initialBrowseState.searchQuery,
  );
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
  const [showRenameRules, setShowRenameRules] = useState(false);
  const [batchPreview, setBatchPreview] = useState<{
    endpoint: string;
    data: BatchPreviewResponse;
  } | null>(null);

  const batchDeleteMut = useBatchDeleteMutation();
  const movePreviewMut = useBatchMovePreviewMutation();
  const renamePreviewMut = useBatchRenamePreviewMutation();
  const batchApplyMut = useBatchApplyMutation();

  useEffect(() => {
    writeBrowseStoredState({
      filters: {
        ...filters,
        project: projectFilterName ? "" : filters.project,
      },
      view,
      gridSize,
      bgMode,
      searchQuery,
      statusFilter,
      sortMode,
    });
  }, [
    bgMode,
    filters,
    gridSize,
    projectFilterName,
    searchQuery,
    sortMode,
    statusFilter,
    view,
  ]);

  useEffect(() => {
    if (!autoScrollAssetId) return undefined;
    const resetId = window.setTimeout(() => {
      setFilters({ project: projectFilterName, ext: "", customFilter: "" });
      setSearchQuery("");
      setStatusFilter("");
      setSelectedFolder("");
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [autoScrollAssetId, projectFilterName]);

  const allProjects = useMemo(
    () => projectFacetIds({ items, projectNames, projectFilterName }),
    [items, projectFilterName, projectNames],
  );
  const allExtensions = useMemo(
    () => Array.from(new Set(items.map((i) => i.ext))).sort(),
    [items],
  );

  const { facetBaseItems, filteredWithoutCustom, filtered, emptyOCRTextCount } =
    useMemo(
      () =>
        applyBrowseFilters({
          items,
          filters,
          searchQuery,
          statusFilter,
          customFilters,
        }),
      [customFilters, filters, items, searchQuery, statusFilter],
    );

  const projectFacet = useMemo(
    () =>
      facetOptions(
        allProjects,
        facetBaseItems.filter((i) => !filters.ext || i.ext === filters.ext),
        "projectName",
      ),
    [allProjects, facetBaseItems, filters.ext],
  );
  const extensionFacet = useMemo(
    () =>
      facetOptions(
        allExtensions,
        facetBaseItems.filter(
          (i) => !filters.project || i.projectName === filters.project,
        ),
        "ext",
      ),
    [allExtensions, facetBaseItems, filters.project],
  );

  const customFilterFacet = useMemo(
    () => customFilterOptions(customFilters, filteredWithoutCustom),
    [customFilters, filteredWithoutCustom],
  );

  const folderTree = useMemo(() => buildFolderTree(filtered), [filtered]);
  const activeSelectedFolder = useMemo(() => {
    return selectedFolder && treeHasPath(folderTree, selectedFolder)
      ? selectedFolder
      : "";
  }, [folderTree, selectedFolder]);

  const folderFiltered = useMemo(() => {
    if (view !== "tree" || !activeSelectedFolder) return filtered;
    return filtered.filter((i) => {
      const dir = i.repoPath.substring(0, i.repoPath.lastIndexOf("/"));
      return (
        dir === activeSelectedFolder ||
        dir.startsWith(activeSelectedFolder + "/")
      );
    });
  }, [activeSelectedFolder, filtered, view]);

  const sorted = useMemo(
    () => sortItems(folderFiltered, sortMode),
    [folderFiltered, sortMode],
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

  function copyPaths() {
    const paths = items
      .filter((i) => selected.has(i.id))
      .map((i) => i.repoPath);
    navigator.clipboard?.writeText(paths.join("\n"));
  }

  function handleToggleExpand(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

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
        customFilterTotal={filteredWithoutCustom.length}
        onFiltersChange={setFilters}
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
            onSearchChange={setSearchQuery}
            onStatusFilterChange={setStatusFilter}
            onSortChange={setSortMode}
            onBulkToggle={toggleBulkMode}
          />

          {bulkMode && selected.size > 0 && (
            <div className="sticky top-0 z-[5] mb-4 flex min-h-[44px] items-center gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-[13px] text-g-ink shadow-g-md animate-[slideUp2_200ms_var(--g-ease-out)]">
              <span className="font-g-mono text-[13px] font-[510]">
                {t("selection.summary", {
                  count: selected.size,
                  size: formatBytes(selectedBytes),
                })}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 text-[12px] font-[510] text-g-ink hover:bg-g-surface-3"
                onClick={copyPaths}
              >
                <Copy size={12} />
                {t("action.copyPaths")}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 text-[12px] font-[510] text-g-ink hover:bg-g-surface-3"
                onClick={() => setShowMoveDir(true)}
              >
                <FolderInput size={12} />
                {t("action.batchMove")}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 text-[12px] font-[510] text-g-ink hover:bg-g-surface-3"
                onClick={() => setShowRenameRules(true)}
              >
                <PenLine size={12} />
                {t("action.batchRename")}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 text-[12px] font-[510] text-g-ink hover:bg-g-surface-3"
                onClick={() => batchExport(Array.from(selected))}
              >
                <Download size={12} />
                {t("action.batchExport")}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-g-md border border-g-line bg-g-surface-2 px-2.5 text-[12px] font-[510] text-g-ink hover:bg-g-surface-3"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={12} />
                {t("action.deleteSelected")}
              </button>
            </div>
          )}

          {sorted.length === 0 ? (
            <EmptyState
              title={t("browse.empty")}
              description={
                searchQuery.trim() && emptyOCRTextCount > 0
                  ? t("browse.emptyOCRTextHint", {
                      count: emptyOCRTextCount,
                    })
                  : undefined
              }
              tone={
                searchQuery.trim() && emptyOCRTextCount > 0
                  ? "warning"
                  : "neutral"
              }
            />
          ) : view === "tree" ? (
            <div className="mt-1 flex min-h-0 flex-1 gap-4">
              <TreePanel
                root={folderTree}
                selectedFolder={activeSelectedFolder}
                expanded={expandedFolders}
                onSelectFolder={setSelectedFolder}
                onToggleExpand={handleToggleExpand}
                allLabel={t("browse.allFolders")}
                totalCount={filtered.length}
              />
              <div className="min-h-0 min-w-0 flex-1">
                <BrowseGrid
                  items={sorted}
                  gridSize={gridSize}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                />
              </div>
            </div>
          ) : (
            <div className="mt-1 min-h-0 flex-1">
              {view === "list" ? (
                <BrowseList
                  items={sorted}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                />
              ) : (
                <BrowseGrid
                  items={sorted}
                  gridSize={gridSize}
                  bgMode={bgMode}
                  bulkMode={bulkMode}
                  selected={selected}
                  activeAssetId={activeAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
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
          working={movePreviewMut.isPending}
          onClose={() => setShowMoveDir(false)}
          onSelect={handleMoveSelect}
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

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
  Folder,
  FolderOpen,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  customFilterOptions,
  matchesCustomAssetFilter,
} from "../customAssetFilters";
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
    if (!matchesStatus(item, statusFilter)) return false;
    if (
      q &&
      !fileName(item.repoPath).toLowerCase().includes(q) &&
      !item.repoPath.toLowerCase().includes(q)
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
  return { facetBaseItems, filteredWithoutCustom, filtered };
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
  const [filters, setFilters] = useState(() => ({
    project: projectFilterName,
    ext: "",
    customFilter: initialCustomFilterId,
  }));
  const [view, setView] = useState<ViewMode>("grid");
  const [gridSize, setGridSize] = useState<"s" | "m" | "l">("m");
  const [bgMode, setBgMode] = useState<"checker" | "light" | "dark">("checker");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

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

  const { facetBaseItems, filteredWithoutCustom, filtered } = useMemo(
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

  function copyPaths() {
    const paths = items
      .filter((i) => selected.has(i.id))
      .map((i) => i.repoPath);
    navigator.clipboard?.writeText(paths.join("\n"));
  }

  function copyAsRm() {
    const cmds = items
      .filter((i) => selected.has(i.id))
      .map((i) => `git rm "${i.repoPath}"`);
    navigator.clipboard?.writeText(cmds.join("\n"));
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-2 pt-1">
        <div className="max-w-none p-0 flex h-full flex-col">
          <BrowseToolbar
            view={view}
            gridSize={gridSize}
            bgMode={bgMode}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            itemCount={sorted.length}
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
            <div className="bulkbar">
              <span className="font-g-mono text-[13px] font-[510]">
                {t("selection.summary", {
                  count: selected.size,
                  size: formatBytes(selectedBytes),
                })}
              </span>
              <span className="flex-1" />
              <button type="button" className="bulkbar-btn" onClick={copyPaths}>
                <Copy size={12} />
                {t("action.copyPaths")}
              </button>
              <button type="button" className="bulkbar-btn" onClick={copyAsRm}>
                <Terminal size={12} />
                {t("action.copyGitRm")}
              </button>
              <button
                type="button"
                className="bulkbar-btn bulkbar-btn-danger"
                onClick={() => {
                  /* delete action placeholder */
                }}
              >
                <Trash2 size={12} />
                {t("action.deleteSelected")}
              </button>
            </div>
          )}

          {sorted.length === 0 ? (
            <EmptyState title={t("browse.empty")} />
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
    </>
  );
}

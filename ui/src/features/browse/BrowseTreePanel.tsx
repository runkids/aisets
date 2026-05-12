import type { CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import type { CatalogFoldersParams } from "@/api";
import { useCatalogFoldersQuery } from "@/queries";
import type { CatalogFolderNode } from "@/types";

export type TreeQueryBase = Omit<CatalogFoldersParams, "scanId" | "folder">;

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

export function BrowseTreePanel({
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

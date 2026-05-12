import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Download,
  FolderInput,
  FolderOutput,
  Images,
  PenLine,
  ScanText,
  Star,
  StarOff,
  Tags,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { errorMessage } from "@/i18n";
import {
  useBatchDeleteMutation,
  useBatchCopyMutation,
  useBatchMovePreviewMutation,
  useBatchRenamePreviewMutation,
  useBatchApplyMutation,
  useCatalogFoldersQuery,
  useCatalogItemsInfiniteQuery,
  useFavoriteAssetMutation,
  useFavoriteAssetsMutation,
  useSettingsQuery,
} from "@/queries";
import {
  batchExport,
  embeddingStats,
  semanticSearch,
  type BatchPreviewResponse,
  type CatalogItemsParams,
} from "@/api";
import { BatchConfirmModal } from "@/components/shared/BatchConfirmModal";
import { BatchPreviewModal } from "@/components/shared/BatchPreviewModal";
import { RenameRuleModal } from "@/components/shared/RenameRuleModal";
import { DirectoryPickerModal } from "@/components/project/DirectoryPickerModal";
import type { AssetItem, CustomAssetFilter, RenameRules } from "@/types";
import { useDebouncedValue } from "@/useDebouncedValue";
import { formatBytes } from "@/ui";
import { BrowseGrid } from "./BrowseGrid";
import { BrowseList } from "./BrowseList";
import {
  BrowseToolbar,
  type SearchMode,
  type SortMode,
  type ViewMode,
} from "./BrowseToolbar";
import { useImageBackgroundControls } from "@/imageBackground";
import { FilterRail } from "@/components/shared/FilterRail";
import { useToast } from "@/components/shared/ToastProvider";
import {
  SemanticSearchLoadingPanel,
  type SemanticLoadingStyle,
} from "@/features/semantic-search";
import { EmptyState, IconButton, Tooltip } from "@/components/ui";
import { BrowseTreePanel, type TreeQueryBase } from "./BrowseTreePanel";
import {
  apiSort,
  apiStatus,
  applyBrowseFilters,
  browseEmptyCopy,
  defaultBrowseStoredState,
  readBrowseStoredState,
  resetBrowseFiltersForStatusChange,
  writeBrowseStoredState,
  type BrowseFilters,
  type BrowseStats,
  type StatusFilter,
} from "./browseState";

type BulkActionButtonProps = {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

function BulkActionButton({
  label,
  icon,
  disabled,
  onClick,
}: BulkActionButtonProps) {
  return (
    <Tooltip label={label} placement="top">
      <span className="inline-flex shrink-0">
        <IconButton
          size="md"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="rounded-[calc(var(--g-r-md)-2px)]"
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

type Props = {
  activeAssetId: string;
  autoScrollAssetId: string;
  initialCustomFilterId: string;
  customFilters: CustomAssetFilter[];
  scanId?: number;
  projectFilterId?: string;
  projectFilterName: string;
  stats?: BrowseStats;
  initialSearchQuery: string;
  initialSearchMode: SearchMode;
  initialAICategory: string;
  initialFocusAssetId: string;
  imagePreviewEnabled: boolean;
  imagePreviewDelayMs: number;
  imagePreviewSize: { width: number; height: number };
  ocrEnabled: boolean;
  ocrFuzzySearch: boolean;
  onAutoScrollDone: () => void;
  onClearFocusAsset: () => void;
  onClearSearchRoute: () => void;
  onOpenAsset: (id: string) => void;
  aiEnabled?: boolean;
  aiBusy?: boolean;
  onStartAITag?: (assetIds: string[]) => void;
  onStartVLMOcr?: (assetIds: string[]) => void;
  onAddToImageTools?: (assetIds: string[], target?: HTMLElement | null) => void;
};

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
  initialSearchMode,
  initialAICategory,
  initialFocusAssetId,
  imagePreviewEnabled,
  imagePreviewDelayMs,
  imagePreviewSize,
  ocrEnabled,
  ocrFuzzySearch,
  onAutoScrollDone,
  onClearFocusAsset,
  onClearSearchRoute,
  onOpenAsset,
  aiEnabled,
  aiBusy,
  onStartAITag,
  onStartVLMOcr,
  onAddToImageTools,
}: Props) {
  const { t } = useTranslation();
  const [initialBrowseState] = useState(() =>
    readBrowseStoredState(
      defaultBrowseStoredState(
        projectFilterName,
        initialCustomFilterId,
        initialSearchQuery,
        initialAICategory,
      ),
      {
        project: projectFilterName || undefined,
        customFilter: initialCustomFilterId || undefined,
        searchQuery: initialSearchQuery || undefined,
        aiCategory: initialAICategory || undefined,
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
  const [searchMode, setSearchMode] = useState<SearchMode>(
    initialSearchMode || initialBrowseState.searchMode,
  );
  const [committedSemanticQuery, setCommittedSemanticQuery] = useState(
    initialSearchMode === "semantic" ? initialBrowseState.searchQuery : "",
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
  const favoriteMut = useFavoriteAssetMutation();
  const favoritesMut = useFavoriteAssetsMutation();
  const toast = useToast();

  const settingsQuery = useSettingsQuery();

  const activeSelectedFolder = view === "tree" ? selectedFolder : "";
  const folderQueryBase = useMemo<TreeQueryBase>(
    () => ({
      projectId: projectFilterId || undefined,
      projectName: projectFilterId
        ? undefined
        : projectFilterName || filters.project || undefined,
      ext: filters.ext || undefined,
      q:
        searchMode === "semantic"
          ? undefined
          : debouncedSearchQuery.trim() || undefined,
      status: apiStatus(statusFilter) || undefined,
      customFilter: filters.customFilter || undefined,
      favorite: filters.favorite || undefined,
    }),
    [
      debouncedSearchQuery,
      filters.customFilter,
      filters.ext,
      filters.favorite,
      filters.project,
      projectFilterId,
      projectFilterName,
      searchMode,
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
      q:
        searchMode === "semantic"
          ? undefined
          : debouncedSearchQuery.trim() || undefined,
      status: apiStatus(statusFilter) || undefined,
      sort: apiSort(sortMode) || undefined,
      customFilter: filters.customFilter || undefined,
      aiCategory: filters.aiCategory || undefined,
      aiOcrStatus: filters.aiOcrStatus || undefined,
      hasGPS: filters.hasGPS || undefined,
      favorite: filters.favorite || undefined,
      folder: activeSelectedFolder || undefined,
      limit: 100,
    }),
    [
      activeSelectedFolder,
      debouncedSearchQuery,
      filters.aiCategory,
      filters.aiOcrStatus,
      filters.customFilter,
      filters.ext,
      filters.favorite,
      filters.hasGPS,
      filters.project,
      focusAssetId,
      projectFilterId,
      projectFilterName,
      searchMode,
      sortMode,
      statusFilter,
    ],
  );
  const catalogItemsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    catalogItemsParams,
  );
  const catalogItems = useMemo(
    () => catalogItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogItemsQuery.data],
  );
  const semanticFilterParams = useMemo<CatalogItemsParams>(
    () => ({
      scanId,
      projectId: projectFilterId || undefined,
      projectName: projectFilterId
        ? undefined
        : projectFilterName || filters.project || undefined,
      ext: filters.ext || undefined,
      status: apiStatus(statusFilter) || undefined,
      customFilter: filters.customFilter || undefined,
      aiCategory: filters.aiCategory || undefined,
      aiOcrStatus: filters.aiOcrStatus || undefined,
      hasGPS: filters.hasGPS || undefined,
      folder: activeSelectedFolder || undefined,
    }),
    [
      activeSelectedFolder,
      filters.aiCategory,
      filters.aiOcrStatus,
      filters.customFilter,
      filters.ext,
      filters.hasGPS,
      filters.project,
      projectFilterId,
      projectFilterName,
      scanId,
      statusFilter,
    ],
  );
  const semanticSearchType: "text" | "image" | "hybrid" =
    settingsQuery.data?.settings.embedSearchType === "text" ||
    settingsQuery.data?.settings.embedSearchType === "image" ||
    settingsQuery.data?.settings.embedSearchType === "hybrid"
      ? settingsQuery.data.settings.embedSearchType
      : "hybrid";
  const embedConfigured = Boolean(
    settingsQuery.data?.settings.llmEnabled &&
    settingsQuery.data?.settings.llmEmbedModel,
  );
  const embedStatsQuery = useQuery({
    queryKey: ["embed-stats"],
    queryFn: embeddingStats,
    enabled: embedConfigured,
    staleTime: 10_000,
  });
  const semanticAvailable =
    (embedStatsQuery.data?.textCount ?? 0) > 0 ||
    (embedStatsQuery.data?.imageCount ?? 0) > 0;
  const semanticLoadingStyle = useMemo<SemanticLoadingStyle>(() => {
    const styles = ["beam", "constellation", "swarm"] as const;
    const seed = committedSemanticQuery
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return styles[seed % styles.length];
  }, [committedSemanticQuery]);
  const semanticModelName =
    embedStatsQuery.data?.modelName ||
    settingsQuery.data?.settings.llmEmbedModel ||
    t("commandPalette.embedModelUnknown");
  const semanticDimensions = embedStatsQuery.data?.dimensions ?? 0;
  const semanticDimensionsLabel =
    semanticDimensions > 0
      ? `${semanticDimensions}d`
      : t("commandPalette.embeddingDimensionsUnknown");
  const semanticDimensionToken =
    semanticDimensions > 0
      ? `${semanticDimensions}-D`
      : t("commandPalette.embeddingSpace");

  const semanticQuery = useQuery({
    queryKey: [
      "browse-semantic-search",
      committedSemanticQuery,
      semanticSearchType,
      settingsQuery.data?.settings.embedSearchLimit ?? 20,
      settingsQuery.data?.settings.embedSearchThreshold ?? 0.5,
      semanticFilterParams,
    ],
    queryFn: () =>
      semanticSearch({
        q: committedSemanticQuery,
        type: semanticSearchType,
        limit: settingsQuery.data?.settings.embedSearchLimit || 20,
        threshold: settingsQuery.data?.settings.embedSearchThreshold || 0.5,
        includeItems: true,
        filters: semanticFilterParams,
      }),
    enabled:
      searchMode === "semantic" &&
      semanticAvailable &&
      scanId != null &&
      committedSemanticQuery.trim() !== "",
    staleTime: 30_000,
  });
  const semanticItems = useMemo<AssetItem[]>(
    () =>
      semanticQuery.data?.results
        .map((result) => result.item)
        .filter((item): item is AssetItem => Boolean(item)) ?? [],
    [semanticQuery.data],
  );
  const semanticMetaById = useMemo(() => {
    const out: Record<string, { similarity: number; matchType?: string }> = {};
    for (const result of semanticQuery.data?.results ?? []) {
      out[result.assetId] = {
        similarity: result.similarity,
        matchType: result.matchType,
      };
    }
    return out;
  }, [semanticQuery.data]);
  const items = searchMode === "semantic" ? semanticItems : catalogItems;
  const facets = catalogItemsQuery.data?.pages[0]?.facets;

  function clearFocusedAssetQuery() {
    if (!focusAssetId) return;
    setFocusAssetId("");
    onClearFocusAsset();
  }

  useEffect(() => {
    if (!focusAssetId || activeAssetId) return undefined;

    function handleFocusEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [role='dialog']"))
      ) {
        return;
      }

      setFocusAssetId("");
      onClearFocusAsset();
    }

    document.addEventListener("keydown", handleFocusEscape, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleFocusEscape, {
        capture: true,
      });
  }, [activeAssetId, focusAssetId, onClearFocusAsset]);

  function handleFiltersChange(next: BrowseFilters) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setFilters(next);
  }

  function handleRailFiltersChange(
    next: Omit<BrowseFilters, "favorite"> & { favorite?: string },
  ) {
    handleFiltersChange({ ...next, favorite: next.favorite ?? "" });
  }

  function handleSearchChange(next: string) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setSearchQuery(next);
    if (!next) {
      setCommittedSemanticQuery("");
      onClearSearchRoute();
    }
  }

  function handleSearchModeChange(next: SearchMode) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    if (next === "semantic" && !semanticAvailable) return;
    setSearchMode(next);
    if (next === "semantic") {
      setCommittedSemanticQuery(searchQuery.trim());
    }
  }

  function handleSemanticSubmit() {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    if (!semanticAvailable) return;
    setSearchMode("semantic");
    setCommittedSemanticQuery(searchQuery.trim());
  }

  function handleStatusFilterChange(next: StatusFilter) {
    clearFocusedAssetQuery();
    setSelectedFolder("");
    setExpandedFolders(new Set());
    setFilters(resetBrowseFiltersForStatusChange(projectFilterName, ""));
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
      searchMode: "catalog",
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
        aiOcrStatus: "",
        hasGPS: "",
        favorite: "",
      });
      setSearchQuery(initialSearchQuery);
      setStatusFilter("");
      setSelectedFolder("");
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [autoScrollAssetId, initialSearchQuery, projectFilterName]);

  const { emptyOCRTextCount } = useMemo(
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

  const customFilterSelectOptions = useMemo(() => {
    if (customFilterFacet.length === 0) return [];
    return [
      { value: "", label: t("filter.allCustomFilters") },
      ...customFilterFacet.map((f) => ({
        value: f.id,
        label: `${f.label} (${f.count})`,
      })),
    ];
  }, [customFilterFacet, t]);

  const aiCategorySelectOptions = useMemo(() => {
    const cats = aiCategoryFacet.options;
    if (!cats || cats.length === 0) return [];
    return [
      {
        value: "",
        label: t("filterRail.allCategories"),
      },
      ...cats.map((o) => ({
        value: o.id,
        label: `${facets?.aiCategoryTranslations?.[o.id] ?? o.id} (${o.count})`,
      })),
    ];
  }, [aiCategoryFacet, facets?.aiCategoryTranslations, t]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = useMemo(
    () =>
      bulkMode &&
      items.length > 0 &&
      selected.size >= items.length &&
      items.every((i) => selected.has(i.id)),
    [bulkMode, items, selected],
  );

  const toggleBulkMode = useCallback(() => {
    if (!bulkMode) {
      setBulkMode(true);
    } else if (allSelected) {
      setBulkMode(false);
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }, [bulkMode, allSelected, items]);

  const cancelBulk = useCallback(() => {
    setBulkMode(false);
    setSelected(new Set());
  }, []);

  const selectedBytes = useMemo(
    () =>
      items
        .filter((i) => selected.has(i.id))
        .reduce((sum, i) => sum + i.bytes, 0),
    [items, selected],
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );
  const selectedFavoriteCount = useMemo(
    () => selectedItems.filter((item) => item.favorite).length,
    [selectedItems],
  );
  const selectedFavoriteTarget =
    selectedItems.length > 0 && selectedFavoriteCount === selectedItems.length
      ? false
      : true;

  function handleToggleFavorite(item: AssetItem) {
    favoriteMut.mutate(
      {
        assetId: item.id,
        favorite: !item.favorite,
        scanId,
      },
      {
        onSuccess: () => {
          toast.success(
            item.favorite
              ? t("toast.favoriteRemoved")
              : t("toast.favoriteAdded"),
          );
        },
        onError: (e) => {
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleBulkFavorite() {
    const ids = Array.from(selected);
    favoritesMut.mutate(
      { assetIds: ids, favorite: selectedFavoriteTarget, scanId },
      {
        onSuccess: () => {
          toast.success(
            selectedFavoriteTarget
              ? t("toast.favoriteBulkAdded", { count: ids.length })
              : t("toast.favoriteBulkRemoved", { count: ids.length }),
          );
        },
        onError: (e) => {
          toast.error(errorMessage(e));
        },
      },
    );
  }

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
    toast.info(t("toast.batchRenamePreviewLoading"));
    renamePreviewMut.mutate(
      { assetIds: Array.from(selected), rules },
      {
        onSuccess: (data) => {
          setBatchPreview({
            endpoint: "/api/actions/batch/rename/apply",
            data,
          });
          toast.success(
            t("toast.batchRenamePreviewReady", {
              count: data.preview.moves.length,
            }),
          );
        },
        onError: (e) => {
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleBatchApply() {
    if (!batchPreview) return;
    const currentPreview = batchPreview;
    const isRename = currentPreview.endpoint.includes("rename");
    if (isRename) {
      toast.info(t("toast.batchRenameApplyLoading"));
    }
    batchApplyMut.mutate(
      { endpoint: currentPreview.endpoint, token: currentPreview.data.token },
      {
        onSuccess: () => {
          const moveCount = currentPreview.data.preview.moves.length;
          setBatchPreview(null);
          setSelected(new Set());
          setBulkMode(false);
          if (isRename) {
            toast.success(
              t("toast.batchRenameApplySuccess", { count: moveCount }),
            );
          }
        },
        onError: (e) => {
          toast.error(errorMessage(e));
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
    searchMode === "semantic"
      ? semanticQuery.isFetching
      : catalogItemsQuery.isFetching && !catalogItemsQuery.isFetchingNextPage;
  const showInitialLoading =
    searchMode === "semantic"
      ? semanticQuery.isLoading || (pending && items.length === 0)
      : catalogItemsQuery.isLoading || (pending && items.length === 0);
  const showSemanticLoading =
    searchMode === "semantic" &&
    semanticQuery.isFetching &&
    committedSemanticQuery.trim() !== "";
  const highlightedAssetId = activeAssetId || focusAssetId;

  const emptyCopy =
    searchMode === "semantic"
      ? {
          title: committedSemanticQuery
            ? t("browse.semanticNoResults")
            : t("browse.semanticEmpty"),
          description: semanticQuery.error
            ? errorMessage(semanticQuery.error)
            : t("browse.semanticEmptyDesc"),
          tone: "neutral" as const,
        }
      : browseEmptyCopy(statusFilter, stats, t);

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
        exifHasGpsCount={facets?.exifHasGps}
        favoriteCount={facets?.favoriteCount}
        ocrReadyCount={facets?.ocrReadyCount}
        vlmOcrReadyCount={facets?.vlmOcrReadyCount}
        aiTagReadyCount={facets?.aiTagReadyCount}
        totalCount={facets?.projectTotal}
        ocrEnabled={ocrEnabled}
        aiEnabled={Boolean(settingsQuery.data?.settings.llmEnabled)}
        onFiltersChange={handleRailFiltersChange}
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0">
        <div className="max-w-none p-0 flex h-full flex-col">
          <BrowseToolbar
            view={view}
            gridSize={gridSize}
            bgMode={bgMode}
            searchMode={searchMode}
            semanticAvailable={semanticAvailable}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            sortMode={sortMode}
            aiCategory={filters.aiCategory}
            aiCategoryOptions={aiCategorySelectOptions}
            customFilter={filters.customFilter}
            customFilterOptions={customFilterSelectOptions}
            bulkMode={bulkMode}
            allSelected={allSelected}
            onViewChange={setView}
            onGridSizeChange={setGridSize}
            onBgModeChange={setBgMode}
            onSearchModeChange={handleSearchModeChange}
            onSearchChange={handleSearchChange}
            onSearchSubmit={handleSemanticSubmit}
            onStatusFilterChange={handleStatusFilterChange}
            onSortChange={handleSortChange}
            onAICategoryChange={(v) =>
              handleFiltersChange({ ...filters, aiCategory: v })
            }
            onCustomFilterChange={(v) =>
              handleFiltersChange({ ...filters, customFilter: v })
            }
            onBulkToggle={toggleBulkMode}
            onBulkCancel={cancelBulk}
          />

          {bulkMode && (
            <div className="sticky top-0 z-[5] mb-2 flex w-full min-h-[44px] items-center gap-0.5 overflow-x-auto rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
              <span className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap px-2.5 font-g-mono text-g-body text-g-ink-2">
                {selected.size > 0
                  ? t("selection.summary", {
                      count: selected.size,
                      size: formatBytes(selectedBytes),
                    })
                  : t("browse.selectItems")}
              </span>
              <span className="flex-1" />
              <BulkActionButton
                label={t("imageTools.addToTools")}
                icon={<Images size={14} />}
                disabled={selected.size === 0}
                onClick={() => {
                  if (!onAddToImageTools) {
                    copyPaths();
                    return;
                  }
                  onAddToImageTools(Array.from(selected));
                  setSelected(new Set());
                  setBulkMode(false);
                }}
              />
              <BulkActionButton
                label={
                  selectedFavoriteTarget
                    ? t("favorites.addSelected")
                    : t("favorites.removeSelected")
                }
                icon={
                  selectedFavoriteTarget ? (
                    <Star size={14} />
                  ) : (
                    <StarOff size={14} />
                  )
                }
                disabled={selected.size === 0 || favoritesMut.isPending}
                onClick={handleBulkFavorite}
              />
              <BulkActionButton
                label={pathsCopied ? t("toast.copied") : t("action.copyPaths")}
                icon={pathsCopied ? <Check size={14} /> : <Copy size={14} />}
                disabled={selected.size === 0}
                onClick={copyPaths}
              />
              <BulkActionButton
                label={t("action.batchCopy")}
                icon={<FolderOutput size={14} />}
                disabled={selected.size === 0}
                onClick={() => setShowCopyDir(true)}
              />
              <BulkActionButton
                label={t("action.batchMove")}
                icon={<FolderInput size={14} />}
                disabled={selected.size === 0}
                onClick={() => setShowMoveDir(true)}
              />
              <BulkActionButton
                label={t("action.batchRename")}
                icon={<PenLine size={14} />}
                disabled={selected.size === 0}
                onClick={() => setShowRenameRules(true)}
              />
              <BulkActionButton
                label={t("action.batchExport")}
                icon={<Download size={14} />}
                disabled={selected.size === 0}
                onClick={() => batchExport(Array.from(selected))}
              />
              {aiEnabled && onStartAITag && (
                <BulkActionButton
                  label={t("action.batchAITag")}
                  icon={<Tags size={14} />}
                  disabled={aiBusy || selected.size === 0}
                  onClick={() => onStartAITag(Array.from(selected))}
                />
              )}
              {aiEnabled && onStartVLMOcr && (
                <BulkActionButton
                  label={t("action.batchAIOcr")}
                  icon={<ScanText size={14} />}
                  disabled={aiBusy || selected.size === 0}
                  onClick={() => onStartVLMOcr(Array.from(selected))}
                />
              )}
              <BulkActionButton
                label={t("action.deleteSelected")}
                icon={<Trash2 size={14} />}
                disabled={selected.size === 0}
                onClick={() => setShowDeleteConfirm(true)}
              />
            </div>
          )}

          {showSemanticLoading ? (
            <div className="mt-1 flex min-h-0 flex-1">
              <SemanticSearchLoadingPanel
                query={committedSemanticQuery}
                modelName={semanticModelName}
                dimensionsLabel={semanticDimensionsLabel}
                style={semanticLoadingStyle}
                dimensionToken={semanticDimensionToken}
                fill
                className="h-full w-full max-w-none rounded-g-md shadow-none"
              />
            </div>
          ) : showInitialLoading && searchMode === "semantic" ? (
            <div className="mt-1 flex min-h-0 flex-1">
              <SemanticSearchLoadingPanel
                query={committedSemanticQuery}
                modelName={semanticModelName}
                dimensionsLabel={semanticDimensionsLabel}
                style={semanticLoadingStyle}
                dimensionToken={semanticDimensionToken}
                fill
                className="h-full w-full max-w-none rounded-g-md shadow-none"
              />
            </div>
          ) : showInitialLoading ? (
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
              className={
                searchMode === "semantic"
                  ? "min-h-[420px] justify-center"
                  : undefined
              }
              icon={
                searchMode === "semantic" ? (
                  <WandSparkles aria-hidden="true" />
                ) : undefined
              }
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
              <BrowseTreePanel
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
                  activeAssetId={highlightedAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  imagePreviewDelayMs={imagePreviewDelayMs}
                  imagePreviewSize={imagePreviewSize}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  favoritePending={favoriteMut.isPending}
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
                  activeAssetId={highlightedAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  imagePreviewDelayMs={imagePreviewDelayMs}
                  imagePreviewSize={imagePreviewSize}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  favoritePending={favoriteMut.isPending}
                  semanticMetaById={semanticMetaById}
                  hasMore={
                    searchMode === "semantic"
                      ? false
                      : catalogItemsQuery.hasNextPage
                  }
                  loadingMore={
                    searchMode === "semantic"
                      ? false
                      : catalogItemsQuery.isFetchingNextPage
                  }
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
                  activeAssetId={highlightedAssetId}
                  autoScrollAssetId={autoScrollAssetId}
                  imagePreviewEnabled={imagePreviewEnabled}
                  imagePreviewDelayMs={imagePreviewDelayMs}
                  imagePreviewSize={imagePreviewSize}
                  onAutoScrollDone={onAutoScrollDone}
                  onSelect={(item) => onOpenAsset(item.id)}
                  onToggleSelect={toggleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  favoritePending={favoriteMut.isPending}
                  semanticMetaById={semanticMetaById}
                  hasMore={
                    searchMode === "semantic"
                      ? false
                      : catalogItemsQuery.hasNextPage
                  }
                  loadingMore={
                    searchMode === "semantic"
                      ? false
                      : catalogItemsQuery.isFetchingNextPage
                  }
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
          items={items.filter((i) => selected.has(i.id))}
          imagePreviewEnabled={imagePreviewEnabled}
          imagePreviewDelayMs={imagePreviewDelayMs}
          imagePreviewSize={imagePreviewSize}
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

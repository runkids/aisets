import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { displayCatalogForMode, navigationBadges } from "./appScope";
import { AppTopbar } from "./components/AppTopbar";
import { AssetDrawer } from "./components/AssetDrawer";
import { BrowseView } from "./components/BrowseView";
import { CommandPalette } from "./components/CommandPalette";
import { ProjectsView } from "./components/ProjectsView";
import { DirectoryPickerModal } from "./components/DirectoryPickerModal";
import { DuplicatesView } from "./components/DuplicatesView";
import { LintView } from "./components/LintView";
import { NavSidebar } from "./components/NavSidebar";
import { OptimizeView } from "./components/OptimizeView";
import { PreCheckView } from "./components/PreCheckView";
import { PreviewModal } from "./components/PreviewModal";
import { ScrollToTop } from "./components/ScrollToTop";
import { Button, EmptyState, NoticeStack, PromptDialog } from "./components/ui";
import { SettingsView } from "./components/SettingsView";
import { useToast } from "./components/ToastProvider";
import { UnusedView } from "./components/UnusedView";
import {
  useAddProjectMutation,
  useApplyPreviewMutation,
  useCatalogDuplicatesInfiniteQuery,
  useSwitchWorkspaceMutation,
  useCatalogQuery,
  useCatalogItemsInfiniteQuery,
  useCatalogItemDetailQuery,
  useDeleteUnusedPreviewMutation,
  useRenamePreviewMutation,
  useScanCatalogMutation,
  useSettingsQuery,
} from "./queries";
import { errorMessage } from "./i18n/index";
import {
  ImageBackgroundProvider,
  normalizeImageBackgroundMode,
  type ImageBackgroundMode,
} from "./imageBackground";
import type { ActionPreview, AssetItem, Catalog, ScanEvent } from "./types";
import { fileName, modeForPath, pathForMode, type Mode } from "./ui";

type PreviewState = { endpoint: string; token: string; value: ActionPreview };
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type BrowseQueryParams = {
  assetId?: string;
  projectName?: string;
  ext?: string;
  q?: string;
  status?: string;
  sort?: string;
  customFilter?: string;
  folder?: string;
};

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const IMAGE_BACKGROUND_STORAGE_KEY = "asset-studio-image-background";
const BROWSE_STATE_STORAGE_KEY = "asset-studio-browse-state";
const SCAN_COMPLETE_DISMISS_MS = 1200;
const SCAN_ERROR_DISMISS_MS = 3500;

function storedThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem("asset-studio-theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "dark";
}

function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function storedImageBackgroundMode(): ImageBackgroundMode {
  const stored = window.localStorage.getItem(IMAGE_BACKGROUND_STORAGE_KEY);
  const normalized = normalizeImageBackgroundMode(stored, "checker");
  if (normalized === stored) return normalized;

  try {
    const browseState = JSON.parse(
      window.localStorage.getItem(BROWSE_STATE_STORAGE_KEY) ?? "null",
    ) as { bgMode?: unknown } | null;
    return normalizeImageBackgroundMode(browseState?.bgMode, "checker");
  } catch {
    return "checker";
  }
}

export function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = modeForPath(location.pathname);

  useEffect(() => {
    if (location.pathname === "/") navigate("/projects", { replace: true });
  }, [location.pathname, navigate]);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetItem | null>(null);
  const [drawerSeedAsset, setDrawerSeedAsset] = useState<AssetItem | null>(
    null,
  );
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [autoScrollAssetId, setAutoScrollAssetId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [scanProgress, setScanProgress] = useState<ScanEvent | null>(null);
  const [scanProgressVisible, setScanProgressVisible] = useState(false);
  const [browseQueryParams, setBrowseQueryParams] = useState<BrowseQueryParams>(
    {},
  );
  const [browseQueryReady, setBrowseQueryReady] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(storedThemePreference);
  const [imagePreviewEnabled, setImagePreviewEnabled] = useState(() => {
    return window.localStorage.getItem("asset-studio-image-preview") !== "off";
  });
  const [imageBackgroundMode, setImageBackgroundMode] =
    useState<ImageBackgroundMode>(storedImageBackgroundMode);

  const drawerId = searchParams.get("asset") ?? "";
  const browseCustomFilterId = searchParams.get("customFilter") ?? "";
  const browseFocusAssetId = searchParams.get("focusAsset") ?? "";
  const browseInitialSearch = searchParams.get("q") ?? "";

  function changeMode(nextMode: Mode, projectId?: string) {
    if (projectId != null) setSelectedProjectId(projectId);
    navigate(pathForMode(nextMode));
  }

  const setDrawerId = useCallback(
    (id: string) => {
      if (!id) setDrawerSeedAsset(null);
      setAutoScrollAssetId("");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("asset", id);
          else next.delete("asset");
          return next;
        },
        { replace: true },
      );
    },
    [setAutoScrollAssetId, setDrawerSeedAsset, setSearchParams],
  );

  const toast = useToast();
  const autoScanStartedRef = useRef(false);
  const catalogQuery = useCatalogQuery();
  const handleScanEvent = useCallback(
    (event: ScanEvent) => {
      setScanProgress(event);
      setScanProgressVisible(true);
    },
    [setScanProgress, setScanProgressVisible],
  );
  const scanMutation = useScanCatalogMutation({ onEvent: handleScanEvent });
  const settingsQuery = useSettingsQuery();
  const addProjectMutation = useAddProjectMutation();
  const switchWorkspaceMutation = useSwitchWorkspaceMutation();
  const renamePreviewMutation = useRenamePreviewMutation();
  const deletePreviewMutation = useDeleteUnusedPreviewMutation();
  const applyPreviewMutation = useApplyPreviewMutation();

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveThemePreference(theme);
    };

    applyTheme();
    window.localStorage.setItem("asset-studio-theme", theme);

    if (theme !== "system") return undefined;

    const media = window.matchMedia(SYSTEM_THEME_QUERY);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "asset-studio-image-preview",
      imagePreviewEnabled ? "on" : "off",
    );
  }, [imagePreviewEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_BACKGROUND_STORAGE_KEY,
      imageBackgroundMode,
    );
  }, [imageBackgroundMode]);

  useEffect(() => {
    if (scanMutation.isPending) return undefined;
    if (!scanProgressVisible) return undefined;

    const dismissDelay =
      scanProgress?.type === "error"
        ? SCAN_ERROR_DISMISS_MS
        : SCAN_COMPLETE_DISMISS_MS;
    const timeout = window.setTimeout(
      () => setScanProgressVisible(false),
      dismissDelay,
    );
    return () => window.clearTimeout(timeout);
  }, [scanMutation.isPending, scanProgressVisible, scanProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      } else if (e.key === "Escape") setCmdkOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const catalogSummary = catalogQuery.data ?? null;

  const effectiveSelectedProjectId =
    selectedProjectId &&
    catalogSummary?.projects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : "";

  const catalogItemsQuery = useCatalogItemsInfiniteQuery(
    catalogSummary?.scanId,
    {
      assetId: browseQueryParams.assetId,
      projectId: effectiveSelectedProjectId || undefined,
      projectName: browseQueryParams.projectName,
      ext: browseQueryParams.ext,
      q: browseQueryParams.q,
      status: browseQueryParams.status,
      sort: browseQueryParams.sort,
      customFilter: browseQueryParams.customFilter,
      folder: browseQueryParams.folder,
      limit: 100,
    },
    catalogSummary != null && (mode !== "browse" || browseQueryReady),
  );

  const cleanupProjectParams = {
    projectId: effectiveSelectedProjectId || undefined,
    limit: 200,
  };
  const unusedItemsQuery = useCatalogItemsInfiniteQuery(
    catalogSummary?.scanId,
    {
      ...cleanupProjectParams,
      status: "unused",
      sort: "path",
    },
    mode === "unused" &&
      catalogSummary != null &&
      catalogSummary.analysis.references === "computed",
  );
  const duplicateItemsQuery = useCatalogItemsInfiniteQuery(
    catalogSummary?.scanId,
    {
      ...cleanupProjectParams,
      status: "duplicate",
      sort: "path",
    },
    mode === "duplicates" &&
      catalogSummary != null &&
      catalogSummary.analysis.nearDuplicates === "computed",
  );
  const exactDuplicatesQuery = useCatalogDuplicatesInfiniteQuery(
    catalogSummary?.scanId,
    { kind: "exact", limit: 200 },
    mode === "duplicates" &&
      catalogSummary != null &&
      catalogSummary.analysis.nearDuplicates === "computed",
  );
  const nearDuplicatesQuery = useCatalogDuplicatesInfiniteQuery(
    catalogSummary?.scanId,
    { kind: "near", limit: 200 },
    mode === "duplicates" &&
      catalogSummary != null &&
      catalogSummary.analysis.nearDuplicates === "computed",
  );

  const items = useMemo(
    () => catalogItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogItemsQuery.data],
  );
  const unusedPageItems = useMemo(
    () => unusedItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [unusedItemsQuery.data],
  );
  const duplicatePageItems = useMemo(
    () => duplicateItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [duplicateItemsQuery.data],
  );
  const exactDuplicateGroups = useMemo(
    () => exactDuplicatesQuery.data?.pages.flatMap((page) => page.groups) ?? [],
    [exactDuplicatesQuery.data],
  );
  const nearDuplicatePairs = useMemo(
    () => nearDuplicatesQuery.data?.pages.flatMap((page) => page.pairs) ?? [],
    [nearDuplicatesQuery.data],
  );
  const browseFacets = catalogItemsQuery.data?.pages[0]?.facets;

  const catalog = useMemo<Catalog | null>(() => {
    if (!catalogSummary) return null;
    return {
      ...catalogSummary,
      items,
      duplicateGroups: [],
      nearDuplicates: [],
      lintFindings: [],
    };
  }, [catalogSummary, items]);
  const {
    fetchNextPage: fetchNextUnusedItemsPage,
    hasNextPage: hasMoreUnusedItems,
    isFetchingNextPage: isFetchingMoreUnusedItems,
  } = unusedItemsQuery;
  const {
    fetchNextPage: fetchNextDuplicateItemsPage,
    hasNextPage: hasMoreDuplicateItems,
    isFetchingNextPage: isFetchingMoreDuplicateItems,
  } = duplicateItemsQuery;
  const {
    fetchNextPage: fetchNextExactDuplicatesPage,
    hasNextPage: hasMoreExactDuplicates,
    isFetchingNextPage: isFetchingMoreExactDuplicates,
  } = exactDuplicatesQuery;
  const {
    fetchNextPage: fetchNextNearDuplicatesPage,
    hasNextPage: hasMoreNearDuplicates,
    isFetchingNextPage: isFetchingMoreNearDuplicates,
  } = nearDuplicatesQuery;

  useEffect(() => {
    if (mode !== "unused") return;
    if (!hasMoreUnusedItems || isFetchingMoreUnusedItems) return;
    void fetchNextUnusedItemsPage();
  }, [
    fetchNextUnusedItemsPage,
    hasMoreUnusedItems,
    isFetchingMoreUnusedItems,
    mode,
  ]);

  useEffect(() => {
    if (mode !== "duplicates") return;
    if (!hasMoreDuplicateItems || isFetchingMoreDuplicateItems) return;
    void fetchNextDuplicateItemsPage();
  }, [
    fetchNextDuplicateItemsPage,
    hasMoreDuplicateItems,
    isFetchingMoreDuplicateItems,
    mode,
  ]);

  useEffect(() => {
    if (mode !== "duplicates") return;
    if (!hasMoreExactDuplicates || isFetchingMoreExactDuplicates) return;
    void fetchNextExactDuplicatesPage();
  }, [
    fetchNextExactDuplicatesPage,
    hasMoreExactDuplicates,
    isFetchingMoreExactDuplicates,
    mode,
  ]);

  useEffect(() => {
    if (mode !== "duplicates") return;
    if (!hasMoreNearDuplicates || isFetchingMoreNearDuplicates) return;
    void fetchNextNearDuplicatesPage();
  }, [
    fetchNextNearDuplicatesPage,
    hasMoreNearDuplicates,
    isFetchingMoreNearDuplicates,
    mode,
  ]);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (autoScanStartedRef.current || !settings || !catalog) return;
    if (!settings.scanOnOpen && !settings.autoScanOnOpen) return;
    if (catalog.projects.length === 0) return;

    autoScanStartedRef.current = true;
    scanMutation.mutate(undefined, {
      onError: (error) => toast.error(errorMessage(error)),
    });
  }, [catalog, scanMutation, settingsQuery.data?.settings, toast]);

  const working =
    catalogQuery.isFetching ||
    catalogItemsQuery.isFetching ||
    (mode === "unused" && unusedItemsQuery.isFetching) ||
    (mode === "duplicates" &&
      (duplicateItemsQuery.isFetching ||
        exactDuplicatesQuery.isFetching ||
        nearDuplicatesQuery.isFetching)) ||
    scanMutation.isPending ||
    addProjectMutation.isPending ||
    switchWorkspaceMutation.isPending;
  const workspaceName =
    settingsQuery.data?.settings.workspaceName ?? t("projects.workspaceName");
  const ocrEnabled = settingsQuery.data?.settings.ocrEnabled ?? false;
  const ocrFuzzySearch = settingsQuery.data?.settings.ocrFuzzySearch ?? true;
  const activeWorkspaceId =
    settingsQuery.data?.settings.activeWorkspaceId ?? "default";
  const workspaces = settingsQuery.data?.settings.workspaces ?? [
    { id: activeWorkspaceId, name: workspaceName, projectCount: 0 },
  ];

  const selectedProject = useMemo(() => {
    return (
      catalog?.projects.find(
        (project) => project.id === effectiveSelectedProjectId,
      ) ?? null
    );
  }, [catalog, effectiveSelectedProjectId]);

  const selectedProjectStats = useMemo(() => {
    if (!catalog || !effectiveSelectedProjectId) return null;
    return (
      catalog.projectStats.find(
        (stat) => stat.projectId === effectiveSelectedProjectId,
      ) ?? null
    );
  }, [catalog, effectiveSelectedProjectId]);

  const projectAssetCounts = useMemo(
    () =>
      new Map(
        catalog?.projectStats.map((stat) => [stat.projectId, stat.totalFiles]),
      ),
    [catalog?.projectStats],
  );

  const projectSwitchProjects = useMemo(() => {
    return (catalog?.projects ?? []).map((project) => ({
      ...project,
      assetCount: projectAssetCounts.get(project.id) ?? 0,
    }));
  }, [catalog, projectAssetCounts]);

  const browseProjectNames = useMemo(() => {
    if (!catalog) return [];
    if (selectedProject) return [selectedProject.name];
    return catalog.projects.map((project) => project.name);
  }, [catalog, selectedProject]);

  const scopedItems = useMemo(() => {
    return effectiveSelectedProjectId
      ? items.filter((item) => item.projectId === effectiveSelectedProjectId)
      : items;
  }, [effectiveSelectedProjectId, items]);

  const scopedItemIds = useMemo(
    () => new Set(scopedItems.map((item) => item.id)),
    [scopedItems],
  );
  const duplicatePageItemIds = useMemo(
    () => new Set(duplicatePageItems.map((item) => item.id)),
    [duplicatePageItems],
  );
  const duplicatePageGroups = useMemo(
    () =>
      exactDuplicateGroups.filter(
        (group) =>
          duplicatePageItems.filter(
            (item) => item.duplicateGroupId === group.id,
          ).length > 1,
      ),
    [duplicatePageItems, exactDuplicateGroups],
  );
  const duplicatePageNearDuplicates = useMemo(
    () =>
      nearDuplicatePairs.filter(
        (pair) =>
          duplicatePageItemIds.has(pair.leftId) &&
          duplicatePageItemIds.has(pair.rightId),
      ),
    [duplicatePageItemIds, nearDuplicatePairs],
  );

  const scopedDuplicateGroups = useMemo(() => {
    if (!catalog) return [];
    return catalog.duplicateGroups.filter(
      (group) =>
        scopedItems.filter((item) => item.duplicateGroupId === group.id)
          .length > 1,
    );
  }, [catalog, scopedItems]);

  const scopedNearDuplicates = useMemo(() => {
    if (!catalog) return [];
    return catalog.nearDuplicates.filter(
      (pair) =>
        scopedItemIds.has(pair.leftId) && scopedItemIds.has(pair.rightId),
    );
  }, [catalog, scopedItemIds]);

  const scopedLintFindings = useMemo(() => {
    if (!catalog) return [];
    if (!selectedProject) return catalog.lintFindings;
    return catalog.lintFindings.filter((finding) => {
      if (finding.assetId) return scopedItemIds.has(finding.assetId);
      return finding.file.startsWith(selectedProject.name);
    });
  }, [catalog, scopedItemIds, selectedProject]);

  const unusedItems = useMemo(
    () =>
      catalog?.analysis.references === "computed"
        ? scopedItems.filter((i) => i.usedBy.length === 0)
        : [],
    [catalog?.analysis.references, scopedItems],
  );
  const optimizeItems = useMemo(
    () =>
      catalog?.analysis.optimization === "computed"
        ? scopedItems.filter((i) => i.optimizationRecommendations.length > 0)
        : [],
    [catalog?.analysis.optimization, scopedItems],
  );
  const lintFindings = scopedLintFindings;

  const optimizeCount =
    selectedProjectStats?.optimizableFiles ?? optimizeItems.length;
  const scopedStats = useMemo(
    () =>
      catalog && !effectiveSelectedProjectId
        ? catalog.stats
        : {
            totalFiles: selectedProjectStats?.totalFiles ?? scopedItems.length,
            duplicateGroups: scopedDuplicateGroups.length,
            duplicateFiles:
              selectedProjectStats?.duplicateFiles ??
              scopedItems.filter(
                (item) =>
                  item.duplicateGroupId &&
                  scopedDuplicateGroups.some(
                    (group) => group.id === item.duplicateGroupId,
                  ),
              ).length,
            unusedFiles:
              selectedProjectStats?.unusedFiles ?? unusedItems.length,
            nearDuplicates: scopedNearDuplicates.length,
            lintFindings:
              selectedProjectStats?.lintFindings ?? scopedLintFindings.length,
            cacheHits: catalog?.stats.cacheHits ?? 0,
          },
    [
      catalog,
      effectiveSelectedProjectId,
      scopedDuplicateGroups,
      scopedItems,
      scopedLintFindings,
      scopedNearDuplicates,
      selectedProjectStats,
      unusedItems.length,
    ],
  );

  const scopedCatalog = useMemo(() => {
    if (!catalog) return null;
    const projects = selectedProject ? [selectedProject] : catalog.projects;
    return {
      ...catalog,
      projects,
      items: scopedItems,
      duplicateGroups: scopedDuplicateGroups,
      nearDuplicates: scopedNearDuplicates,
      lintFindings: scopedLintFindings,
      stats: scopedStats,
    };
  }, [
    catalog,
    scopedDuplicateGroups,
    scopedItems,
    scopedLintFindings,
    scopedNearDuplicates,
    scopedStats,
    selectedProject,
  ]);

  const badges = navigationBadges(catalog, scopedStats, optimizeCount);
  const displayCatalog = displayCatalogForMode(mode, catalog, scopedCatalog);

  const drawerDetailQuery = useCatalogItemDetailQuery(
    catalog?.scanId,
    drawerId,
    drawerId !== "",
  );
  const drawerAsset = drawerId
    ? (drawerDetailQuery.data?.item ??
      items.find((i) => i.id === drawerId) ??
      (drawerSeedAsset?.id === drawerId ? drawerSeedAsset : undefined))
    : undefined;
  const directoryPickerInitialPath =
    settingsQuery.data?.settings.defaultProjectRoot ?? "";

  const notices: ComponentProps<typeof NoticeStack>["items"] = [];
  if (catalogQuery.error)
    notices.push({
      id: "catalog-error",
      tone: "danger",
      title: t("error.catalogLoad"),
      children: errorMessage(catalogQuery.error),
    });
  if (scanMutation.error)
    notices.push({
      id: "scan-error",
      tone: "danger",
      title: t("error.scan"),
      children: errorMessage(scanMutation.error),
    });
  if (addProjectMutation.error)
    notices.push({
      id: "add-error",
      tone: "danger",
      title: t("error.addProject"),
      children: errorMessage(addProjectMutation.error),
    });

  function onAddProject(path: string) {
    addProjectMutation.mutate(path, {
      onSuccess: () => {
        setDirectoryPickerOpen(false);
        toast.success(t("toast.projectAdded", { path }));
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onSwitchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    switchWorkspaceMutation.mutate(workspaceId, {
      onSuccess: (result) => {
        setSelectedProjectId("");
        toast.success(
          t("toast.workspaceSwitched", {
            name: result.settings.workspaceName,
          }),
        );
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onRescan() {
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(undefined, {
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onFullScan() {
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(
      { profile: "full" },
      {
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  function onRename(item: AssetItem) {
    setRenameTarget(item);
  }

  function onRenameConfirm(targetPath: string) {
    if (!renameTarget || targetPath === renameTarget.repoPath) return;
    renamePreviewMutation.mutate(
      {
        assetId: renameTarget.id,
        targetPath,
      },
      {
        onSuccess: (result) => {
          setRenameTarget(null);
          setPreview({
            endpoint: "/api/actions/rename/apply",
            token: result.token,
            value: result.preview,
          });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  async function onDelete(item: AssetItem) {
    const result = await deletePreviewMutation.mutateAsync(item.id);
    setPreview({
      endpoint: "/api/actions/delete-unused/apply",
      token: result.token,
      value: result.preview,
    });
  }

  async function onApplyPreview() {
    if (!preview) return;
    try {
      await applyPreviewMutation.mutateAsync({
        endpoint: preview.endpoint,
        token: preview.token,
      });
      setPreview(null);
      toast.success(t("toast.applyComplete"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function openAssetIdFromPalette(id: string) {
    const params = new URLSearchParams({ asset: id });
    setAutoScrollAssetId(id);
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  function openAssetFromPalette(asset: AssetItem) {
    const params = new URLSearchParams({
      asset: asset.id,
      focusAsset: asset.id,
      q: fileName(asset.repoPath),
    });
    setSelectedProjectId("");
    setDrawerSeedAsset(asset);
    setAutoScrollAssetId(asset.id);
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  function openCustomFilterFromPalette(id: string) {
    const params = new URLSearchParams({ customFilter: id });
    setAutoScrollAssetId("");
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  const clearAutoScrollAssetId = useCallback(
    () => setAutoScrollAssetId(""),
    [setAutoScrollAssetId],
  );

  const onBrowseQueryParamsChange = useCallback(
    (next: BrowseQueryParams) => {
      setBrowseQueryReady(true);
      setBrowseQueryParams((prev) =>
        prev.projectName === next.projectName &&
        prev.assetId === next.assetId &&
        prev.ext === next.ext &&
        prev.q === next.q &&
        prev.status === next.status &&
        prev.sort === next.sort &&
        prev.customFilter === next.customFilter &&
        prev.folder === next.folder
          ? prev
          : next,
      );
    },
    [setBrowseQueryParams, setBrowseQueryReady],
  );

  const appShell = (
    <main className="grid h-screen w-screen grid-cols-[240px_1fr] grid-rows-[60px_1fr] bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)] max-[960px]:grid-cols-[64px_1fr]">
      <div className="col-span-2 row-start-1">
        <AppTopbar
          working={working}
          scanProgress={scanProgressVisible ? scanProgress : null}
          onAddProject={() => setDirectoryPickerOpen(true)}
          onRefresh={onRescan}
          onOpenCmdK={() => setCmdkOpen(true)}
        />
      </div>
      <NavSidebar
        mode={mode}
        badges={badges}
        workspaceName={workspaceName}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        projects={projectSwitchProjects}
        selectedProjectId={effectiveSelectedProjectId}
        totalAssets={catalog?.stats.totalFiles ?? items.length}
        onSelectWorkspace={onSwitchWorkspace}
        onSelectProject={setSelectedProjectId}
        onSelect={changeMode}
      />
      <section className="flex flex-col overflow-hidden bg-transparent">
        <NoticeStack items={notices} />

        <div className="flex flex-1 overflow-hidden">
          {mode === "browse" ? (
            <BrowseView
              key={
                selectedProject
                  ? `${selectedProject.id}:${selectedProject.name}:${browseCustomFilterId}:${browseFocusAssetId}:${browseInitialSearch}`
                  : `all-projects:${browseCustomFilterId}:${browseFocusAssetId}:${browseInitialSearch}`
              }
              items={scopedItems}
              activeAssetId={drawerId}
              autoScrollAssetId={autoScrollAssetId}
              initialCustomFilterId={browseCustomFilterId}
              initialSearchQuery={browseInitialSearch}
              initialFocusAssetId={browseFocusAssetId}
              customFilters={
                settingsQuery.data?.settings.customAssetFilters ?? []
              }
              projectNames={browseProjectNames}
              scanId={catalogSummary?.scanId}
              projectFilterId={effectiveSelectedProjectId || undefined}
              projectFilterName={selectedProject?.name ?? ""}
              projectOptions={browseFacets?.projects}
              projectTotal={browseFacets?.projectTotal}
              extensionOptions={browseFacets?.extensions}
              extensionTotal={browseFacets?.extensionTotal}
              customFilterFacetOptions={browseFacets?.customFilters}
              customFilterTotal={browseFacets?.customFilterTotal}
              imagePreviewEnabled={imagePreviewEnabled}
              ocrEnabled={ocrEnabled}
              ocrFuzzySearch={ocrFuzzySearch}
              initialLoading={
                (!browseQueryReady || catalogItemsQuery.isLoading) &&
                items.length === 0
              }
              pending={
                catalogItemsQuery.isFetching &&
                !catalogItemsQuery.isFetchingNextPage
              }
              onAutoScrollDone={clearAutoScrollAssetId}
              onOpenAsset={setDrawerId}
              onQueryParamsChange={onBrowseQueryParamsChange}
              loadingMore={catalogItemsQuery.isFetchingNextPage}
              hasMore={catalogItemsQuery.hasNextPage}
              onLoadMore={() => {
                void catalogItemsQuery.fetchNextPage();
              }}
            />
          ) : mode === "settings" ? (
            <SettingsView
              theme={theme}
              imagePreviewEnabled={imagePreviewEnabled}
              imageBackgroundMode={imageBackgroundMode}
              onThemeChange={setTheme}
              onImagePreviewEnabledChange={setImagePreviewEnabled}
              onImageBackgroundModeChange={setImageBackgroundMode}
            />
          ) : (
            <div
              key={mode}
              className="flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pt-0 max-[768px]:pb-8"
            >
              {mode === "precheck" ? (
                <PreCheckView onOpenAsset={openAssetIdFromPalette} />
              ) : displayCatalog == null &&
                !catalogQuery.isLoading ? null : mode === "projects" &&
                displayCatalog ? (
                <ProjectsView
                  catalog={displayCatalog}
                  onJump={changeMode}
                  onAddProject={() => setDirectoryPickerOpen(true)}
                />
              ) : mode === "duplicates" && scopedCatalog ? (
                catalog?.analysis.nearDuplicates === "notComputed" ? (
                  <NotComputedState
                    title={t("catalog.notComputed.nearTitle")}
                    description={t("catalog.notComputed.nearDesc")}
                    action={t("catalog.notComputed.fullScan")}
                    onAction={onFullScan}
                  />
                ) : (
                  <DuplicatesView
                    items={duplicatePageItems}
                    groups={duplicatePageGroups}
                    nearDuplicates={duplicatePageNearDuplicates}
                    onOpenAsset={setDrawerId}
                  />
                )
              ) : mode === "unused" ? (
                catalog?.analysis.references === "notComputed" ? (
                  <NotComputedState
                    title={t("catalog.notComputed.referencesTitle")}
                    description={t("catalog.notComputed.referencesDesc")}
                    action={t("catalog.notComputed.fullScan")}
                    onAction={onFullScan}
                  />
                ) : (
                  <UnusedView
                    items={unusedPageItems}
                    onOpenAsset={setDrawerId}
                  />
                )
              ) : mode === "optimize" ? (
                catalog?.analysis.optimization === "notComputed" ? (
                  <NotComputedState
                    title={t("catalog.notComputed.optimizationTitle")}
                    description={t("catalog.notComputed.optimizationDesc")}
                    action={t("catalog.notComputed.fullScan")}
                    onAction={onFullScan}
                  />
                ) : (
                  <OptimizeView
                    items={optimizeItems}
                    onOpenAsset={setDrawerId}
                  />
                )
              ) : mode === "lint" ? (
                <LintView findings={lintFindings} onOpenAsset={setDrawerId} />
              ) : null}
            </div>
          )}
        </div>
      </section>

      <ScrollToTop />

      {drawerAsset && (
        <AssetDrawer
          key={drawerAsset.id}
          asset={drawerAsset}
          onClose={() => setDrawerId("")}
          onRename={onRename}
          onDelete={onDelete}
          onOpenAsset={setDrawerId}
          duplicateItems={drawerDetailQuery.data?.duplicates ?? []}
          similarItems={drawerDetailQuery.data?.similarItems ?? []}
          nearDuplicates={drawerDetailQuery.data?.similar ?? []}
          detailLoading={
            drawerDetailQuery.isFetching && drawerDetailQuery.data == null
          }
          detailError={
            drawerDetailQuery.error
              ? errorMessage(drawerDetailQuery.error)
              : undefined
          }
          onRetryDetail={() => {
            void drawerDetailQuery.refetch();
          }}
        />
      )}

      <CommandPalette
        open={cmdkOpen}
        scanId={catalog?.scanId}
        customFilters={settingsQuery.data?.settings.customAssetFilters ?? []}
        ocrEnabled={ocrEnabled}
        onClose={() => setCmdkOpen(false)}
        onNavigate={changeMode}
        onOpenAsset={openAssetFromPalette}
        onOpenCustomFilter={openCustomFilterFromPalette}
      />

      {directoryPickerOpen && (
        <DirectoryPickerModal
          open={directoryPickerOpen}
          working={addProjectMutation.isPending}
          initialPath={directoryPickerInitialPath}
          onClose={() => setDirectoryPickerOpen(false)}
          onSelect={onAddProject}
        />
      )}

      <PromptDialog
        open={renameTarget != null}
        title={t("action.rename")}
        label={t("prompt.renamePath")}
        defaultValue={renameTarget?.repoPath ?? ""}
        confirmText={t("action.rename")}
        cancelText={t("common.cancel")}
        loading={renamePreviewMutation.isPending}
        onConfirm={onRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />

      {preview && (
        <PreviewModal
          preview={preview.value}
          working={applyPreviewMutation.isPending}
          onCancel={() => setPreview(null)}
          onApply={onApplyPreview}
        />
      )}
    </main>
  );

  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <ImageBackgroundProvider
        mode={imageBackgroundMode}
        onModeChange={setImageBackgroundMode}
      >
        {appShell}
      </ImageBackgroundProvider>
    </TooltipPrimitive.Provider>
  );
}

function NotComputedState({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <EmptyState
      tone="info"
      title={title}
      description={description}
      action={
        <Button variant="secondary" onClick={onAction}>
          {action}
        </Button>
      }
    />
  );
}

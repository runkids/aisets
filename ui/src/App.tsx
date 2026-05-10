import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  navigationBadges,
  optimizableBadgeCount,
  scopedStatsForProject,
} from "./appScope";
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
import { PromptsView } from "./components/PromptsView";
import { PreviewModal } from "./components/PreviewModal";
import { ScrollToTop } from "./components/ScrollToTop";
import { ScanHistoryView } from "./components/ScanHistoryView";
import {
  Button,
  EmptyState,
  NoticeStack,
  PromptDialog,
  ScanProgressContent,
} from "./components/ui";
import { SettingsView } from "./components/SettingsView";
import { useToast } from "./components/ToastProvider";
import {
  catalogQueryKey,
  useAddProjectMutation,
  useApplyPreviewMutation,
  useSwitchWorkspaceMutation,
  useCatalogQuery,
  useCatalogItemDetailQuery,
  useDeleteUnusedPreviewMutation,
  useRenamePreviewMutation,
  useScanCatalogMutation,
  useScanStatusQuery,
  useSettingsQuery,
} from "./queries";
import { APIError, runOCR, runAITagging, runVLMOcr } from "./api";
import { errorMessage } from "./i18n/index";
import {
  initialOCRActivityState,
  isOCRActivityBusy,
  ocrActivityReducer,
  runOCRActivity,
} from "./ocrActivity";
import {
  initialOptimizeActivityState,
  isOptimizeActivityBusy,
  optimizeActivityReducer,
} from "./optimizeActivity";
import {
  initialAITagActivityState,
  aiTagActivityReducer,
  isAITagActivityBusy,
  runAITagActivity,
} from "./aiTagActivity";
import {
  initialVLMOcrActivityState,
  isVLMOcrActivityBusy,
  vlmOcrActivityReducer,
  runVLMOcrActivity,
  type VLMOcrActivityAbortRef,
} from "./vlmOcrActivity";
import {
  ImageBackgroundProvider,
  normalizeImageBackgroundMode,
  type ImageBackgroundMode,
} from "./imageBackground";
import type {
  ActionPreview,
  AssetItem,
  CatalogSummary,
  ProjectScanIntent,
  ScanEvent,
} from "./types";
import { fileName, modeForPath, pathForMode, type Mode } from "./ui";
import { clearEstimateCaches } from "./components/optimizeCache";

type PreviewState = { endpoint: string; token: string; value: ActionPreview };
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

const emptyCatalogSummary: CatalogSummary = {
  generatedAt: "",
  projects: [],
  projectStats: [],
  stats: {
    totalFiles: 0,
    duplicateGroups: 0,
    duplicateFiles: 0,
    unusedFiles: 0,
    nearDuplicates: 0,
    lintFindings: 0,
    cacheHits: 0,
  },
  analysis: {
    references: "notComputed",
    nearDuplicates: "notComputed",
    optimization: "notComputed",
  },
};
const IMAGE_BACKGROUND_STORAGE_KEY = "aisets-image-background";
const BROWSE_STATE_STORAGE_KEY = "aisets-browse-state";
const SCAN_COMPLETE_DISMISS_MS = 1200;
const SCAN_ERROR_DISMISS_MS = 3500;

function storedThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem("aisets-theme");
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
  const queryClient = useQueryClient();
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
  const [ocrActivity, dispatchOCRActivity] = useReducer(
    ocrActivityReducer,
    initialOCRActivityState,
  );
  const ocrActivityAbortRef = useRef<AbortController | null>(null);
  const ocrActivityRunRef = useRef<Promise<void> | null>(null);
  const [aiTagActivity, dispatchAITagActivity] = useReducer(
    aiTagActivityReducer,
    initialAITagActivityState,
  );
  const aiTagActivityAbortRef = useRef<AbortController | null>(null);
  const aiTagActivityRunRef = useRef<Promise<void> | null>(null);
  const [vlmOcrActivity, dispatchVLMOcr] = useReducer(
    vlmOcrActivityReducer,
    initialVLMOcrActivityState,
  );
  const vlmOcrAbortRef = useRef<AbortController | null>(
    null,
  ) as VLMOcrActivityAbortRef;
  const vlmOcrRunRef = useRef<Promise<void> | null>(null);
  const [optimizeActivity, dispatchOptimizeActivity] = useReducer(
    optimizeActivityReducer,
    initialOptimizeActivityState,
  );
  const [optimizeLockedIds, setOptimizeLockedIds] = useState<string[] | null>(
    null,
  );
  const optimizeActivityAbortRef = useRef<AbortController | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(storedThemePreference);
  const [imagePreviewEnabled, setImagePreviewEnabled] = useState(() => {
    return window.localStorage.getItem("aisets-image-preview") !== "off";
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
  const scanStatusQuery = useScanStatusQuery(!scanMutation.isPending);
  const observedScanIdRef = useRef(0);
  const wasPollingScanRef = useRef(false);
  useEffect(() => {
    const status = scanStatusQuery.data;
    if (scanMutation.isPending || !status) return undefined;
    let cancelled = false;
    if (status.running) {
      wasPollingScanRef.current = true;
      queueMicrotask(() => {
        if (cancelled) return;
        setScanProgress({
          type: "progress",
          phase: status.phase,
          current: status.current,
          total: status.total,
          message: status.message,
          state: status.state,
          reason: status.reason,
        });
        setScanProgressVisible(true);
      });
    } else if (status.scanId && status.scanId !== observedScanIdRef.current) {
      observedScanIdRef.current = status.scanId;
      const showCompletion = wasPollingScanRef.current;
      wasPollingScanRef.current = false;
      queueMicrotask(() => {
        if (cancelled) return;
        if (showCompletion) {
          setScanProgress({ type: "done", scanId: status.scanId });
          setScanProgressVisible(true);
        }
        void queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [scanStatusQuery.data, scanMutation.isPending, queryClient]);
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
    window.localStorage.setItem("aisets-theme", theme);

    if (theme !== "system") return undefined;

    const media = window.matchMedia(SYSTEM_THEME_QUERY);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "aisets-image-preview",
      imagePreviewEnabled ? "on" : "off",
    );
  }, [imagePreviewEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_BACKGROUND_STORAGE_KEY,
      imageBackgroundMode,
    );
  }, [imageBackgroundMode]);

  const anyAIBusy =
    isAITagActivityBusy(aiTagActivity) || isVLMOcrActivityBusy(vlmOcrActivity);
  useEffect(() => {
    if (!anyAIBusy) return undefined;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyAIBusy]);

  useEffect(() => {
    if (scanMutation.isPending) return undefined;
    if (!scanProgressVisible) return undefined;
    if (scanProgress?.type === "progress") return undefined;

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

  const selectedProject = useMemo(() => {
    return (
      catalogSummary?.projects.find(
        (project) => project.id === effectiveSelectedProjectId,
      ) ?? null
    );
  }, [catalogSummary, effectiveSelectedProjectId]);

  const selectedProjectStats = useMemo(() => {
    if (!catalogSummary || !effectiveSelectedProjectId) return null;
    return (
      catalogSummary.projectStats.find(
        (stat) => stat.projectId === effectiveSelectedProjectId,
      ) ?? null
    );
  }, [catalogSummary, effectiveSelectedProjectId]);

  const projectAssetCounts = useMemo(
    () =>
      new Map(
        catalogSummary?.projectStats.map((stat) => [
          stat.projectId,
          stat.totalFiles,
        ]),
      ),
    [catalogSummary?.projectStats],
  );

  const projectSwitchProjects = useMemo(() => {
    return (catalogSummary?.projects ?? []).map((project) => ({
      ...project,
      assetCount: projectAssetCounts.get(project.id) ?? 0,
    }));
  }, [catalogSummary?.projects, projectAssetCounts]);

  const scopedStats = useMemo(
    () => scopedStatsForProject(catalogSummary, selectedProjectStats),
    [catalogSummary, selectedProjectStats],
  );
  const optimizeCount = optimizableBadgeCount(
    catalogSummary,
    selectedProjectStats,
    0,
  );
  const badges = navigationBadges(catalogSummary, scopedStats, optimizeCount);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (autoScanStartedRef.current || !settings || !catalogSummary) return;
    if (!settings.scanOnOpen) return;
    if (catalogSummary.projects.length === 0) return;
    if (scanStatusQuery.data?.running) return;

    autoScanStartedRef.current = true;
    scanMutation.mutate(undefined, {
      onError: (error) => {
        if (!isScanAlreadyRunningError(error)) toast.error(errorMessage(error));
      },
    });
  }, [
    catalogSummary,
    scanMutation,
    scanStatusQuery.data?.running,
    settingsQuery.data?.settings,
    toast,
  ]);

  const backendScanRunning = scanStatusQuery.data?.running ?? false;
  const displayedScanProgress: ScanEvent | null =
    backendScanRunning && scanStatusQuery.data
      ? {
          type: "progress",
          phase: scanStatusQuery.data.phase,
          current: scanStatusQuery.data.current,
          total: scanStatusQuery.data.total,
          message: scanStatusQuery.data.message,
          state: scanStatusQuery.data.state,
          reason: scanStatusQuery.data.reason,
        }
      : scanProgressVisible
        ? scanProgress
        : null;
  const scanBusy = scanMutation.isPending || backendScanRunning;
  const working =
    catalogQuery.isFetching ||
    scanBusy ||
    addProjectMutation.isPending ||
    switchWorkspaceMutation.isPending;
  const ocrActivityBusy = isOCRActivityBusy(ocrActivity);
  const optimizeActivityBusy = isOptimizeActivityBusy(optimizeActivity);
  const catalogActionsDisabled =
    working || ocrActivityBusy || optimizeActivityBusy;
  const workspaceSwitchDisabled =
    scanBusy || ocrActivityBusy || optimizeActivityBusy;
  const workspaceSwitchDisabledTooltip = scanBusy
    ? t("activity.scanLockedTooltip")
    : ocrActivityBusy
      ? t("activity.ocrLockedTooltip")
      : optimizeActivityBusy
        ? t("activity.optimizeLockedTooltip")
        : undefined;
  const workspaceName =
    settingsQuery.data?.settings.workspaceName ?? t("projects.workspaceName");
  const ocrEnabled = settingsQuery.data?.settings.ocrEnabled ?? false;
  const ocrFuzzySearch = settingsQuery.data?.settings.ocrFuzzySearch ?? true;
  const activeWorkspaceId =
    settingsQuery.data?.settings.activeWorkspaceId ?? "default";
  const workspaces = settingsQuery.data?.settings.workspaces ?? [
    { id: activeWorkspaceId, name: workspaceName, projectCount: 0 },
  ];

  const drawerDetailQuery = useCatalogItemDetailQuery(
    catalogSummary?.scanId,
    drawerId,
    drawerId !== "",
  );
  const drawerAsset = drawerId
    ? (drawerDetailQuery.data?.item ??
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
  if (scanMutation.error && !isScanAlreadyRunningError(scanMutation.error))
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

  function onAddProject(path: string, scanIntent: ProjectScanIntent) {
    if (backendScanRunning || ocrActivityBusy || optimizeActivityBusy) return;
    addProjectMutation.mutate(
      { path, scanIntent },
      {
        onSuccess: (result) => {
          const addResult = result.result;
          const projectPath = addResult?.project.path ?? path;
          setDirectoryPickerOpen(false);
          if (addResult?.status === "existing") {
            toast.info(t("toast.projectAlreadyExists", { path: projectPath }));
            return;
          }
          toast.success(
            t(
              addResult?.status === "restored"
                ? "toast.projectRestored"
                : "toast.projectAdded",
              { path: projectPath },
            ),
          );
          clearEstimateCaches();
          setScanProgress(null);
          setScanProgressVisible(true);
          scanMutation.mutate(undefined, {
            onError: (e) => {
              if (!isScanAlreadyRunningError(e)) toast.error(errorMessage(e));
            },
          });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  function onSwitchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    if (ocrActivityBusy || optimizeActivityBusy) return;
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

  function onStartOCRActivity(saveSettings: () => Promise<void>) {
    if (ocrActivityRunRef.current) return;

    const run = (async () => {
      const result = await runOCRActivity({
        abortRef: ocrActivityAbortRef,
        dispatch: dispatchOCRActivity,
        saveSettings,
        runBatch: ({ signal, onEvent }) => runOCR({ signal, onEvent }),
      });

      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });

      if (result.status === "done") {
        toast.success(t("settings.ocrRunSuccess"));
      } else if (result.status === "stopped") {
        toast.info(t("settings.ocrRunStopped"));
      } else {
        toast.error(result.errorMessage, {
          title: t("settings.ocrRunFailed"),
        });
      }
    })().finally(() => {
      ocrActivityRunRef.current = null;
    });

    ocrActivityRunRef.current = run;
  }

  function onStopOCRActivity() {
    if (!ocrActivityAbortRef.current) return;
    dispatchOCRActivity({ type: "stopping" });
    ocrActivityAbortRef.current?.abort();
  }

  function onDismissOCRActivity() {
    dispatchOCRActivity({ type: "dismiss" });
  }

  function onStartAITagActivity(
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
    assetIds?: string[],
    scopeLabel?: string,
  ) {
    if (aiTagActivityRunRef.current) return;

    const run = (async () => {
      await runAITagActivity({
        abortRef: aiTagActivityAbortRef,
        dispatch: dispatchAITagActivity,
        saveSettings,
        run: ({ signal, onEvent }) =>
          runAITagging({ signal, onEvent, presetId, projectIds, assetIds }),
        scopeLabel,
      });

      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
    })().finally(() => {
      aiTagActivityRunRef.current = null;
    });

    aiTagActivityRunRef.current = run;
  }

  function onStopAITagActivity() {
    if (!aiTagActivityAbortRef.current) return;
    dispatchAITagActivity({ type: "stopping" });
    aiTagActivityAbortRef.current.abort();
  }

  function onDismissAITagActivity() {
    dispatchAITagActivity({ type: "dismiss" });
  }

  function onStartVLMOcrActivity(
    saveSettings: () => Promise<void>,
    presetId?: string,
    projectIds?: string[],
    assetIds?: string[],
    scopeLabel?: string,
  ) {
    if (vlmOcrRunRef.current) return;

    const run = (async () => {
      await runVLMOcrActivity({
        abortRef: vlmOcrAbortRef,
        dispatch: dispatchVLMOcr,
        saveSettings,
        run: ({ signal, onEvent }) =>
          runVLMOcr({ signal, onEvent, presetId, projectIds, assetIds }),
        scopeLabel,
      });

      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
    })().finally(() => {
      vlmOcrRunRef.current = null;
    });

    vlmOcrRunRef.current = run;
  }

  function onStopVLMOcrActivity() {
    if (!vlmOcrAbortRef.current) return;
    dispatchVLMOcr({ type: "stopping" });
    vlmOcrAbortRef.current.abort();
  }

  function onDismissVLMOcrActivity() {
    dispatchVLMOcr({ type: "dismiss" });
  }

  function onOpenOCRSettings() {
    navigate({
      pathname: pathForMode("settings"),
      search: "?section=scanning",
    });
  }

  function onStopOptimizeActivity() {
    if (!optimizeActivityAbortRef.current) return;
    dispatchOptimizeActivity({ type: "stopping" });
    optimizeActivityAbortRef.current.abort();
  }

  function onDismissOptimizeActivity() {
    setOptimizeLockedIds(null);
    dispatchOptimizeActivity({ type: "dismiss" });
  }

  function onOpenOptimize() {
    navigate(pathForMode("optimize"));
  }

  function onRescan() {
    if (backendScanRunning || ocrActivityBusy || optimizeActivityBusy) return;
    clearEstimateCaches();
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(undefined, {
      onError: (e) => {
        if (!isScanAlreadyRunningError(e)) toast.error(errorMessage(e));
      },
    });
  }

  function onFullScan() {
    if (backendScanRunning || ocrActivityBusy || optimizeActivityBusy) return;
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(
      { profile: "full" },
      {
        onError: (e) => {
          if (!isScanAlreadyRunningError(e)) toast.error(errorMessage(e));
        },
      },
    );
  }

  function onNearDuplicateScan() {
    if (backendScanRunning || ocrActivityBusy || optimizeActivityBusy) return;
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(
      {
        profile: "custom",
        analyses: {
          references: true,
          nearDuplicates: true,
          optimization: true,
        },
      },
      {
        onError: (e) => {
          if (!isScanAlreadyRunningError(e)) toast.error(errorMessage(e));
        },
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
    if (ocrActivityBusy) {
      toast.info(t("activity.ocrLockedAction"));
      return;
    }
    if (optimizeActivityBusy) {
      toast.info(t("activity.optimizeLockedTooltip"));
      return;
    }
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

  const appShell = (
    <main className="grid h-screen w-screen grid-cols-[240px_1fr] grid-rows-[60px_1fr] bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)] max-[960px]:grid-cols-[64px_1fr]">
      <div className="col-span-2 row-start-1">
        <AppTopbar
          working={working}
          catalogActionsDisabled={catalogActionsDisabled}
          scanProgress={displayedScanProgress}
          ocrActivity={ocrActivity}
          aiTagActivity={aiTagActivity}
          vlmOcrActivity={vlmOcrActivity}
          optimizeActivity={optimizeActivity}
          onAddProject={() => setDirectoryPickerOpen(true)}
          onRefresh={onRescan}
          onOpenCmdK={() => setCmdkOpen(true)}
          onStopOCR={onStopOCRActivity}
          onDismissOCR={onDismissOCRActivity}
          onOpenOCRSettings={onOpenOCRSettings}
          onStopAITag={onStopAITagActivity}
          onDismissAITag={onDismissAITagActivity}
          onStopVLMOcr={onStopVLMOcrActivity}
          onDismissVLMOcr={onDismissVLMOcrActivity}
          onOpenAISettings={() => {
            navigate({
              pathname: pathForMode("settings"),
              search: "?section=ai",
            });
          }}
          onStopOptimize={onStopOptimizeActivity}
          onDismissOptimize={onDismissOptimizeActivity}
          onOpenOptimize={onOpenOptimize}
          onOpenSettings={() => navigate({ pathname: pathForMode("settings") })}
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
        totalAssets={catalogSummary?.stats.totalFiles ?? 0}
        lastScanAt={catalogSummary?.generatedAt}
        lastScanStartedAt={catalogSummary?.startedAt}
        workspaceSwitchDisabled={workspaceSwitchDisabled}
        workspaceSwitchDisabledTooltip={workspaceSwitchDisabledTooltip}
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
              activeAssetId={drawerId}
              autoScrollAssetId={autoScrollAssetId}
              initialCustomFilterId={browseCustomFilterId}
              initialSearchQuery={browseInitialSearch}
              initialFocusAssetId={browseFocusAssetId}
              customFilters={
                settingsQuery.data?.settings.customAssetFilters ?? []
              }
              scanId={catalogSummary?.scanId}
              projectFilterId={effectiveSelectedProjectId || undefined}
              projectFilterName={selectedProject?.name ?? ""}
              imagePreviewEnabled={imagePreviewEnabled}
              ocrEnabled={ocrEnabled}
              ocrFuzzySearch={ocrFuzzySearch}
              stats={scopedStats}
              onAutoScrollDone={clearAutoScrollAssetId}
              onOpenAsset={setDrawerId}
              aiEnabled={settingsQuery.data?.settings.llmEnabled ?? false}
              aiBusy={anyAIBusy}
              onStartAITag={(assetIds) =>
                onStartAITagActivity(
                  async () => {},
                  undefined,
                  undefined,
                  assetIds,
                )
              }
              onStartVLMOcr={(assetIds) =>
                onStartVLMOcrActivity(
                  async () => {},
                  undefined,
                  undefined,
                  assetIds,
                )
              }
            />
          ) : mode === "settings" ? (
            <SettingsView
              theme={theme}
              imagePreviewEnabled={imagePreviewEnabled}
              imageBackgroundMode={imageBackgroundMode}
              ocrActivity={ocrActivity}
              aiTagActivity={aiTagActivity}
              vlmOcrActivity={vlmOcrActivity}
              scanWorking={backendScanRunning || scanMutation.isPending}
              onThemeChange={setTheme}
              onImagePreviewEnabledChange={setImagePreviewEnabled}
              onImageBackgroundModeChange={setImageBackgroundMode}
              onStartOCR={onStartOCRActivity}
              onStopOCR={onStopOCRActivity}
              onDismissOCR={onDismissOCRActivity}
              onStartAITag={(saveSettings, presetId, projectIds, scopeLabel) =>
                onStartAITagActivity(
                  saveSettings,
                  presetId,
                  projectIds,
                  undefined,
                  scopeLabel,
                )
              }
              onStopAITag={onStopAITagActivity}
              onDismissAITag={onDismissAITagActivity}
              onStartVLMOcr={(saveSettings, presetId, projectIds, scopeLabel) =>
                onStartVLMOcrActivity(
                  saveSettings,
                  presetId,
                  projectIds,
                  undefined,
                  scopeLabel,
                )
              }
              onStopVLMOcr={onStopVLMOcrActivity}
              onDismissVLMOcr={onDismissVLMOcrActivity}
              onAddProject={() => setDirectoryPickerOpen(true)}
              onNavigate={changeMode}
            />
          ) : mode === "duplicates" && catalogSummary ? (
            catalogSummary.analysis.nearDuplicates === "notComputed" ? (
              <div
                key="duplicates-not-computed"
                className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pt-0 max-[768px]:pb-8"
              >
                {displayedScanProgress ? (
                  <ScanProgressState scanProgress={displayedScanProgress} />
                ) : (
                  <NotComputedState
                    title={
                      catalogSummary.stats.totalFiles >= 10_000
                        ? t("catalog.notComputed.nearSkippedTitle")
                        : t("catalog.notComputed.nearTitle")
                    }
                    description={
                      catalogSummary.stats.totalFiles >= 10_000
                        ? t("catalog.notComputed.nearSkippedDesc", {
                            count: catalogSummary.stats.totalFiles,
                          })
                        : t("catalog.notComputed.nearDesc")
                    }
                    action={
                      catalogSummary.stats.totalFiles >= 10_000
                        ? t("catalog.notComputed.nearSkippedAction")
                        : t("catalog.notComputed.fullScan")
                    }
                    onAction={
                      catalogSummary.stats.totalFiles >= 10_000
                        ? onNearDuplicateScan
                        : onFullScan
                    }
                  />
                )}
              </div>
            ) : (
              <DuplicatesView
                scanId={catalogSummary.scanId}
                projectFilterName={selectedProject?.name ?? ""}
                onOpenAsset={setDrawerId}
              />
            )
          ) : mode === "lint" ? (
            <LintView
              scanId={catalogSummary?.scanId}
              projectFilterId={effectiveSelectedProjectId || undefined}
              projectFilterName={selectedProject?.name ?? ""}
              stats={scopedStats}
              onOpenAsset={setDrawerId}
            />
          ) : mode === "optimize" ? (
            catalogSummary?.analysis.optimization === "notComputed" ? (
              <div
                key="optimization-not-computed"
                className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pt-0 max-[768px]:pb-8"
              >
                {displayedScanProgress ? (
                  <ScanProgressState scanProgress={displayedScanProgress} />
                ) : (
                  <NotComputedState
                    title={t("catalog.notComputed.optimizationTitle")}
                    description={t("catalog.notComputed.optimizationDesc")}
                    action={t("catalog.notComputed.fullScan")}
                    onAction={onFullScan}
                  />
                )}
              </div>
            ) : (
              <OptimizeView
                scanId={catalogSummary?.scanId}
                projectFilterId={effectiveSelectedProjectId || undefined}
                projectFilterName={selectedProject?.name ?? ""}
                optimizeAbortRef={optimizeActivityAbortRef}
                optimizeLockedIds={optimizeLockedIds}
                optimizeActivity={optimizeActivity}
                onOptimizeActivity={dispatchOptimizeActivity}
                onOptimizeLockIds={setOptimizeLockedIds}
                onOpenAsset={setDrawerId}
              />
            )
          ) : mode === "history" ? (
            <ScanHistoryView />
          ) : mode === "prompts" ? (
            <PromptsView />
          ) : (
            <div
              key={mode}
              className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pt-0 max-[768px]:pb-8"
            >
              {mode === "precheck" ? (
                <PreCheckView onOpenAsset={setDrawerId} />
              ) : mode === "projects" ? (
                <ProjectsView
                  catalog={catalogSummary ?? emptyCatalogSummary}
                  scanProgress={displayedScanProgress}
                  onJump={changeMode}
                  onAddProject={() => setDirectoryPickerOpen(true)}
                />
              ) : null}
            </div>
          )}
        </div>
      </section>

      <ScrollToTop key={mode} />

      {drawerAsset && (
        <AssetDrawer
          key={drawerAsset.id}
          asset={drawerAsset}
          assetIds={[drawerAsset.id]}
          scanId={catalogSummary?.scanId}
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
        scanId={catalogSummary?.scanId}
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
          working={addProjectMutation.isPending || backendScanRunning}
          disabledReason={
            backendScanRunning
              ? t("error.scan_already_running")
              : ocrActivityBusy
                ? t("directoryPicker.addDisabledOcrBusy")
                : optimizeActivityBusy
                  ? t("activity.optimizeLockedTooltip")
                  : undefined
          }
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
          working={
            applyPreviewMutation.isPending ||
            ocrActivityBusy ||
            optimizeActivityBusy
          }
          onCancel={() => setPreview(null)}
          onApply={onApplyPreview}
        />
      )}
    </main>
  );

  if (mode === "unused") {
    try {
      const raw = localStorage.getItem("aisets-browse-state");
      const state = raw ? JSON.parse(raw) : {};
      state.statusFilter = "unused";
      localStorage.setItem("aisets-browse-state", JSON.stringify(state));
    } catch {
      /* ignore */
    }
    return <Navigate to="/browse" replace />;
  }

  return (
    <ImageBackgroundProvider
      mode={imageBackgroundMode}
      onModeChange={setImageBackgroundMode}
    >
      {appShell}
    </ImageBackgroundProvider>
  );
}

function isScanAlreadyRunningError(error: unknown) {
  return error instanceof APIError && error.code === "scan_already_running";
}

function ScanProgressState({ scanProgress }: { scanProgress: ScanEvent }) {
  if (scanProgress.type !== "progress") return null;
  return (
    <div className="flex flex-1 items-start justify-end px-6 py-20">
      <ScanProgressContent scanProgress={scanProgress} className="max-w-md" />
    </div>
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
  action?: string;
  onAction?: () => void;
}) {
  return (
    <EmptyState
      tone="neutral"
      title={title}
      description={description}
      action={
        action && onAction ? (
          <Button variant="secondary" onClick={onAction}>
            {action}
          </Button>
        ) : undefined
      }
    />
  );
}

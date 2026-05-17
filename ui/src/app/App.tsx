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
} from "@/appScope";
import { AppTopbar } from "@/components/shared/AppTopbar";
import { AssetDrawer } from "@/features/drawer";
import { BrowseView } from "@/features/browse";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { ProjectsView } from "@/components/project/ProjectsView";
import { DirectoryPickerModal } from "@/components/project/DirectoryPickerModal";
import { DuplicatesView } from "@/features/duplicates";
import { LintView } from "@/features/lint";
import { NavSidebar } from "@/components/shared/NavSidebar";
import { AICanvasView } from "@/features/ai-canvas";
import { ImageToolsView } from "@/features/image-tools";
import { OptimizeView } from "@/features/optimize";
import { PreCheckView } from "@/features/scan";
import { PromptsView } from "@/components/prompts/PromptsView";
import { PreviewModal } from "@/components/shared/PreviewModal";
import { ScrollToTop } from "@/components/shared/ScrollToTop";
import { ScanHistoryView } from "@/features/scan";
import { TagsView } from "@/features/tags";
import {
  Button,
  EmptyState,
  NoticeStack,
  PromptDialog,
  ScanProgressContent,
} from "@/components/ui";
import { SettingsView } from "@/features/settings";
import { useToast } from "@/components/shared/ToastProvider";
import {
  catalogQueryKey,
  embedStatsQueryKey,
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
  useUpdateSettingsMutation,
  useVersionPollQuery,
} from "@/queries";
import {
  APIError,
  runOCR,
  runAITagging,
  runVLMOcr,
  runEmbedding,
  runAITagTranslate,
} from "@/api";
import { errorMessage } from "@/i18n";
import { cn } from "@/lib/cn";
import {
  initialOCRActivityState,
  isOCRActivityBusy,
  ocrActivityReducer,
  runOCRActivity,
} from "@/activity/ocrActivity";
import {
  initialOptimizeActivityState,
  isOptimizeActivityBusy,
  optimizeActivityReducer,
} from "@/activity/optimizeActivity";
import {
  initialAITagActivityState,
  aiTagActivityReducer,
  isAITagActivityBusy,
  runAITagActivity,
} from "@/activity/aiTagActivity";
import {
  initialVLMOcrActivityState,
  isVLMOcrActivityBusy,
  vlmOcrActivityReducer,
  runVLMOcrActivity,
  type VLMOcrActivityAbortRef,
} from "@/activity/vlmOcrActivity";
import {
  initialEmbedActivityState,
  isEmbedActivityBusy,
  embedActivityReducer,
  runEmbedActivity,
} from "@/activity/embedActivity";
import {
  initialTranslateActivityState,
  isTranslateActivityBusy,
  translateActivityReducer,
  runTranslateActivity,
  type TranslateActivityAbortRef,
} from "@/activity/translateActivity";
import {
  ImageBackgroundProvider,
  normalizeImageBackgroundMode,
  type ImageBackgroundMode,
} from "@/imageBackground";
import type {
  ActionPreview,
  AssetItem,
  CatalogSummary,
  ProjectScanIntent,
  ScanEvent,
  SettingsInfo,
} from "@/types";
import {
  clearBrowseSearchParams,
  drawerSearchParams,
  fileName,
  modeForPath,
  pathForMode,
  type Mode,
} from "@/ui";
import { clearEstimateCaches } from "@/features/optimize";
import {
  animateImageToolBasket,
  mergeImageToolBasket,
  readImageToolBasket,
  writeImageToolBasket,
} from "@/imageToolsBasket";

type PreviewState = { endpoint: string; token: string; value: ActionPreview };
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type ImagePreviewSize = { width: number; height: number };
type BrowseRouteState = {
  browseSearchMode?: "catalog" | "semantic";
  browseSearchQuery?: string;
  browseAssetId?: string;
  browseFocusAssetId?: string;
};

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
const IMAGE_PREVIEW_DELAY_STORAGE_KEY = "aisets-image-preview-delay-seconds";
const IMAGE_PREVIEW_SIZE_STORAGE_KEY = "aisets-image-preview-size";
const DEFAULT_IMAGE_PREVIEW_DELAY_SECONDS = 1;
const DEFAULT_IMAGE_PREVIEW_SIZE: ImagePreviewSize = {
  width: 320,
  height: 260,
};
const BROWSE_STATE_STORAGE_KEY = "aisets-browse-state";
const SCAN_COMPLETE_DISMISS_MS = 1200;
const SCAN_ERROR_DISMISS_MS = 3500;

function agentAdapterLabel(id: string) {
  switch (id) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor-agent":
      return "Cursor Agent";
    case "gemini":
      return "Gemini";
    case "copilot":
      return "Copilot";
    case "pi":
      return "Pi";
    default:
      return id;
  }
}

function canvasBackendLabel(
  settings?: SettingsInfo,
  unavailableLabel = "AI not configured",
) {
  if (!settings) return "";
  const backend =
    settings.vlmBackendCanvas || settings.vlmBackend || "local-llm";
  const adapters = settings.agentRuntime?.adapters ?? [];
  if (backend.startsWith("agent:")) {
    const rest = backend.slice("agent:".length);
    const slash = rest.indexOf("/");
    const adapterId = slash >= 0 ? rest.slice(0, slash) : rest;
    const backendModel = slash >= 0 ? rest.slice(slash + 1) : "";
    const adapterName =
      adapters.find((adapter) => adapter.id === adapterId)?.name ??
      agentAdapterLabel(adapterId);
    const model = backendModel || settings.agentModel;
    return model ? `${adapterName} ${model}` : adapterName;
  }
  const localModel = backend.startsWith("local-llm/")
    ? backend.slice("local-llm/".length)
    : settings.llmVisionModel || settings.llmRuntime?.visionModel || "";
  const provider = settings.llmProvider || "LLM";
  if (!localModel && !settings.llmRuntime?.connected && !settings.llmEnabled) {
    return unavailableLabel;
  }
  return localModel ? `${provider} ${localModel}` : provider;
}

type CanvasBackendOption = {
  value: string;
  label: string;
  group: string;
  disabled?: boolean;
};

type CanvasBackendLabels = {
  canvas: string;
  defaultOption: string;
  llm: string;
  localLLM: string;
  agent: string;
  unavailable: string;
  configureLLM: string;
  configureAgent: string;
};

function canvasBackendOptions(
  settings: SettingsInfo | undefined,
  labels: CanvasBackendLabels,
): CanvasBackendOption[] {
  if (!settings) return [];
  const options: CanvasBackendOption[] = [];
  const llmModels = Array.isArray(settings.llmRuntime?.models)
    ? settings.llmRuntime.models
    : [];
  const adapters = (settings.agentRuntime?.adapters ?? []).filter(
    (adapter) => adapter.id !== "local-llm",
  );
  const inherited = canvasBackendLabel(
    { ...settings, vlmBackendCanvas: "" },
    labels.unavailable,
  );
  options.push({
    value: "",
    label: inherited
      ? `${labels.defaultOption} · ${inherited}`
      : labels.defaultOption,
    group: labels.canvas,
    disabled: inherited === labels.unavailable,
  });

  const localDefault =
    settings.llmVisionModel || settings.llmRuntime?.visionModel || "";
  if (settings.llmRuntime?.connected || localDefault) {
    options.push({
      value: "local-llm",
      label: localDefault ? `${labels.llm} · ${localDefault}` : labels.localLLM,
      group: labels.llm,
    });
  }
  for (const model of llmModels) {
    options.push({
      value: `local-llm/${model.name}`,
      label: model.name,
      group: labels.llm,
    });
  }
  if (
    llmModels.length === 0 &&
    !settings.llmRuntime?.connected &&
    !localDefault
  ) {
    options.push({
      value: "local-llm-unavailable",
      label: labels.configureLLM,
      group: labels.llm,
      disabled: true,
    });
  }

  for (const adapter of adapters) {
    options.push({
      value: `agent:${adapter.id}`,
      label: adapter.name || agentAdapterLabel(adapter.id),
      group: labels.agent,
    });
  }
  if (adapters.length === 0) {
    options.push({
      value: "agent-unavailable",
      label: labels.configureAgent,
      group: labels.agent,
      disabled: true,
    });
  }
  return options;
}

function browseRouteState(value: unknown): BrowseRouteState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = value as Record<string, unknown>;
  return {
    browseSearchMode:
      state.browseSearchMode === "semantic" ? "semantic" : undefined,
    browseSearchQuery:
      typeof state.browseSearchQuery === "string"
        ? state.browseSearchQuery
        : undefined,
    browseAssetId:
      typeof state.browseAssetId === "string" ? state.browseAssetId : undefined,
    browseFocusAssetId:
      typeof state.browseFocusAssetId === "string"
        ? state.browseFocusAssetId
        : undefined,
  };
}

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

function normalizeImagePreviewDelaySeconds(value: unknown) {
  if (value == null || value === "") return DEFAULT_IMAGE_PREVIEW_DELAY_SECONDS;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_IMAGE_PREVIEW_DELAY_SECONDS;
  }
  return parsed;
}

function storedImagePreviewDelaySeconds() {
  return normalizeImagePreviewDelaySeconds(
    window.localStorage.getItem(IMAGE_PREVIEW_DELAY_STORAGE_KEY),
  );
}

function normalizeImagePreviewDimension(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(80, Math.round(parsed));
}

function normalizeImagePreviewSize(value: unknown): ImagePreviewSize {
  if (value && typeof value === "object") {
    const maybe = value as Partial<ImagePreviewSize>;
    return {
      width: normalizeImagePreviewDimension(
        maybe.width,
        DEFAULT_IMAGE_PREVIEW_SIZE.width,
      ),
      height: normalizeImagePreviewDimension(
        maybe.height,
        DEFAULT_IMAGE_PREVIEW_SIZE.height,
      ),
    };
  }
  return DEFAULT_IMAGE_PREVIEW_SIZE;
}

function storedImagePreviewSize() {
  try {
    return normalizeImagePreviewSize(
      JSON.parse(
        window.localStorage.getItem(IMAGE_PREVIEW_SIZE_STORAGE_KEY) ?? "null",
      ),
    );
  } catch {
    return DEFAULT_IMAGE_PREVIEW_SIZE;
  }
}

export function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = modeForPath(location.pathname);
  const browseState = browseRouteState(location.state);

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
  const [embedActivity, dispatchEmbedActivity] = useReducer(
    embedActivityReducer,
    initialEmbedActivityState,
  );
  const embedAbortRef = useRef<AbortController | null>(null);
  const embedRunRef = useRef<Promise<void> | null>(null);
  const [translateActivity, dispatchTranslateActivity] = useReducer(
    translateActivityReducer,
    initialTranslateActivityState,
  );
  const translateAbortRef = useRef<AbortController | null>(
    null,
  ) as TranslateActivityAbortRef;
  const translateRunRef = useRef<Promise<void> | null>(null);
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
  const [imagePreviewDelaySeconds, setImagePreviewDelaySeconds] = useState(
    storedImagePreviewDelaySeconds,
  );
  const [imagePreviewSize, setImagePreviewSize] = useState(
    storedImagePreviewSize,
  );
  const [imageBackgroundMode, setImageBackgroundMode] =
    useState<ImageBackgroundMode>(storedImageBackgroundMode);
  const imagePreviewDelayMs = imagePreviewDelaySeconds * 1000;

  const drawerId = searchParams.get("asset") ?? browseState.browseAssetId ?? "";
  const browseCustomFilterId = searchParams.get("customFilter") ?? "";
  const [browseRouteFocusAssetId, setBrowseRouteFocusAssetId] = useState("");
  const browseFocusAssetId =
    searchParams.get("focusAsset") ??
    browseState.browseFocusAssetId ??
    browseRouteFocusAssetId;
  const browseInitialSearch =
    searchParams.get("q") ?? browseState.browseSearchQuery ?? "";
  const browseInitialSearchMode = browseState.browseSearchMode ?? "catalog";
  const browseInitialAICategory = searchParams.get("aiCategory") ?? "";
  const [imageToolAssetIds, setImageToolAssetIds] =
    useState(readImageToolBasket);

  function changeMode(nextMode: Mode, projectId?: string) {
    if (projectId != null) setSelectedProjectId(projectId);
    navigate(pathForMode(nextMode));
  }

  async function addToImageTools(
    assetIds: string[],
    target?: HTMLElement | null,
  ) {
    const next = mergeImageToolBasket(imageToolAssetIds, assetIds);
    setImageToolAssetIds(next);
    await animateImageToolBasket(assetIds, target);
    toast.info(t("imageTools.addedToBasket", { count: assetIds.length }));
  }

  function setImageToolsBasket(assetIds: string[]) {
    setImageToolAssetIds(assetIds);
    writeImageToolBasket(assetIds);
  }

  const setDrawerId = useCallback(
    (id: string) => {
      if (id) {
        setBrowseRouteFocusAssetId("");
      } else {
        setDrawerSeedAsset(null);
      }
      setAutoScrollAssetId("");
      setSearchParams(
        (prev) => {
          return drawerSearchParams(prev, id);
        },
        { replace: true },
      );
    },
    [setAutoScrollAssetId, setDrawerSeedAsset, setSearchParams],
  );

  const clearBrowseSearchRoute = useCallback(() => {
    setSearchParams(
      (prev) => {
        return clearBrowseSearchParams(prev);
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const clearBrowseFocusAsset = useCallback(() => {
    setBrowseRouteFocusAssetId("");
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focusAsset");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    if (browseState.browseFocusAssetId) {
      // Preserve the route-state handoff without changing focus cleanup behavior.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrowseRouteFocusAssetId(browseState.browseFocusAssetId);
    }
  }, [browseState.browseFocusAssetId]);

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
  const versionPollQuery = useVersionPollQuery();
  const updateSettingsMutation = useUpdateSettingsMutation();
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
      IMAGE_PREVIEW_DELAY_STORAGE_KEY,
      String(imagePreviewDelaySeconds),
    );
  }, [imagePreviewDelaySeconds]);

  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_PREVIEW_SIZE_STORAGE_KEY,
      JSON.stringify(imagePreviewSize),
    );
  }, [imagePreviewSize]);

  useEffect(() => {
    window.localStorage.setItem(
      IMAGE_BACKGROUND_STORAGE_KEY,
      imageBackgroundMode,
    );
  }, [imageBackgroundMode]);

  const anyAIBusy =
    isAITagActivityBusy(aiTagActivity) ||
    isVLMOcrActivityBusy(vlmOcrActivity) ||
    isEmbedActivityBusy(embedActivity) ||
    isTranslateActivityBusy(translateActivity);
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
  const badges = navigationBadges(
    catalogSummary,
    scopedStats,
    optimizeCount,
    imageToolAssetIds.length,
  );

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
    working || ocrActivityBusy || optimizeActivityBusy || anyAIBusy;
  const workspaceSwitchDisabled =
    scanBusy || ocrActivityBusy || optimizeActivityBusy || anyAIBusy;
  const workspaceSwitchDisabledTooltip = scanBusy
    ? t("activity.scanLockedTooltip")
    : ocrActivityBusy
      ? t("activity.ocrLockedTooltip")
      : optimizeActivityBusy
        ? t("activity.optimizeLockedTooltip")
        : anyAIBusy
          ? t("activity.aiTagLockedTooltip")
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
        setImageToolsBasket([]);
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

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: embedStatsQueryKey }),
      ]);

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

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: embedStatsQueryKey }),
      ]);
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

  function onStartEmbedActivity(
    projectIds?: string[],
    assetIds?: string[],
    types?: ("text" | "image")[],
    scopeLabel?: string,
    force?: boolean,
  ) {
    if (embedRunRef.current) return;

    const run = (async () => {
      await runEmbedActivity({
        abortRef: embedAbortRef,
        dispatch: dispatchEmbedActivity,
        run: ({ signal, onEvent }) =>
          runEmbedding({ signal, onEvent, projectIds, assetIds, types, force }),
        scopeLabel,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: embedStatsQueryKey }),
      ]);
    })().finally(() => {
      embedRunRef.current = null;
    });

    embedRunRef.current = run;
  }

  function onStopEmbedActivity() {
    if (!embedAbortRef.current) return;
    dispatchEmbedActivity({ type: "stopping" });
    embedAbortRef.current.abort();
  }

  function onDismissEmbedActivity() {
    dispatchEmbedActivity({ type: "dismiss" });
  }

  function onStartTranslateActivity() {
    if (translateRunRef.current) return;

    const run = (async () => {
      await runTranslateActivity({
        abortRef: translateAbortRef,
        dispatch: dispatchTranslateActivity,
        run: ({ signal, onEvent }) => runAITagTranslate({ signal, onEvent }),
      });

      await queryClient.invalidateQueries({ queryKey: ["tags"] });
    })().finally(() => {
      translateRunRef.current = null;
    });

    translateRunRef.current = run;
  }

  function onStopTranslateActivity() {
    if (!translateAbortRef.current) return;
    dispatchTranslateActivity({ type: "stopping" });
    translateAbortRef.current.abort();
  }

  function onDismissTranslateActivity() {
    dispatchTranslateActivity({ type: "dismiss" });
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
    // Only use as seed if fully populated; semantic search results are partial objects
    if (asset.optimizationRecommendations !== undefined) {
      setDrawerSeedAsset(asset);
    }
    setAutoScrollAssetId(asset.id);
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  function openSemanticResultFromPalette(result: {
    assetId: string;
    repoPath: string;
  }) {
    setSelectedProjectId("");
    setDrawerSeedAsset(null);
    setAutoScrollAssetId(result.assetId);
    setBrowseRouteFocusAssetId(result.assetId);
    navigate(pathForMode("browse"), {
      state: {
        browseAssetId: result.assetId,
        browseFocusAssetId: result.assetId,
      } satisfies BrowseRouteState,
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

  const canvasMode = mode === "aiCanvas";

  const appShell = (
    <main
      className={cn(
        "grid h-screen w-screen bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)]",
        canvasMode
          ? "grid-cols-1 grid-rows-1"
          : "grid-cols-[240px_1fr] grid-rows-[60px_1fr] max-[960px]:grid-cols-[64px_1fr]",
      )}
    >
      <div className={canvasMode ? "hidden" : "col-span-2 row-start-1 z-[100]"}>
        <AppTopbar
          working={working}
          catalogActionsDisabled={catalogActionsDisabled}
          scanProgress={displayedScanProgress}
          ocrActivity={ocrActivity}
          aiTagActivity={aiTagActivity}
          vlmOcrActivity={vlmOcrActivity}
          embedActivity={embedActivity}
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
          onStopEmbed={onStopEmbedActivity}
          onDismissEmbed={onDismissEmbedActivity}
          translateActivity={translateActivity}
          onStopTranslate={onStopTranslateActivity}
          onDismissTranslate={onDismissTranslateActivity}
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
      <div className={canvasMode ? "hidden" : "contents"}>
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
          currentVersion={versionPollQuery.data?.currentVersion}
          updateAvailable={versionPollQuery.data?.updateAvailable}
          latestVersion={versionPollQuery.data?.latestVersion}
          workspaceSwitchDisabled={workspaceSwitchDisabled}
          workspaceSwitchDisabledTooltip={workspaceSwitchDisabledTooltip}
          onSelectWorkspace={onSwitchWorkspace}
          onSelectProject={setSelectedProjectId}
          onSelect={changeMode}
        />
      </div>
      <section className="flex flex-col overflow-hidden bg-transparent">
        <NoticeStack items={notices} />

        <div className="flex flex-1 overflow-hidden">
          {mode === "browse" ? (
            <BrowseView
              key={
                selectedProject
                  ? `${selectedProject.id}:${selectedProject.name}:${browseCustomFilterId}:${browseFocusAssetId}:${browseInitialSearch}:${browseInitialSearchMode}:${browseInitialAICategory}`
                  : `all-projects:${browseCustomFilterId}:${browseFocusAssetId}:${browseInitialSearch}:${browseInitialSearchMode}:${browseInitialAICategory}`
              }
              activeAssetId={drawerId}
              autoScrollAssetId={autoScrollAssetId}
              initialCustomFilterId={browseCustomFilterId}
              initialSearchQuery={browseInitialSearch}
              initialSearchMode={browseInitialSearchMode}
              initialAICategory={browseInitialAICategory}
              initialFocusAssetId={browseFocusAssetId}
              customFilters={
                settingsQuery.data?.settings.customAssetFilters ?? []
              }
              scanId={catalogSummary?.scanId}
              projectFilterId={effectiveSelectedProjectId || undefined}
              projectFilterName={selectedProject?.name ?? ""}
              imagePreviewEnabled={imagePreviewEnabled}
              imagePreviewDelayMs={imagePreviewDelayMs}
              imagePreviewSize={imagePreviewSize}
              ocrEnabled={ocrEnabled}
              ocrFuzzySearch={ocrFuzzySearch}
              stats={scopedStats}
              onAutoScrollDone={clearAutoScrollAssetId}
              onClearFocusAsset={clearBrowseFocusAsset}
              onClearSearchRoute={clearBrowseSearchRoute}
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
              onAddToImageTools={addToImageTools}
            />
          ) : mode === "imageTools" ? (
            <ImageToolsView
              key={activeWorkspaceId}
              scanId={catalogSummary?.scanId}
              assetIds={imageToolAssetIds}
              onAssetIdsChange={setImageToolsBasket}
            />
          ) : mode === "aiCanvas" ? (
            <AICanvasView
              key={activeWorkspaceId}
              scanId={catalogSummary?.scanId}
              aiEnabled={settingsQuery.data?.settings.llmEnabled ?? false}
              aiNickname={settingsQuery.data?.settings.aiNickname || ""}
              aiBackendLabel={canvasBackendLabel(
                settingsQuery.data?.settings,
                t("aiCanvas.backendUnavailable"),
              )}
              aiBackendValue={
                settingsQuery.data?.settings.vlmBackendCanvas ?? ""
              }
              aiBackendOptions={canvasBackendOptions(
                settingsQuery.data?.settings,
                {
                  canvas: t("aiCanvas.backendGroupCanvas"),
                  defaultOption: t("aiCanvas.backendDefault"),
                  llm: t("aiCanvas.backendGroupLLM"),
                  localLLM: t("aiCanvas.backendLocalLLM"),
                  agent: t("aiCanvas.backendGroupAgent"),
                  unavailable: t("aiCanvas.backendUnavailable"),
                  configureLLM: t("aiCanvas.backendConfigureLLM"),
                  configureAgent: t("aiCanvas.backendConfigureAgent"),
                },
              )}
              aiBackendPending={updateSettingsMutation.isPending}
              onAiBackendChange={(value) =>
                updateSettingsMutation.mutate(
                  { vlmBackendCanvas: value },
                  {
                    onSuccess: () => toast.success(t("toast.settingsSaved")),
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                )
              }
              onOpenAsset={setDrawerId}
              onExitCanvas={() => changeMode("browse")}
            />
          ) : mode === "settings" ? (
            <SettingsView
              theme={theme}
              imagePreviewEnabled={imagePreviewEnabled}
              imagePreviewDelaySeconds={imagePreviewDelaySeconds}
              imagePreviewSize={imagePreviewSize}
              imageBackgroundMode={imageBackgroundMode}
              ocrActivity={ocrActivity}
              aiTagActivity={aiTagActivity}
              vlmOcrActivity={vlmOcrActivity}
              scanWorking={backendScanRunning || scanMutation.isPending}
              onThemeChange={setTheme}
              onImagePreviewEnabledChange={setImagePreviewEnabled}
              onImagePreviewDelaySecondsChange={(value) =>
                setImagePreviewDelaySeconds(
                  normalizeImagePreviewDelaySeconds(value),
                )
              }
              onImagePreviewSizeChange={(value) =>
                setImagePreviewSize(normalizeImagePreviewSize(value))
              }
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
              embedActivity={embedActivity}
              onStartEmbed={(projectIds, scopeLabel, force) =>
                onStartEmbedActivity(
                  projectIds,
                  undefined,
                  undefined,
                  scopeLabel,
                  force,
                )
              }
              onStopEmbed={onStopEmbedActivity}
              onDismissEmbed={onDismissEmbedActivity}
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
          ) : mode === "tags" ? (
            <TagsView
              translateActivity={translateActivity}
              translationLocales={
                settingsQuery.data?.settings.llmTranslationLocales
              }
              onStartTranslate={onStartTranslateActivity}
            />
          ) : mode === "prompts" ? (
            <PromptsView />
          ) : (
            <div
              key={mode}
              className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pt-0 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pt-0 max-[768px]:pb-8"
            >
              {mode === "precheck" ? (
                <PreCheckView
                  onOpenAsset={setDrawerId}
                  aiEnabled={settingsQuery.data?.settings.llmEnabled ?? false}
                />
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
        settings={settingsQuery.data?.settings}
        embedEnabled={
          (settingsQuery.data?.settings.llmEnabled ?? false) &&
          !!settingsQuery.data?.settings.llmEmbedModel
        }
        imagePreviewEnabled={imagePreviewEnabled}
        imagePreviewDelayMs={imagePreviewDelayMs}
        imagePreviewSize={imagePreviewSize}
        onClose={() => setCmdkOpen(false)}
        onNavigate={changeMode}
        onOpenAsset={openAssetFromPalette}
        onOpenSemanticResult={openSemanticResultFromPalette}
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

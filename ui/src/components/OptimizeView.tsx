import {
  AlertTriangle,
  CheckCircle,
  CheckSquare,
  FileArchive,
  ImageDown,
  Images,
  Info,
  LoaderCircle,
  Search,
  Sliders,
  Terminal,
  Wrench,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useCatalogItemsInfiniteQuery, useSettingsQuery } from "../queries";
import { getCatalogItems } from "../api";
import { fileName, formatBytes, primarySeverity } from "../ui";
import type {
  Category,
  Operation,
  EstimateStreamEvent,
  OptimizationEstimate,
  OptimizationOperation,
  PreviewBatch,
  PreviewResponse,
  Severity,
} from "./optimizeTypes";
import {
  batchActionButtonClassName,
  operationFor,
  operationLabels,
  optimizationOperations,
  postJSON,
  streamEstimate,
  toolInstallCommands,
} from "./optimizeTypes";
import { errorMessage } from "../i18n";
import { OptimizeHelpPopover } from "./OptimizeHelpPopover";
import { OptimizePreviewModal } from "./OptimizePreviewModal";
import { OptimizeScriptModal } from "./OptimizeScriptModal";
import { OptimizeRowItem } from "./OptimizeRowItem";
import { OptimizeQuickConfirmModal } from "./OptimizeQuickConfirmModal";
import { OptimizeEstimatePromptModal } from "./OptimizeEstimatePromptModal";
import {
  buildEstimateFromOperations,
  clearEstimateCaches,
  combinePreviews,
  estimateCache,
  estimateCacheKey,
  estimateOperationCache,
  estimateOperationCacheKey,
  ensureEstimateOperationCacheLoaded,
  persistEstimateOperationCache,
} from "./optimizeCache";
import { useElementHeight } from "../hooks/useElementHeight";
import { useInfiniteScrollSentinel } from "../hooks/useInfiniteScrollSentinel";
import { cn } from "@/lib/cn";
import { useToast } from "./ToastProvider";
import type {
  OptimizeActivityAction,
  OptimizeActivityState,
} from "../optimizeActivity";
import {
  isOptimizeActivityBusy,
  optimizeActivityProgressPercent,
} from "../optimizeActivity";
import {
  Badge,
  Button,
  Checkbox,
  CopyButton,
  EmptyState,
  Modal,
  Notice,
  Rail,
  RailItem,
  RailSection,
  StackedBar,
  type StackedBarSegment,
  StatCard,
  Tabs,
  TextInput,
  TextInputClearButton,
  Tooltip,
} from "./ui";

const EMPTY_OPTIMIZE_IDS: string[] = [];

const categoryTone: Record<string, StackedBarSegment["tone"]> = {
  size: "red",
  format: "purple",
  "svg-minify": "green",
  svg: "green",
  dimensions: "blue",
  animation: "amber",
};

type Props = {
  scanId?: number;
  projectFilterId?: string;
  projectFilterName?: string;
  enabled?: boolean;
  optimizeAbortRef?: RefObject<AbortController | null>;
  optimizeLockedIds?: string[] | null;
  optimizeActivity?: OptimizeActivityState;
  onOptimizeActivity?: (action: OptimizeActivityAction) => void;
  onOptimizeLockIds?: (ids: string[] | null) => void;
  onOpenAsset?: (id: string) => void;
};

export function OptimizeView({
  scanId,
  projectFilterId,
  projectFilterName = "",
  enabled = true,
  optimizeAbortRef,
  optimizeLockedIds,
  optimizeActivity,
  onOptimizeActivity,
  onOptimizeLockIds,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data?.settings;
  const quality = settings?.optimizationDefaultQuality ?? 80;
  const maxDimensionPx =
    settings?.optimizationThresholds?.maxDimensionPx ?? 2560;
  const workers = settings?.optimizationWorkers ?? 1;
  const avifSpeed = settings?.optimizationAvifSpeed ?? 6;
  const strategyHash = settings?.optimizationStrategyHash ?? "";
  const enabledToolIds = useMemo(
    () =>
      settings?.optimizationExternalTools
        ?.filter((tool) => tool.enabled)
        .map((tool) => tool.id) ?? [],
    [settings?.optimizationExternalTools],
  );
  const runtimeTools = settings?.optimizationToolRuntime ?? [];
  const imgtoolsRuntime = runtimeTools.find(
    (tool) => tool.id === "aisets-imgtools",
  );
  const enabledRuntimeTools = runtimeTools.filter(
    (tool) => tool.enabled && tool.id !== "aisets-imgtools",
  );
  const missingEnabledRuntimeTools = enabledRuntimeTools.filter(
    (tool) => !tool.detected,
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [severity, setSeverity] = useState<Severity>("");
  const [operation, setOperation] = useState<Operation>("");
  const [ext, setExt] = useState("");
  const [projectName, setProjectName] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<OptimizationEstimate | null>(null);
  const [preview, setPreview] = useState<PreviewBatch | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const [optimizedFilter, setOptimizedFilter] = useState<
    "" | "pending" | "done"
  >("");
  const [formatOverrides, setFormatOverrides] = useState<Map<string, string>>(
    new Map(),
  );
  const [scriptOpen, setScriptOpen] = useState<{ script: string } | null>(null);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [quickConfirm, setQuickConfirm] = useState<{
    ids: string[];
  } | null>(null);
  const [replaceOriginal, setReplaceOriginal] = useState(false);
  const [updateReferences, setUpdateReferences] = useState(true);
  const [estimatePrompt, setEstimatePrompt] = useState<{
    ids: string[];
  } | null>(null);
  const [lockedActionIds, setLockedActionIds] = useState<string[] | null>(null);
  const [working, setWorking] = useState<
    "estimate" | "preview" | "apply" | "script" | null
  >(() => {
    if (!optimizeActivity || !isOptimizeActivityBusy(optimizeActivity))
      return null;
    return optimizeActivity.stage === "previewing" ? "preview" : "estimate";
  });
  useEffect(() => {
    if (justApplied) setJustApplied(false);
  }, [category, severity, operation, search, ext, projectName]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(() =>
    optimizeActivity ? optimizeActivityProgressPercent(optimizeActivity) : 0,
  );
  const abortRef = useRef<AbortController | null>(null);
  const quickFlowRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const virtualContainerRef = useRef<HTMLDivElement>(null);
  const [toolbarH, toolbarRef] = useElementHeight();

  const effectiveExt = category === "svg-minify" ? ".svg" : ext;
  const effectiveOptimizationCategory =
    category === "svg-minify" ? "" : category;
  const optimizationStatus =
    optimizedFilter === "done"
      ? "optimized"
      : optimizedFilter === "pending"
        ? "optimizationPending"
        : "optimizable";

  const itemsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    {
      projectId: projectFilterId || undefined,
      projectName: projectFilterId ? undefined : projectName || undefined,
      status: optimizationStatus,
      q: search || undefined,
      ext: effectiveExt || undefined,
      optimizationCategory: effectiveOptimizationCategory || undefined,
      optimizationSeverity: severity || undefined,
      operation: operation || undefined,
      sort: "bytes-desc",
      limit: 80,
    },
    enabled,
  );

  const allItems = useMemo(
    () => itemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [itemsQuery.data],
  );
  const items = allItems;
  const firstPage = itemsQuery.data?.pages[0];
  const totalCount = firstPage?.total ?? 0;
  const facets = firstPage?.facets;
  const optimizedCount = facets?.optimizationDoneTotal ?? 0;
  const pendingCount = facets?.optimizationPendingTotal ?? 0;
  const optimizationTotal = facets?.optimizationTotal ?? totalCount;
  const visibleIds = useMemo(() => items.map((item) => item.id), [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const externalLockedIds = optimizeLockedIds ?? EMPTY_OPTIMIZE_IDS;

  const { selectedTotalBytes, selectedSavings } = useMemo(() => {
    let bytes = 0;
    let savings = 0;
    for (const item of items) {
      if (!selected.has(item.id)) continue;
      bytes += item.bytes;
      for (const rec of item.optimizationRecommendations) {
        savings += rec.savingsBytes ?? 0;
      }
    }
    return { selectedTotalBytes: bytes, selectedSavings: savings };
  }, [items, selected]);

  const actionIds = useMemo(
    () =>
      externalLockedIds.length > 0
        ? externalLockedIds
        : selected.size > 0
          ? [...selected]
          : visibleIds,
    [externalLockedIds, selected, visibleIds],
  );

  const getCacheKeyForItem = useCallback(
    (item: Parameters<typeof estimateOperationCacheKey>[0]) =>
      estimateOperationCacheKey(
        item,
        replaceOriginal,
        updateReferences,
        quality,
        maxDimensionPx,
        strategyHash,
        enabledToolIds,
        formatOverrides.get(item.id),
      ),
    [
      replaceOriginal,
      updateReferences,
      quality,
      maxDimensionPx,
      strategyHash,
      enabledToolIds,
      formatOverrides,
    ],
  );

  const estimatedOperationsByAsset = useMemo(() => {
    ensureEstimateOperationCacheLoaded();
    const operations = new Map(
      (estimate?.operations ?? []).map((op) => [op.assetId, op]),
    );
    for (const item of items) {
      if (operations.has(item.id)) continue;
      const cached = estimateOperationCache.get(getCacheKeyForItem(item));
      if (cached) operations.set(item.id, cached);
    }
    return operations;
  }, [estimate, items, getCacheKeyForItem]);

  const actionableActionIds = useMemo(
    () =>
      actionIds.filter(
        (id) => estimatedOperationsByAsset.get(id)?.canApply !== false,
      ),
    [actionIds, estimatedOperationsByAsset],
  );
  const skippedActionCount = actionIds.length - actionableActionIds.length;

  const recommendationTotalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.bytes, 0),
    [items],
  );
  const recommendationSavings = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          item.optimizationRecommendations.reduce(
            (inner, rec) => inner + (rec.savingsBytes ?? 0),
            0,
          ),
        0,
      ),
    [items],
  );
  const severitySegments: StackedBarSegment[] = useMemo(
    () =>
      (["critical", "warning", "info"] as const)
        .map((sev) => ({
          value:
            facets?.optimizationSeverities?.find((s) => s.id === sev)?.count ??
            0,
          tone: (sev === "critical"
            ? "red"
            : sev === "warning"
              ? "amber"
              : "blue") as StackedBarSegment["tone"],
          label: t(`severity.${sev}`),
        }))
        .filter((s) => s.value > 0),
    [facets, t],
  );
  const categorySegments: StackedBarSegment[] = useMemo(
    () =>
      (estimate?.byCategory ?? [])
        .filter((c) => c.savingsBytes > 0)
        .map((c) => ({
          value: c.savingsBytes,
          tone: categoryTone[c.category] ?? ("neutral" as const),
          label: t(`optimize.category.${c.category}`, {
            defaultValue: c.category,
          }),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estimate],
  );
  const selectionLocked =
    working != null ||
    estimatePrompt != null ||
    lockedActionIds != null ||
    externalLockedIds.length > 0;
  const replaceInputId = "optimize-replace-original";
  const referencesInputId = "optimize-update-references";
  const currentEstimateKey = useMemo(
    () =>
      estimateCacheKey(
        actionIds,
        replaceOriginal,
        updateReferences,
        itemsById,
        quality,
        maxDimensionPx,
        strategyHash,
        enabledToolIds,
      ),
    [
      actionIds,
      replaceOriginal,
      updateReferences,
      itemsById,
      quality,
      maxDimensionPx,
      strategyHash,
      enabledToolIds,
    ],
  );
  const cachedEstimateFor = useCallback(
    (assetIds: string[]) => {
      ensureEstimateOperationCacheLoaded();
      const operations: OptimizationOperation[] = [];
      for (const assetId of assetIds) {
        const item = itemsById.get(assetId);
        if (!item) continue;
        const op = estimateOperationCache.get(getCacheKeyForItem(item));
        if (op) operations.push(op);
      }
      if (operations.length === 0) return null;
      return buildEstimateFromOperations(assetIds, itemsById, operations);
    },
    [itemsById, getCacheKeyForItem],
  );

  const lockTransitionRef = useRef(false);
  useEffect(() => {
    if (externalLockedIds.length > 0) {
      lockTransitionRef.current = true;
      return;
    }
    if (lockTransitionRef.current) {
      lockTransitionRef.current = false;
      return;
    }
    setBulkMode(false);
    setSelected(new Set());
    setEstimate(null);
    setPreview(null);
  }, [
    externalLockedIds.length,
    scanId,
    projectFilterId,
    projectName,
    search,
    category,
    severity,
    operation,
    ext,
  ]);
  useEffect(() => {
    if (externalLockedIds.length > 0) {
      setBulkMode(true);
      setSelected(new Set(externalLockedIds));
    }
  }, [externalLockedIds]);

  useEffect(() => {
    setEstimate(
      estimateCache.get(currentEstimateKey) ?? cachedEstimateFor(actionIds),
    );
  }, [currentEstimateKey, actionIds, itemsById, cachedEstimateFor]);

  const optimizeBusy =
    optimizeActivity != null && isOptimizeActivityBusy(optimizeActivity);
  useEffect(() => {
    if (!optimizeBusy && (working === "estimate" || working === "preview")) {
      setWorking(null);
      setProgress(0);
    }
  }, [optimizeBusy, working]);

  useEffect(() => {
    if (working != null || externalLockedIds.length > 0) return;
    setSelected((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (estimatedOperationsByAsset.get(id)?.canApply === false) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [estimatedOperationsByAsset, externalLockedIds.length, working]);

  useInfiniteScrollSentinel({
    rootRef: scrollRef,
    sentinelRef,
    enabled: Boolean(itemsQuery.hasNextPage && !itemsQuery.isFetchingNextPage),
    onLoadMore: () => void itemsQuery.fetchNextPage(),
  });

  const scrollMargin = virtualContainerRef.current?.offsetTop ?? 0;

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
    scrollMargin,
  });

  function applicableIdsFor(assetIds: string[]) {
    return assetIds.filter(
      (id) => estimatedOperationsByAsset.get(id)?.canApply !== false,
    );
  }

  function applicableIdsFromEstimate(
    assetIds: string[],
    nextEstimate: OptimizationEstimate,
  ) {
    const operationsByAsset = new Map(
      nextEstimate.operations.map((op) => [op.assetId, op]),
    );
    return assetIds.filter(
      (id) => operationsByAsset.get(id)?.canApply !== false,
    );
  }

  function requestBody(assetIds?: string[]) {
    const ids = assetIds ?? actionableActionIds;
    const overrides: Record<string, string> = {};
    for (const id of ids) {
      const fmt = formatOverrides.get(id);
      if (fmt && fmt !== "auto") overrides[id] = fmt;
    }
    return {
      assetIds: ids,
      strategy: "conservative",
      outputMode: replaceOriginal ? "replace" : "safeVariants",
      updateReferences: replaceOriginal && updateReferences,
      quality,
      maxDimensionPx,
      avifSpeed,
      workers,
      ...(Object.keys(overrides).length > 0 && {
        outputFormatOverrides: overrides,
      }),
    };
  }

  async function estimateFor(
    assetIds: string[],
    options: {
      signal?: AbortSignal;
      onEvent?: (event: EstimateStreamEvent) => void;
    } = {},
  ) {
    const key = estimateCacheKey(
      assetIds,
      replaceOriginal,
      updateReferences,
      itemsById,
      quality,
      maxDimensionPx,
      strategyHash,
      enabledToolIds,
    );
    const cached = estimateCache.get(key);
    if (cached) {
      setEstimate(cached);
      return cached;
    }
    ensureEstimateOperationCacheLoaded();
    const cachedOperations: OptimizationOperation[] = [];
    const missingIds: string[] = [];
    for (const assetId of assetIds) {
      const item = itemsById.get(assetId);
      if (!item) {
        missingIds.push(assetId);
        continue;
      }
      const op = estimateOperationCache.get(getCacheKeyForItem(item));
      if (op) {
        cachedOperations.push(op);
      } else {
        missingIds.push(assetId);
      }
    }
    if (missingIds.length === 0) {
      const next = buildEstimateFromOperations(
        assetIds,
        itemsById,
        cachedOperations,
      );
      estimateCache.set(key, next);
      setEstimate(next);
      return next;
    }
    const streamedOps: OptimizationOperation[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPartial = () => {
      flushTimer = null;
      const allOps = [...cachedOperations, ...streamedOps];
      setEstimate(buildEstimateFromOperations(assetIds, itemsById, allOps));
      setProgress(Math.round((allOps.length / assetIds.length) * 100));
    };
    await streamEstimate(
      requestBody(missingIds),
      (op) => {
        streamedOps.push(op);
        const item = itemsById.get(op.assetId);
        if (item && op.estimatedBytes > 0) {
          estimateOperationCache.set(getCacheKeyForItem(item), op);
        }
        if (!flushTimer) flushTimer = setTimeout(flushPartial, 300);
      },
      options.signal,
      options.onEvent,
    );
    if (flushTimer) clearTimeout(flushTimer);
    persistEstimateOperationCache();
    const merged = buildEstimateFromOperations(assetIds, itemsById, [
      ...cachedOperations,
      ...streamedOps,
    ]);
    estimateCache.set(key, merged);
    setEstimate(merged);
    return merged;
  }

  async function trackedEstimateFor(
    ids: string[],
    options: { completeActivity?: boolean; releaseLock?: boolean } = {},
  ) {
    const completeActivity = options.completeActivity ?? true;
    const releaseLock = options.releaseLock ?? true;
    onOptimizeLockIds?.(ids);
    const fullKey = estimateCacheKey(
      ids,
      replaceOriginal,
      updateReferences,
      itemsById,
      quality,
      maxDimensionPx,
      strategyHash,
      enabledToolIds,
    );
    const cachedEstimate = estimateCache.get(fullKey);
    const wasCached = Boolean(cachedEstimate);
    const activityStartedAt = Date.now();
    let emittedActivity = false;
    if (!completeActivity && cachedEstimate) {
      onOptimizeActivity?.({
        type: "start",
        total: cachedEstimate.operations.length,
        stage: "estimating",
        startedAt: activityStartedAt,
      });
      for (const op of cachedEstimate.operations) {
        onOptimizeActivity?.({ type: "operation", operation: op });
      }
      emittedActivity = true;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (optimizeAbortRef) optimizeAbortRef.current = ctrl;
    try {
      const nextEstimate = await estimateFor(ids, {
        signal: ctrl.signal,
        onEvent: (event) => {
          if (event.type === "start") {
            emittedActivity = true;
            onOptimizeActivity?.({
              type: "start",
              total: event.total,
              startedAt: activityStartedAt,
            });
          } else if (event.type === "operation") {
            emittedActivity = true;
            onOptimizeActivity?.({
              type: "operation",
              operation: event.operation,
            });
          }
        },
      });
      if (!completeActivity && !emittedActivity) {
        onOptimizeActivity?.({
          type: "start",
          total: nextEstimate.operations.length,
          stage: "estimating",
          startedAt: activityStartedAt,
        });
        for (const op of nextEstimate.operations) {
          onOptimizeActivity?.({ type: "operation", operation: op });
        }
      }
      if (wasCached) toast.info(t("optimize.estimateCached"));
      if (completeActivity && !wasCached)
        onOptimizeActivity?.({ type: "done" });
      return nextEstimate;
    } catch (err) {
      if (ctrl.signal.aborted) {
        onOptimizeActivity?.({ type: "stopped" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onOptimizeActivity?.({ type: "error", errorMessage: message });
      }
      throw err;
    } finally {
      if (releaseLock) onOptimizeLockIds?.(null);
      if (abortRef.current === ctrl) abortRef.current = null;
      if (optimizeAbortRef?.current === ctrl) optimizeAbortRef.current = null;
    }
  }

  async function runEstimate(assetIds?: string[]) {
    const ids = assetIds ?? actionIds;
    setWorking("estimate");
    setProgress(0);
    setError(null);
    try {
      await trackedEstimateFor(ids);
      setProgress(100);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setWorking(null);
    }
  }

  async function runEstimateAndPreview(
    assetIds: string[],
    options: { clearPrompt?: boolean; isQuickFlow?: boolean } = {},
  ) {
    if (options.clearPrompt) setEstimatePrompt(null);
    if (options.isQuickFlow) quickFlowRef.current = true;
    setLockedActionIds(assetIds);
    setError(null);
    try {
      setWorking("estimate");
      const nextEstimate = await trackedEstimateFor(assetIds, {
        completeActivity: false,
        releaseLock: false,
      });
      const previewIds = applicableIdsFromEstimate(assetIds, nextEstimate);
      if (previewIds.length === 0) {
        const message = t("optimize.noApplicableOperations", {
          count: assetIds.length,
          defaultValue:
            "No selected assets have applicable optimization after estimation.",
        });
        setError(message);
        toast.info(message);
        onOptimizeActivity?.({ type: "done" });
        return;
      }
      onOptimizeActivity?.({ type: "stage", stage: "previewing" });
      setWorking("preview");
      await runPreview(previewIds, { keepWorking: true, throwOnError: true });
      onOptimizeActivity?.({ type: "done" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        onOptimizeActivity?.({ type: "stopped" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onOptimizeActivity?.({ type: "error", errorMessage: message });
      }
    } finally {
      onOptimizeLockIds?.(null);
      setWorking(null);
      setLockedActionIds(null);
      if (options.isQuickFlow) quickFlowRef.current = false;
    }
  }

  async function runPreview(
    assetIds = actionableActionIds,
    options: { keepWorking?: boolean; throwOnError?: boolean } = {},
  ) {
    const targetIds = assetIds;
    if (targetIds.length === 0) {
      const message = t("optimize.noApplicableOperations", {
        count: assetIds.length,
        defaultValue:
          "No selected assets have applicable optimization after estimation.",
      });
      setError(message);
      toast.info(message);
      if (options.throwOnError) throw new Error(message);
      return;
    }
    const ctrl = abortRef.current ?? new AbortController();
    if (!abortRef.current) abortRef.current = ctrl;
    if (optimizeAbortRef) optimizeAbortRef.current = ctrl;
    setWorking("preview");
    setProgress(0);
    setError(null);
    try {
      const idsByProject = new Map<string, string[]>();
      for (const id of targetIds) {
        const item = itemsById.get(id);
        if (!item) continue;
        const ids = idsByProject.get(item.projectId) ?? [];
        ids.push(item.id);
        idsByProject.set(item.projectId, ids);
      }
      const groups = [...idsByProject.values()];
      const previews: PreviewResponse[] = [];
      for (let i = 0; i < groups.length; i++) {
        if (ctrl.signal.aborted) break;
        const result = await postJSON<PreviewResponse>(
          "/api/actions/optimization/preview",
          requestBody(groups[i]),
          ctrl.signal,
        );
        previews.push(result);
        setProgress(((i + 1) / groups.length) * 100);
      }
      if (ctrl.signal.aborted) {
        if (options.throwOnError)
          throw new DOMException("Aborted", "AbortError");
        return;
      }
      setPreview(combinePreviews(previews));
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
      if (options.throwOnError) throw err;
    } finally {
      if (!options.keepWorking) {
        setWorking(null);
        if (abortRef.current === ctrl) abortRef.current = null;
        if (optimizeAbortRef?.current === ctrl) optimizeAbortRef.current = null;
      }
    }
  }

  async function runTrackedPreview(ids: string[]) {
    setLockedActionIds(ids);
    onOptimizeLockIds?.(ids);
    onOptimizeActivity?.({ type: "stage", stage: "previewing" });
    try {
      await runPreview(ids, { throwOnError: true });
      onOptimizeActivity?.({ type: "done" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        onOptimizeActivity?.({ type: "stopped" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onOptimizeActivity?.({ type: "error", errorMessage: message });
      }
    } finally {
      onOptimizeLockIds?.(null);
      setLockedActionIds(null);
    }
  }

  function handlePreviewClick() {
    const ids = applicableIdsFor(lockedActionIds ?? actionIds);
    if (ids.length === 0) {
      const message = t("optimize.noApplicableOperations", {
        count: actionIds.length,
        defaultValue:
          "No selected assets have applicable optimization after estimation.",
      });
      setError(message);
      toast.info(message);
      return;
    }
    const missingEstimate = ids.some(
      (id) => !estimatedOperationsByAsset.has(id),
    );
    if (missingEstimate) {
      setEstimatePrompt({ ids });
      return;
    }
    void runTrackedPreview(ids);
  }

  function handleQuickOptimize() {
    setQuickConfirm({ ids: actionableActionIds });
  }

  async function runApply() {
    if (!preview) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setWorking("apply");
    setProgress(0);
    setError(null);
    try {
      const appliedOps = optimizationOperations(preview.preview).filter(
        (op) => op.canApply,
      );
      const totalSaved = appliedOps.reduce(
        (sum, op) => sum + op.savingsBytes,
        0,
      );
      const { tokens } = preview;
      let totalSkipped = 0;
      for (let i = 0; i < tokens.length; i++) {
        if (ctrl.signal.aborted) break;
        const res = await postJSON<{
          result: { skippedFiles?: number };
        }>(
          "/api/actions/optimization/apply",
          { token: tokens[i] },
          ctrl.signal,
        );
        totalSkipped += res.result?.skippedFiles ?? 0;
        setProgress(((i + 1) / tokens.length) * 100);
      }
      if (ctrl.signal.aborted) return;
      if (totalSkipped > 0 && totalSkipped >= appliedOps.length) {
        toast.info(
          t("optimize.applyAllSkipped", {
            count: totalSkipped,
            defaultValue: "All {{count}} items were already optimized",
          }),
          { title: t("optimize.optimizationComplete") },
        );
      } else {
        const appliedCount = appliedOps.length - totalSkipped;
        toast.success(
          t("optimize.applySuccess", {
            count: appliedCount,
            savings: formatBytes(totalSaved),
          }) +
            (totalSkipped > 0
              ? ` · ${t("optimize.applySkipped", { count: totalSkipped, defaultValue: "{{count}} skipped (already optimized)" })}`
              : ""),
          { title: t("optimize.optimizationComplete") },
        );
      }
      setPreview(null);
      setBulkMode(false);
      setSelected(new Set());
      setJustApplied(true);
      clearEstimateCaches();
      void itemsQuery.refetch();
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setPreview(null);
        setBulkMode(false);
        setSelected(new Set());
        toast.error(errorMessage(err), { title: t("optimize.applyFailed") });
        void itemsQuery.refetch();
      }
    } finally {
      setWorking(null);
      abortRef.current = null;
    }
  }

  function cancelOperation() {
    if (working === "estimate" || working === "preview") {
      onOptimizeActivity?.({ type: "stopping" });
    }
    abortRef.current?.abort();
    setWorking(null);
    setProgress(0);
    abortRef.current = null;
    if (optimizeAbortRef) optimizeAbortRef.current = null;
  }

  async function generateScript() {
    setWorking("script");
    setError(null);
    try {
      const body = await postJSON<{ script: string }>(
        "/api/actions/optimization/generate-script",
        requestBody(),
      );
      setScriptOpen({ script: body.script ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  const selectableItemIds = useMemo(
    () =>
      items
        .filter((i) => estimatedOperationsByAsset.get(i.id)?.canApply !== false)
        .map((i) => i.id),
    [items, estimatedOperationsByAsset],
  );

  const allSelected = useMemo(
    () =>
      bulkMode &&
      selectableItemIds.length > 0 &&
      selected.size >= selectableItemIds.length &&
      selectableItemIds.every((id) => selected.has(id)),
    [bulkMode, selectableItemIds, selected],
  );

  function toggleBulkMode() {
    if (selectionLocked) return;
    if (!bulkMode) {
      setBulkMode(true);
    } else if (allSelected) {
      setBulkMode(false);
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableItemIds));
    }
  }

  function toggleOne(id: string) {
    if (
      !bulkMode ||
      selectionLocked ||
      estimatedOperationsByAsset.get(id)?.canApply === false
    )
      return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const handleFormatChange = useCallback(
    (itemId: string, format: string | null) => {
      setFormatOverrides((prev) => {
        const next = new Map(prev);
        if (format == null) next.delete(itemId);
        else next.set(itemId, format);
        return next;
      });
      estimateCache.clear();
    },
    [],
  );

  const handleOpenVariant = useCallback(
    async (projectId: string, variantRepoPath: string) => {
      if (!scanId || !onOpenAsset) return;
      try {
        const result = await getCatalogItems({
          scanId,
          projectId,
          q: fileName(variantRepoPath),
          limit: 10,
        });
        const match = result.items.find(
          (i) => i.repoPath === variantRepoPath && i.projectId === projectId,
        );
        if (match) onOpenAsset(match.id);
      } catch {
        // silently fail — variant may not be in catalog
      }
    },
    [scanId, onOpenAsset],
  );

  const estimateMissingTools =
    estimate?.tools?.filter((tool) => tool.required && !tool.available)
      .length ?? 0;
  const missingTools = estimateMissingTools + missingEnabledRuntimeTools.length;
  const toolStatValue =
    missingTools > 0 ? missingTools : imgtoolsRuntime?.detected ? "OK" : "!";
  const toolStatMeta =
    missingTools > 0
      ? t("optimize.toolsMissingMeta", {
          count: missingTools,
          defaultValue: "{{count}} 個已啟用工具缺少",
        })
      : imgtoolsRuntime?.detected
        ? t("optimize.toolsRuntimeReadyMeta", {
            count: enabledRuntimeTools.length,
            defaultValue: "Imgtools 可用 · {{count}} 個外部工具已啟用",
          })
        : t("optimize.toolsRuntimeFallbackMeta", {
            defaultValue: "Imgtools 缺少 · 使用內建備援",
          });
  const canAct = actionableActionIds.length > 0;
  const operationLabel = (id: string) =>
    t(`optimize.operationLabel.${id}`, {
      defaultValue: operationLabels[id] ?? id,
    });

  return (
    <>
      <Rail className="ml-3 px-0 max-[1100px]:hidden">
        <RailSection heading={t("filter.project")}>
          {!projectFilterId && (
            <RailItem
              label={t("filter.allProjects")}
              count={facets?.projectTotal ?? totalCount}
              active={!projectName}
              onClick={() => setProjectName("")}
            />
          )}
          {(facets?.projects ?? []).map((project) => (
            <RailItem
              key={project.id}
              label={project.id}
              count={project.count}
              active={project.id === (projectFilterName || projectName)}
              onClick={() =>
                setProjectName(projectName === project.id ? "" : project.id)
              }
            />
          ))}
        </RailSection>

        <RailSection heading={t("filter.extension")}>
          <RailItem
            label={t("filter.allExtensions")}
            count={facets?.extensionTotal ?? totalCount}
            active={!effectiveExt}
            onClick={() => {
              setCategory("");
              setExt("");
            }}
          />
          {(facets?.extensions ?? []).map((option) => (
            <RailItem
              key={option.id}
              label={option.id.toUpperCase()}
              count={option.count}
              active={effectiveExt === option.id}
              onClick={() => {
                setCategory("");
                setExt(option.id);
              }}
            />
          ))}
        </RailSection>

        <RailSection heading={t("optimize.operation")}>
          <RailItem
            label={t("status.all")}
            count={totalCount}
            active={!operation}
            onClick={() => setOperation("")}
          />
          {(facets?.operations ?? []).map((option) => (
            <RailItem
              key={option.id}
              label={operationLabel(option.id)}
              count={option.count}
              active={operation === option.id}
              onClick={() => setOperation(option.id as Operation)}
            />
          ))}
        </RailSection>
      </Rail>

      <div
        ref={scrollRef}
        className="content-scroll flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-2 pt-0"
      >
        <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              icon={<Images size={14} />}
              label={t("optimize.statItems")}
              value={totalCount}
              meta={t("asset.assets", { count: totalCount })}
            />
            <StatCard
              icon={<FileArchive size={14} />}
              label={t("optimize.statOriginalSize")}
              value={
                estimate
                  ? formatBytes(estimate.totalBytes)
                  : recommendationTotalBytes > 0
                    ? formatBytes(recommendationTotalBytes)
                    : "—"
              }
              meta={
                estimate
                  ? t("optimize.estimateExact")
                  : recommendationTotalBytes > 0
                    ? t("optimize.estimateApprox")
                    : t("selection.summary", {
                        count: selected.size || visibleIds.length,
                        size: formatBytes(selectedTotalBytes),
                      })
              }
            />
            <StatCard
              icon={<ImageDown size={14} />}
              label={t("optimize.statSavings")}
              value={
                estimate
                  ? formatBytes(estimate.savingsBytes)
                  : recommendationSavings > 0
                    ? formatBytes(recommendationSavings)
                    : "—"
              }
              meta={
                estimate
                  ? t("optimize.estimateExact")
                  : recommendationSavings > 0
                    ? t("optimize.estimateApprox")
                    : t("optimize.estimateMeta")
              }
              tone={
                (estimate?.savingsBytes ?? recommendationSavings) > 0
                  ? "green"
                  : "neutral"
              }
            />
            <StatCard
              icon={<Wrench size={14} />}
              label={t("optimize.statTools")}
              value={toolStatValue}
              meta={toolStatMeta}
              tone={
                missingTools > 0 || !imgtoolsRuntime?.detected
                  ? "amber"
                  : "neutral"
              }
              onClick={() =>
                navigate("/settings?section=optimization&expand=tools")
              }
            />
          </div>

          {severitySegments.length > 0 && (
            <StackedBar
              segments={severitySegments}
              className="mb-4"
              ariaLabel={t("optimize.healthBar")}
            />
          )}

          {categorySegments.length > 0 && (
            <div className="mb-4 rounded-g-md border border-g-line bg-g-surface p-3 shadow-g-sm">
              <div className="mb-2 font-g text-g-chip font-[510] uppercase tracking-[0.08em] text-g-ink-4">
                {t("optimize.categoryBreakdown")}
              </div>
              <StackedBar
                segments={categorySegments}
                className="mb-2"
                ariaLabel={t("optimize.categoryBreakdown")}
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {(estimate?.byCategory ?? [])
                  .filter((c) => c.savingsBytes > 0)
                  .map((c) => (
                    <span
                      key={c.category}
                      className="flex items-center gap-1.5 text-g-caption text-g-ink-3"
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          categoryTone[c.category] === "red" && "bg-g-red",
                          categoryTone[c.category] === "purple" &&
                            "bg-g-purple",
                          categoryTone[c.category] === "green" && "bg-g-green",
                          categoryTone[c.category] === "blue" && "bg-g-blue",
                          categoryTone[c.category] === "amber" && "bg-g-amber",
                          !categoryTone[c.category] && "bg-g-ink-4",
                        )}
                      />
                      {t(`optimize.category.${c.category}`, {
                        defaultValue: c.category,
                      })}{" "}
                      — {formatBytes(c.savingsBytes)}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div
            ref={toolbarRef}
            className="sticky top-0 z-[4] mb-1 grid min-w-0 gap-1.5 bg-[color-mix(in_srgb,var(--g-canvas)_92%,transparent)] pb-1 backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)]"
          >
            <div className="flex items-center gap-2.5">
              <TextInput
                variant="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("optimize.searchPlaceholder")}
                icon={<Search size={16} />}
                disabled={selectionLocked}
                suffix={
                  search ? (
                    <TextInputClearButton
                      label={t("toolbar.clearSearch")}
                      onClick={() => setSearch("")}
                    />
                  ) : undefined
                }
                className="min-w-[200px] flex-1"
                inputClassName="font-g text-g-ui tracking-g-ui"
              />
              <Button
                size="md"
                variant={bulkMode ? "primary" : "secondary"}
                leadingIcon={<CheckSquare size={14} />}
                onClick={toggleBulkMode}
                disabled={selectionLocked}
                className="shrink-0"
              >
                {!bulkMode
                  ? t("toolbar.bulkSelect")
                  : allSelected
                    ? t("common.cancel")
                    : t("action.selectAll")}
              </Button>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto">
              <div className="min-w-0 flex-none">
                <Tabs
                  value={category}
                  ariaLabel={t("optimize.categoryFilter")}
                  onChange={(value) => {
                    if (selectionLocked) return;
                    setCategory(value as Category);
                    if (value === "svg-minify") setExt("");
                  }}
                  items={(
                    [
                      "",
                      "size",
                      "format",
                      "svg-minify",
                      "dimensions",
                    ] as Category[]
                  ).map((key) => ({
                    value: key,
                    label: key
                      ? t(`optimize.category.${key}`)
                      : t("status.all"),
                    ...(key && {
                      badge: (
                        <span className="font-[400] text-g-ink-4">
                          {key === "svg-minify"
                            ? (facets?.extensions?.find(
                                (option) => option.id === ".svg",
                              )?.count ?? 0)
                            : (facets?.optimizationCategories?.find(
                                (c) => c.id === key,
                              )?.count ?? 0)}
                        </span>
                      ),
                    }),
                  }))}
                />
              </div>

              <div className="min-w-0 flex-none overflow-x-auto">
                <Tabs
                  value={severity}
                  ariaLabel={t("optimize.severity")}
                  onChange={(value) => {
                    if (!selectionLocked) setSeverity(value as Severity);
                  }}
                  items={[
                    { value: "" as Severity, label: t("status.all") },
                    {
                      value: "critical" as Severity,
                      label: t("severity.critical"),
                      icon: <XCircle size={13} className="text-g-red" />,
                      badge: (
                        <span className="font-[400] text-g-ink-4">
                          {facets?.optimizationSeverities?.find(
                            (s) => s.id === "critical",
                          )?.count ?? 0}
                        </span>
                      ),
                    },
                    {
                      value: "warning" as Severity,
                      label: t("severity.warning"),
                      icon: (
                        <AlertTriangle size={13} className="text-g-amber" />
                      ),
                      badge: (
                        <span className="font-[400] text-g-ink-4">
                          {facets?.optimizationSeverities?.find(
                            (s) => s.id === "warning",
                          )?.count ?? 0}
                        </span>
                      ),
                    },
                    {
                      value: "info" as Severity,
                      label: t("severity.info"),
                      icon: <Info size={13} className="text-g-blue" />,
                      badge: (
                        <span className="font-[400] text-g-ink-4">
                          {facets?.optimizationSeverities?.find(
                            (s) => s.id === "info",
                          )?.count ?? 0}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>

              {optimizationTotal > 0 && (
                <div className="min-w-0 flex-none overflow-x-auto">
                  <Tabs
                    value={optimizedFilter}
                    ariaLabel={t("optimize.optimizedFilter")}
                    onChange={(value) => {
                      if (!selectionLocked)
                        setOptimizedFilter(value as "" | "pending" | "done");
                    }}
                    items={[
                      { value: "", label: t("status.all") },
                      {
                        value: "pending",
                        label: t("optimize.filterPending"),
                        badge: (
                          <span className="font-[400] text-g-ink-4">
                            {pendingCount}
                          </span>
                        ),
                      },
                      {
                        value: "done",
                        label: t("optimize.filterDone"),
                        icon: (
                          <CheckCircle size={13} className="text-g-green" />
                        ),
                        badge: (
                          <span className="font-[400] text-g-ink-4">
                            {optimizedCount}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </div>

            {bulkMode && (
              <div className="sticky top-0 z-[5] flex w-full min-h-[44px] items-center gap-0.5 overflow-x-auto rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
                <span className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap px-2.5 font-g-mono text-g-body text-g-ink-2">
                  {selected.size > 0
                    ? `${t("selection.summary", {
                        count: selected.size,
                        size: formatBytes(selectedTotalBytes),
                      })}${
                        selectedSavings > 0
                          ? t("selection.savingsSuffix", {
                              size: formatBytes(selectedSavings),
                            })
                          : ""
                      }`
                    : t("optimize.selectItems", {
                        defaultValue: "Select items to optimize",
                      })}
                </span>
                {skippedActionCount > 0 && (
                  <Tooltip
                    label={t("optimize.skippedBlockedDesc", {
                      count: skippedActionCount,
                      defaultValue:
                        "Estimated items that are not worth applying are excluded from preview and apply.",
                    })}
                    placement="top"
                    contentClassName="max-w-[280px] whitespace-normal"
                  >
                    <span>
                      <Badge tone="amber">
                        {t("optimize.skippedBlocked", {
                          count: skippedActionCount,
                          defaultValue: "{{count}} skipped",
                        })}
                      </Badge>
                    </span>
                  </Tooltip>
                )}
                <Tooltip
                  label={t("optimize.help.replaceOriginal")}
                  placement="top"
                  contentClassName="max-w-[280px] whitespace-normal"
                >
                  <label
                    htmlFor={replaceInputId}
                    className={cn(
                      "inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--g-r-md)-2px)] px-2.5 text-g-body font-[510] text-g-ink-2",
                      selectionLocked
                        ? "cursor-not-allowed opacity-[0.45]"
                        : "cursor-pointer hover:bg-g-surface hover:text-g-ink",
                    )}
                  >
                    <Checkbox
                      id={replaceInputId}
                      checked={replaceOriginal}
                      disabled={selectionLocked}
                      onCheckedChange={(checked) => {
                        const next = checked === true;
                        setReplaceOriginal(next);
                        setUpdateReferences(next);
                      }}
                      aria-label={t("optimize.replaceOriginal")}
                    />
                    <span>{t("optimize.replaceOriginal")}</span>
                  </label>
                </Tooltip>
                <Tooltip
                  label={t("optimize.help.updateReferences")}
                  placement="top"
                  contentClassName="max-w-[280px] whitespace-normal"
                >
                  <label
                    htmlFor={referencesInputId}
                    className={cn(
                      "inline-flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--g-r-md)-2px)] px-2.5 text-g-body font-[510] text-g-ink-2",
                      !replaceOriginal || selectionLocked
                        ? "cursor-not-allowed opacity-[0.45]"
                        : "cursor-pointer hover:bg-g-surface hover:text-g-ink",
                    )}
                  >
                    <Checkbox
                      id={referencesInputId}
                      checked={replaceOriginal && updateReferences}
                      disabled={!replaceOriginal || selectionLocked}
                      onCheckedChange={(checked) =>
                        setUpdateReferences(checked === true)
                      }
                      aria-label={t("optimize.updateReferences")}
                    />
                    <span>{t("optimize.updateReferences")}</span>
                  </label>
                </Tooltip>
                <span className="flex-1" />
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={handleQuickOptimize}
                  disabled={!canAct || selectionLocked || selected.size === 0}
                >
                  {quickFlowRef.current && working ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Zap size={14} />
                  )}
                  {quickFlowRef.current && working === "estimate"
                    ? t("optimize.estimating")
                    : quickFlowRef.current && working === "preview"
                      ? t("optimize.optimizing")
                      : t("optimize.quickOptimize")}
                </button>
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={() => void runEstimate()}
                  disabled={!canAct || selectionLocked || selected.size === 0}
                >
                  {working === "estimate" && !quickFlowRef.current ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Sliders size={14} />
                  )}
                  {working === "estimate" && !quickFlowRef.current
                    ? t("optimize.estimating")
                    : t("optimize.estimate")}
                </button>
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={handlePreviewClick}
                  disabled={!canAct || selectionLocked || selected.size === 0}
                >
                  {working === "preview" && !quickFlowRef.current ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <ImageDown size={14} />
                  )}
                  {working === "preview" && !quickFlowRef.current
                    ? t("optimize.optimizing")
                    : t("optimize.optimizeAction")}
                </button>
                <button
                  type="button"
                  className={batchActionButtonClassName}
                  onClick={generateScript}
                  disabled={!canAct || selectionLocked || selected.size === 0}
                >
                  {working === "script" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Terminal size={14} />
                  )}
                  {working === "script"
                    ? t("action.generating")
                    : t("optimize.script")}
                </button>
                <OptimizeHelpPopover />
              </div>
            )}

            {working && (
              <div className="mb-2 flex items-center gap-2">
                <div className="relative h-2 flex-1 overflow-hidden rounded-g-pill bg-g-surface-3">
                  {progress > 0 ? (
                    <div
                      className="relative h-full overflow-hidden rounded-g-pill bg-g-accent transition-[width] duration-300 ease-g"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute inset-0 animate-[progress-shimmer_2.4s_linear_infinite] bg-gradient-to-r from-transparent via-white/[0.14] to-transparent" />
                    </div>
                  ) : (
                    <div className="absolute inset-y-0 w-[28%] animate-[progress-indeterminate_1.6s_ease-in-out_infinite] rounded-g-pill bg-g-accent opacity-80 motion-reduce:hidden" />
                  )}
                </div>
                {progress > 0 && (
                  <span className="min-w-[3ch] text-right font-g-mono text-g-chip tabular-nums text-g-accent">
                    {Math.round(progress)}%
                  </span>
                )}
                <button
                  type="button"
                  className="grid size-5 shrink-0 place-items-center rounded-g-sm text-g-ink-4 transition-colors duration-[120ms] hover:bg-g-surface-2 hover:text-g-ink"
                  onClick={cancelOperation}
                  aria-label={t("common.cancel")}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {error && (
            <Notice
              tone="danger"
              className="mb-3"
              title={t("optimize.applyFailed")}
            >
              {error}
            </Notice>
          )}

          {itemsQuery.isLoading ? (
            <EmptyState title={t("common.loading")} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={
                justApplied ? (
                  <CheckCircle size={24} className="text-g-green" />
                ) : undefined
              }
              title={
                justApplied ? t("optimize.allDone") : t("common.noResults")
              }
              description={
                justApplied
                  ? t("optimize.allDoneDesc")
                  : t("optimize.noRecommendations")
              }
              tone="neutral"
            />
          ) : (
            <div className="rounded-g-md border border-g-line bg-g-surface shadow-g-sm">
              <div
                className={cn(
                  "sticky z-[5] hidden items-center gap-2 border-b border-g-line bg-g-surface-2 px-3 font-g-mono text-g-caption uppercase tracking-[0.06em] text-g-ink-4 min-[980px]:grid",
                  bulkMode
                    ? "grid-cols-[40px_minmax(0,1.2fr)_minmax(140px,1fr)_200px_150px]"
                    : "grid-cols-[minmax(0,1.2fr)_minmax(140px,1fr)_200px_150px]",
                )}
                style={{ top: `${toolbarH}px` }}
              >
                {bulkMode && <div className="py-2" />}
                <div className="py-2">
                  {t("optimize.columnFile", { defaultValue: "File" })}
                </div>
                <div className="py-2">{t("optimize.operation")}</div>
                <div className="py-2">
                  {t("optimize.columnSourceTarget", {
                    defaultValue: "Source → Target",
                  })}
                </div>
                <div className="py-2 text-right">
                  {t("optimize.statSavings")}
                </div>
              </div>
              <div
                ref={virtualContainerRef}
                className="relative"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = items[virtualRow.index];
                  if (!item) return null;
                  const planned = estimatedOperationsByAsset.get(item.id);
                  const op =
                    (planned?.operation as Operation) || operationFor(item);
                  return (
                    <div
                      key={item.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full"
                      style={{
                        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                      }}
                    >
                      <OptimizeRowItem
                        item={item}
                        op={op}
                        sev={primarySeverity(item) ?? ""}
                        planned={planned}
                        isSelected={selected.has(item.id)}
                        bulkMode={bulkMode}
                        selectionLocked={selectionLocked}
                        formatOverride={formatOverrides.get(item.id)}
                        onToggle={toggleOne}
                        onOpenAsset={onOpenAsset ?? (() => {})}
                        onViewVariant={(name) =>
                          navigate(`/browse?q=${encodeURIComponent(name)}`)
                        }
                        onOpenVariant={handleOpenVariant}
                        onFormatChange={handleFormatChange}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div ref={sentinelRef} className="h-10" />
        </div>
      </div>

      {estimatePrompt && (
        <OptimizeEstimatePromptModal
          ids={estimatePrompt.ids}
          working={working}
          onClose={() => setEstimatePrompt(null)}
          onConfirm={(ids) =>
            void runEstimateAndPreview(ids, { clearPrompt: true })
          }
        />
      )}

      {preview && (
        <OptimizePreviewModal
          preview={preview}
          itemsById={itemsById}
          replaceOriginal={replaceOriginal}
          working={working}
          onClose={() => setPreview(null)}
          onApply={runApply}
        />
      )}

      {scriptOpen && (
        <OptimizeScriptModal
          data={scriptOpen}
          onClose={() => setScriptOpen(null)}
        />
      )}

      {toolsModalOpen && estimate?.tools && (
        <Modal
          title={t("optimize.missingToolsTitle")}
          onClose={() => setToolsModalOpen(false)}
        >
          <div className="space-y-2">
            {estimate.tools
              .filter((tool) => tool.required && !tool.available)
              .map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2"
                >
                  <Badge tone="amber">{tool.name}</Badge>
                  <code className="flex-1 font-g-mono text-g-caption text-g-ink-2">
                    {toolInstallCommands[tool.name] ?? tool.name}
                  </code>
                  <CopyButton
                    value={toolInstallCommands[tool.name] ?? tool.name}
                  />
                </div>
              ))}
          </div>
        </Modal>
      )}

      {quickConfirm && (
        <OptimizeQuickConfirmModal
          ids={quickConfirm.ids}
          itemsById={itemsById}
          estimatedOperationsByAsset={estimatedOperationsByAsset}
          replaceOriginal={replaceOriginal}
          onClose={() => setQuickConfirm(null)}
          onConfirm={(ids) => {
            setQuickConfirm(null);
            void runEstimateAndPreview(ids, { isQuickFlow: true });
          }}
        />
      )}
    </>
  );
}

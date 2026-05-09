import {
  CheckSquare,
  FileArchive,
  ImageDown,
  Images,
  LoaderCircle,
  Search,
  Sliders,
  Terminal,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { projectScanIntentLabel } from "../projectScanIntent";
import { useCatalogItemsInfiniteQuery, useSettingsQuery } from "../queries";
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
import { OptimizeHelpPopover } from "./OptimizeHelpPopover";
import { OptimizePreviewModal } from "./OptimizePreviewModal";
import { OptimizeScriptModal } from "./OptimizeScriptModal";
import {
  buildEstimateFromOperations,
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
import type { OptimizeActivityAction } from "../optimizeActivity";
import {
  AssetThumbnail,
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
  onOptimizeActivity,
  onOptimizeLockIds,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
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
    (tool) => tool.id === "asset-studio-imgtools",
  );
  const enabledRuntimeTools = runtimeTools.filter(
    (tool) => tool.enabled && tool.id !== "asset-studio-imgtools",
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
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const quickFlowRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const virtualContainerRef = useRef<HTMLDivElement>(null);
  const [toolbarH, toolbarRef] = useElementHeight();

  const itemsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    {
      projectId: projectFilterId || undefined,
      projectName: projectFilterId ? undefined : projectName || undefined,
      status: "optimizable",
      q: search || undefined,
      ext: ext || undefined,
      optimizationCategory: category || undefined,
      optimizationSeverity: severity || undefined,
      operation: operation || undefined,
      sort: "bytes-desc",
      limit: 80,
    },
    enabled,
  );

  const items = useMemo(
    () => itemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [itemsQuery.data],
  );
  const firstPage = itemsQuery.data?.pages[0];
  const totalCount = firstPage?.total ?? 0;
  const facets = firstPage?.facets;
  const visibleIds = useMemo(() => items.map((item) => item.id), [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const externalLockedIds = optimizeLockedIds ?? EMPTY_OPTIMIZE_IDS;
  const selectedItems = items.filter((item) => selected.has(item.id));
  const actionIds = useMemo(
    () =>
      externalLockedIds.length > 0
        ? externalLockedIds
        : selected.size > 0
          ? [...selected]
          : visibleIds,
    [externalLockedIds, selected, visibleIds],
  );
  const selectedTotalBytes = selectedItems.reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  const selectedSavings = selectedItems.reduce(
    (sum, item) =>
      sum +
      item.optimizationRecommendations.reduce(
        (inner, rec) => inner + (rec.savingsBytes ?? 0),
        0,
      ),
    0,
  );
  const estimatedOperationsByAsset = useMemo(() => {
    ensureEstimateOperationCacheLoaded();
    const operations = new Map(
      (estimate?.operations ?? []).map((op) => [op.assetId, op]),
    );
    for (const item of items) {
      if (operations.has(item.id)) continue;
      const operation = estimateOperationCache.get(
        estimateOperationCacheKey(
          item,
          replaceOriginal,
          updateReferences,
          quality,
          maxDimensionPx,
          strategyHash,
          enabledToolIds,
        ),
      );
      if (operation) operations.set(item.id, operation);
    }
    return operations;
  }, [
    estimate,
    items,
    quality,
    maxDimensionPx,
    strategyHash,
    enabledToolIds,
    replaceOriginal,
    updateReferences,
  ]);
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
  function cachedEstimateFor(assetIds: string[]) {
    ensureEstimateOperationCacheLoaded();
    const operations: OptimizationOperation[] = [];
    for (const assetId of assetIds) {
      const item = itemsById.get(assetId);
      if (!item) continue;
      const operation = estimateOperationCache.get(
        estimateOperationCacheKey(
          item,
          replaceOriginal,
          updateReferences,
          quality,
          maxDimensionPx,
          strategyHash,
          enabledToolIds,
        ),
      );
      if (operation) operations.push(operation);
    }
    if (operations.length === 0) return null;
    return buildEstimateFromOperations(assetIds, itemsById, operations);
  }

  useEffect(() => {
    if (externalLockedIds.length > 0) return;
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
    setPreview(null);
  }, [currentEstimateKey, actionIds, itemsById]);

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
    return {
      assetIds: ids,
      strategy: "conservative",
      outputMode: replaceOriginal ? "replace" : "safeVariants",
      updateReferences: replaceOriginal && updateReferences,
      quality,
      maxDimensionPx,
      avifSpeed,
      workers,
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
      const operation = estimateOperationCache.get(
        estimateOperationCacheKey(
          item,
          replaceOriginal,
          updateReferences,
          quality,
          maxDimensionPx,
          strategyHash,
          enabledToolIds,
        ),
      );
      if (operation) {
        cachedOperations.push(operation);
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
          estimateOperationCache.set(
            estimateOperationCacheKey(
              item,
              replaceOriginal,
              updateReferences,
              quality,
              maxDimensionPx,
              strategyHash,
              enabledToolIds,
            ),
            op,
          );
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
    let emittedActivity = false;
    if (!completeActivity && cachedEstimate) {
      onOptimizeActivity?.({
        type: "start",
        total: cachedEstimate.operations.length,
        stage: "estimating",
      });
      for (const operation of cachedEstimate.operations) {
        onOptimizeActivity?.({ type: "operation", operation });
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
            onOptimizeActivity?.({ type: "start", total: event.total });
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
        });
        for (const operation of nextEstimate.operations) {
          onOptimizeActivity?.({ type: "operation", operation });
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

  async function runEstimateThenPreview(assetIds: string[]) {
    setEstimatePrompt(null);
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

  async function runQuickOptimize(ids: string[]) {
    setQuickConfirm(null);
    quickFlowRef.current = true;
    setLockedActionIds(ids);
    setError(null);
    try {
      setWorking("estimate");
      const nextEstimate = await trackedEstimateFor(ids, {
        completeActivity: false,
        releaseLock: false,
      });
      const previewIds = applicableIdsFromEstimate(ids, nextEstimate);
      if (previewIds.length === 0) {
        const message = t("optimize.noApplicableOperations", {
          count: ids.length,
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
      quickFlowRef.current = false;
    }
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
      for (let i = 0; i < tokens.length; i++) {
        if (ctrl.signal.aborted) break;
        await postJSON(
          "/api/actions/optimization/apply",
          { token: tokens[i] },
          ctrl.signal,
        );
        setProgress(((i + 1) / tokens.length) * 100);
      }
      if (ctrl.signal.aborted) return;
      toast.success(
        t("optimize.applySuccess", {
          count: appliedOps.length,
          savings: formatBytes(totalSaved),
        }),
        { title: t("optimize.optimizationComplete") },
      );
      setPreview(null);
      setBulkMode(false);
      setSelected(new Set());
      void itemsQuery.refetch();
    } catch (err) {
      if (!ctrl.signal.aborted)
        setError(err instanceof Error ? err.message : String(err));
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

  function toggleBulkMode() {
    if (selectionLocked) return;
    setBulkMode((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
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
  const blockedReasonLabel = (op: OptimizationOperation) =>
    t(`optimize.blockedReason.${op.reasonCode}`, {
      defaultValue: op.blockedReason || t("optimize.blocked"),
      tool: op.tool,
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
            active={!ext}
            onClick={() => setExt("")}
          />
          {(facets?.extensions ?? []).map((option) => (
            <RailItem
              key={option.id}
              label={option.id.toUpperCase()}
              count={option.count}
              active={ext === option.id}
              onClick={() => setExt(option.id)}
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
              onClick={
                missingTools > 0 || !imgtoolsRuntime?.detected
                  ? () => setToolsModalOpen(true)
                  : undefined
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
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="min-w-0 flex-none overflow-x-auto">
                <Tabs
                  value={category}
                  ariaLabel={t("optimize.categoryFilter")}
                  onChange={(value) => {
                    if (!selectionLocked) setCategory(value as Category);
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
                      : t("optimize.allCategories"),
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
                  items={(
                    ["", "critical", "warning", "info"] as Severity[]
                  ).map((key) => ({
                    value: key,
                    label: key
                      ? t(`severity.${key}`)
                      : t("optimize.allSeverities"),
                  }))}
                />
              </div>

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
                className="min-w-[200px] flex-[1_1_280px]"
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
                {bulkMode ? t("action.deselectAll") : t("toolbar.bulkSelect")}
              </Button>
            </div>

            {bulkMode && selected.size > 0 && (
              <div className="sticky top-0 z-[5] flex w-full min-h-[44px] items-center gap-0.5 overflow-x-auto rounded-g-md border border-g-line bg-g-surface-2 p-1 shadow-g-inset animate-[slideUp2_200ms_var(--g-ease-out)]">
                <span className="inline-flex min-h-[34px] shrink-0 items-center whitespace-nowrap px-2.5 font-g-mono text-g-body text-g-ink-2">
                  {t("selection.summary", {
                    count: selected.size,
                    size: formatBytes(selectedTotalBytes),
                  })}
                  {selectedSavings > 0 &&
                    t("selection.savingsSuffix", {
                      size: formatBytes(selectedSavings),
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
                  disabled={!canAct || selectionLocked}
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
                  disabled={!canAct || selectionLocked}
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
                  disabled={!canAct || selectionLocked}
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
                  disabled={!canAct || selectionLocked}
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
              title={t("error.requestFailed", { status: "" })}
            >
              {error}
            </Notice>
          )}

          {itemsQuery.isLoading ? (
            <EmptyState title={t("common.loading")} />
          ) : items.length === 0 ? (
            <EmptyState
              title={t("common.noResults")}
              description={t("optimize.noRecommendations")}
              tone="neutral"
            />
          ) : (
            <div className="rounded-g-md border border-g-line bg-g-surface shadow-g-sm">
              <div
                className={cn(
                  "sticky z-[5] hidden items-center border-b border-g-line bg-g-surface-2 font-g-mono text-g-caption uppercase tracking-[0.06em] text-g-ink-4 min-[980px]:grid",
                  bulkMode
                    ? "grid-cols-[40px_72px_minmax(0,1.4fr)_180px_170px_130px]"
                    : "grid-cols-[72px_minmax(0,1.4fr)_180px_170px_130px]",
                )}
                style={{ top: `${toolbarH}px` }}
              >
                {bulkMode && <div className="px-3 py-2" />}
                <div className="px-3 py-2">{t("asset.thumbnail")}</div>
                <div className="px-3 py-2">{t("assetDrawer.path")}</div>
                <div className="px-3 py-2">{t("optimize.operation")}</div>
                <div className="px-3 py-2">{t("preview.output")}</div>
                <div className="px-3 py-2 text-right">
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
                  const sev = primarySeverity(item);
                  const planned = estimatedOperationsByAsset.get(item.id);
                  const op =
                    (planned?.operation as Operation) || operationFor(item);
                  const rec = item.optimizationRecommendations[0];
                  const recSavings = rec?.savingsBytes ?? 0;
                  const isSelected = selected.has(item.id);
                  const estimated = planned?.estimatedBytes ?? 0;
                  const savings = planned?.savingsBytes ?? 0;
                  const hasEstimate = planned != null && estimated > 0;
                  const rowBlocked = planned?.canApply === false;
                  const rowBlockedLabel = planned
                    ? blockedReasonLabel(planned)
                    : "";
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
                      <div
                        className={cn(
                          "grid min-h-[84px] items-center gap-2 border-b border-g-line px-3 py-2 transition-[background,border-color,box-shadow] duration-[120ms] ease-g last:border-b-0 hover:bg-g-surface-2",
                          bulkMode
                            ? "grid-cols-[40px_64px_minmax(0,1fr)] min-[980px]:grid-cols-[40px_72px_minmax(0,1.4fr)_180px_170px_130px]"
                            : "grid-cols-[64px_minmax(0,1fr)] min-[980px]:grid-cols-[72px_minmax(0,1.4fr)_180px_170px_130px]",
                          isSelected &&
                            !rowBlocked &&
                            "bg-g-surface-2 shadow-[inset_4px_0_0_var(--g-active-bg)]",
                          rowBlocked &&
                            "bg-g-surface-2 opacity-[0.72] hover:bg-g-surface-2",
                          bulkMode && rowBlocked && "cursor-not-allowed",
                        )}
                        onClick={() => {
                          if (bulkMode && !rowBlocked) toggleOne(item.id);
                        }}
                      >
                        {bulkMode && (
                          <div
                            className="grid place-items-center"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Tooltip
                              label={rowBlockedLabel}
                              placement="top"
                              contentClassName="max-w-[320px] whitespace-normal break-words"
                              disabled={!rowBlocked}
                            >
                              <span className="inline-grid">
                                <Checkbox
                                  checked={isSelected && !rowBlocked}
                                  size="md"
                                  disabled={selectionLocked || rowBlocked}
                                  onCheckedChange={() => toggleOne(item.id)}
                                  aria-label={
                                    rowBlocked
                                      ? rowBlockedLabel
                                      : isSelected
                                        ? t("action.deselect")
                                        : t("action.select")
                                  }
                                />
                              </span>
                            </Tooltip>
                          </div>
                        )}
                        <button
                          type="button"
                          className="rounded-g-md focus-visible:outline-none focus-visible:shadow-g-focus"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenAsset?.(item.id);
                          }}
                          aria-label={t("asset.openDetails", {
                            name: fileName(item.repoPath),
                          })}
                        >
                          <AssetThumbnail
                            src={item.thumbnailUrl || item.url}
                            size="md"
                            className="size-14 rounded-g-md"
                          />
                        </button>
                        <div className="min-w-0">
                          <Tooltip
                            label={item.repoPath}
                            placement="top"
                            contentClassName="max-w-[360px] whitespace-normal break-words"
                          >
                            <span className="block truncate font-g-mono text-g-body font-medium text-g-ink">
                              {fileName(item.repoPath)}
                            </span>
                          </Tooltip>
                          <Tooltip
                            label={`${item.projectName} / ${item.repoPath}`}
                            placement="top"
                            contentClassName="max-w-[420px] whitespace-normal break-words"
                          >
                            <span className="block truncate font-g-mono text-g-chip text-g-ink-4">
                              {item.projectName} / {item.repoPath}
                            </span>
                          </Tooltip>
                          <div className="mt-1 flex flex-wrap gap-1 min-[980px]:hidden">
                            {sev && (
                              <Badge
                                tone={
                                  sev === "critical"
                                    ? "red"
                                    : sev === "warning"
                                      ? "amber"
                                      : "blue"
                                }
                              >
                                {t(`severity.${sev}`)}
                              </Badge>
                            )}
                            <Badge tone="line">{operationLabel(op)}</Badge>
                            {rowBlocked && (
                              <Badge tone="amber">
                                {t("optimize.noEffectiveSavings")}
                              </Badge>
                            )}
                            <Badge tone="line">
                              {hasEstimate
                                ? `${formatBytes(item.bytes)} → ${formatBytes(estimated)}`
                                : recSavings > 0
                                  ? `${formatBytes(item.bytes)} ≈ −${formatBytes(recSavings)}`
                                  : t("optimize.pendingEstimate")}
                            </Badge>
                          </div>
                        </div>
                        <div className="hidden min-w-0 min-[980px]:block">
                          <div className="flex flex-wrap gap-1">
                            {sev && (
                              <Badge
                                tone={
                                  sev === "critical"
                                    ? "red"
                                    : sev === "warning"
                                      ? "amber"
                                      : "blue"
                                }
                              >
                                {t(`severity.${sev}`)}
                              </Badge>
                            )}
                            <Badge tone="line">{operationLabel(op)}</Badge>
                          </div>
                          {planned && !planned.canApply ? (
                            <Tooltip
                              label={blockedReasonLabel(planned)}
                              placement="top"
                              contentClassName="max-w-[420px] whitespace-normal break-words"
                            >
                              <div className="mt-1 truncate text-g-caption text-g-amber">
                                {blockedReasonLabel(planned)}
                              </div>
                            </Tooltip>
                          ) : (
                            <div className="mt-1 truncate text-g-caption text-g-ink-4">
                              {planned?.tool
                                ? `${planned.tool} ${
                                    planned.available
                                      ? t("optimize.ready")
                                      : t("optimize.blocked")
                                  }`
                                : projectScanIntentLabel(t, item.scanIntent)}
                            </div>
                          )}
                        </div>
                        <div className="hidden min-w-0 min-[980px]:block">
                          <div className="font-g-mono text-g-ui text-g-ink">
                            {hasEstimate
                              ? `${formatBytes(item.bytes)} → ${formatBytes(estimated)}`
                              : t("optimize.pendingEstimate")}
                          </div>
                          <div className="truncate text-g-chip text-g-ink-4">
                            {item.ext.replace(".", "").toUpperCase()} /{" "}
                            {item.image.width}×{item.image.height}
                          </div>
                        </div>
                        <div className="hidden text-right min-[980px]:block">
                          <div className="font-g-mono text-g-ui text-g-ink">
                            {!planned
                              ? recSavings > 0
                                ? `≈ ${formatBytes(recSavings)}`
                                : t("optimize.pendingEstimate")
                              : savings > 0
                                ? `~${formatBytes(savings)}`
                                : t("optimize.noEffectiveSavings")}
                          </div>
                          {((planned && savings > 0) ||
                            (!planned && recSavings > 0)) &&
                            item.bytes > 0 && (
                              <span className="font-g-mono text-g-chip text-g-green">
                                −
                                {Math.round(
                                  ((planned ? savings : recSavings) /
                                    item.bytes) *
                                    100,
                                )}
                                %
                              </span>
                            )}
                          <Tooltip
                            label={
                              rec
                                ? t(
                                    `optimization.suggestion.${rec.suggestionCode}`,
                                    {
                                      defaultValue: rec.suggestion,
                                    },
                                  )
                                : t("common.none")
                            }
                            placement="top"
                            align="end"
                            contentClassName="max-w-[420px] whitespace-normal break-words text-left"
                          >
                            <span className="block truncate text-g-chip text-g-ink-4">
                              {rec
                                ? t(
                                    `optimization.suggestion.${rec.suggestionCode}`,
                                    {
                                      defaultValue: rec.suggestion,
                                    },
                                  )
                                : t("common.none")}
                            </span>
                          </Tooltip>
                        </div>
                      </div>
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
        <Modal
          title={t("optimize.estimatePromptTitle")}
          onClose={() => {
            if (working == null) setEstimatePrompt(null);
          }}
          footer={
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setEstimatePrompt(null)}
                disabled={working != null}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => void runEstimateThenPreview(estimatePrompt.ids)}
                disabled={working != null}
                leadingIcon={
                  working === "estimate" || working === "preview" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : undefined
                }
              >
                {working === "estimate"
                  ? t("optimize.estimating")
                  : working === "preview"
                    ? t("optimize.optimizing")
                    : t("optimize.estimateThenPreview")}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Notice tone="warning">
              {t("optimize.estimatePromptDesc", {
                count: estimatePrompt.ids.length,
              })}
            </Notice>
            <div className="rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-g-caption text-g-ink-3">
              {t("optimize.selectionLockedDesc")}
            </div>
          </div>
        </Modal>
      )}

      {preview && (
        <OptimizePreviewModal
          preview={preview}
          itemsById={itemsById}
          replaceOriginal={replaceOriginal}
          updateReferences={updateReferences}
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
        <Modal
          title={t("optimize.quickOptimizeTitle")}
          onClose={() => setQuickConfirm(null)}
          footer={
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setQuickConfirm(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                leadingIcon={<Zap size={14} />}
                onClick={() => void runQuickOptimize(quickConfirm.ids)}
              >
                {t("optimize.quickOptimizeConfirm")}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Notice tone="info">
              {t("optimize.quickOptimizeDesc", {
                count: quickConfirm.ids.length,
              })}
            </Notice>
            <div className="rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-g-caption text-g-ink-3">
              <div className="mb-1 font-[510] text-g-ink">
                {t("optimize.quickOptimizeSteps")}
              </div>
              <ol className="list-inside list-decimal space-y-0.5">
                <li>{t("optimize.quickStep1")}</li>
                <li>{t("optimize.quickStep2")}</li>
                <li>{t("optimize.quickStep3")}</li>
              </ol>
            </div>
            <div className="rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-g-caption text-g-ink-3">
              {replaceOriginal
                ? t("optimize.quickRiskReplace")
                : t("optimize.quickRiskSafe")}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

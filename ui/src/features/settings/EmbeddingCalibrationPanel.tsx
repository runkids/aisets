import {
  ArrowRight,
  Check,
  CircleHelp,
  Loader2,
  Pencil,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeEmbeddingCalibration,
  embeddingCalibrationLabels,
  saveEmbeddingCalibrationLabel,
  semanticSearch,
} from "@/api";
import { useToast } from "@/components/shared/ToastProvider";
import type {
  EmbeddingCalibrationAnalysis,
  EmbeddingCalibrationLabel,
  SemanticSearchResult,
  SettingsInfo,
} from "@/types";
import {
  AssetThumbnail,
  Badge,
  Button,
  ImagePreview,
  Modal,
  Select,
  TextInput,
  Tooltip,
} from "@/components/ui";
import { errorMessage } from "@/i18n";
import type { SettingsDraft } from "./types";

type Props = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  imagePreviewEnabled: boolean;
  imagePreviewDelayMs: number;
  imagePreviewSize: { width: number; height: number };
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

type SearchType = "text" | "image" | "hybrid";
type LabelsResponse = { labels: EmbeddingCalibrationLabel[] | null };
type PreviewVariables = { query: string; searchType: SearchType };
const LABEL_SAVE_TIMEOUT_MS = 15_000;

function labelsQueryKey(query: string, searchType: SearchType) {
  return ["embed-calibration-labels", query, searchType] as const;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function pct(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function score(value: number) {
  return value.toFixed(3);
}

function labelsFrom(response: LabelsResponse | null | undefined) {
  return Array.isArray(response?.labels) ? response.labels : [];
}

function StepDot({
  num,
  done,
  label,
}: {
  num: number;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={
          done
            ? "grid size-5 place-items-center rounded-full bg-g-accent text-[10px] text-g-accent-ink"
            : "grid size-5 place-items-center rounded-full border border-g-line-strong font-g-mono text-[10px] font-[590] text-g-ink-3"
        }
      >
        {done ? <Check size={11} /> : num}
      </span>
      <span
        className={
          done
            ? "font-g text-g-caption font-[590] text-g-ink"
            : "font-g text-g-caption text-g-ink-3"
        }
      >
        {label}
      </span>
    </div>
  );
}

function HelpTip({ label }: { label: string }) {
  return (
    <Tooltip
      label={label}
      placement="top"
      contentClassName="max-w-[360px] leading-[1.5]"
    >
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-g-sm text-g-ink-4 transition-colors duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
        aria-label={label}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function EmbeddingCalibrationPanel({
  draft,
  settings,
  imagePreviewEnabled,
  imagePreviewDelayMs,
  imagePreviewSize,
  onUpdateDraft,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const applyTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("hybrid");
  const [applyPending, setApplyPending] = useState(false);
  const [analysis, setAnalysis] = useState<EmbeddingCalibrationAnalysis | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [previewContext, setPreviewContext] = useState<PreviewVariables | null>(
    null,
  );
  const q = query.trim();
  const activeLabelQuery = previewContext?.query ?? q;
  const activeLabelSearchType = previewContext?.searchType ?? searchType;
  const labelKey = labelsQueryKey(activeLabelQuery, activeLabelSearchType);

  const labelsQuery = useQuery({
    queryKey: labelKey,
    queryFn: () =>
      embeddingCalibrationLabels({
        q: activeLabelQuery,
        type: activeLabelSearchType,
      }),
    enabled: activeLabelQuery !== "",
  });
  const labelsByAsset = useMemo(() => {
    const map = new Map<string, "match" | "reject">();
    for (const label of labelsFrom(labelsQuery.data)) {
      map.set(label.assetId, label.label);
    }
    return map;
  }, [labelsQuery.data]);

  const previewMutation = useMutation({
    mutationFn: (variables: PreviewVariables) =>
      semanticSearch({
        q: variables.query,
        type: variables.searchType,
        limit: settings?.embedSearchLimit ?? 20,
        textThreshold: draft.embedSearchThreshold,
        imageThreshold: draft.embedImageSearchThreshold,
        imageDynamicEnabled: draft.embedImageDynamicEnabled,
        imageDynamicMargin: draft.embedImageDynamicMargin,
        includeItems: true,
      }),
  });
  const saveLabelMutation = useMutation({
    mutationFn: ({
      result,
      label,
      query,
      searchType,
    }: {
      result: SemanticSearchResult;
      label: "match" | "reject";
      query: string;
      searchType: SearchType;
    }) =>
      withTimeout(
        saveEmbeddingCalibrationLabel({
          query,
          searchType,
          assetId: result.assetId,
          projectId: result.projectId,
          repoPath: result.repoPath,
          contentHash: result.item?.contentHash ?? "",
          label,
        }),
        LABEL_SAVE_TIMEOUT_MS,
        t("settings.embedCalibrationLabelTimeout"),
      ),
    onMutate: async (variables) => {
      const key = labelsQueryKey(variables.query, variables.searchType);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LabelsResponse>(key);
      const previousLabels = labelsFrom(previous);
      const optimistic: EmbeddingCalibrationLabel = {
        id:
          previousLabels.find(
            (label) => label.assetId === variables.result.assetId,
          )?.id ?? 0,
        query: variables.query,
        searchType: variables.searchType,
        assetId: variables.result.assetId,
        projectId: variables.result.projectId,
        repoPath: variables.result.repoPath,
        contentHash: variables.result.item?.contentHash ?? "",
        label: variables.label,
        createdAt: "",
        updatedAt: "",
      };
      queryClient.setQueryData<LabelsResponse>(key, (current) => ({
        labels: [
          optimistic,
          ...labelsFrom(current).filter(
            (label) => label.assetId !== variables.result.assetId,
          ),
        ],
      }));
      return { previous, queryKey: key };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<LabelsResponse>(
        context.queryKey,
        context.previous ?? { labels: [] },
      );
    },
    onSuccess: (data, variables) => {
      const key = labelsQueryKey(variables.query, variables.searchType);
      queryClient.setQueryData<LabelsResponse>(key, (current) => ({
        labels: [
          data.label,
          ...labelsFrom(current).filter(
            (label) => label.assetId !== data.label.assetId,
          ),
        ],
      }));
    },
    onSettled: (_data, _err, variables) => {
      void queryClient.invalidateQueries({
        queryKey: labelsQueryKey(variables.query, variables.searchType),
      });
    },
  });
  const analyzeMutation = useMutation({
    mutationFn: analyzeEmbeddingCalibration,
    onSuccess: setAnalysis,
  });

  useEffect(
    () => () => {
      if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
    },
    [],
  );

  const canSearch = q !== "" && Boolean(settings?.llmEnabled);
  const results = previewMutation.data?.results ?? [];
  const busy =
    previewMutation.isPending ||
    saveLabelMutation.isPending ||
    analyzeMutation.isPending;
  const mutationError =
    saveLabelMutation.error ?? (!previewOpen ? previewMutation.error : null);
  const currentAnalysis = analyzeMutation.data ?? analysis;

  function handlePreview() {
    const variables = { query: q, searchType };
    setPreviewContext(variables);
    setPreviewOpen(false);
    previewMutation.reset();
    previewMutation.mutate(variables, {
      onSuccess: () => setPreviewOpen(true),
    });
  }

  function handleAnalyze() {
    setAnalysisOpen(true);
    analyzeMutation.reset();
    analyzeMutation.mutate();
  }

  function applyRecommendation() {
    if (!currentAnalysis) return;
    if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
    setApplyPending(true);
    toast.info(t("settings.embedCalibrationApplyWorking"), {
      durationMs: 1200,
    });
    onUpdateDraft((current) => ({
      ...current,
      embedSearchThreshold: Number(
        currentAnalysis.textRecommendation.threshold.toFixed(2),
      ),
      embedImageSearchThreshold: Number(
        currentAnalysis.imageRecommendation.threshold.toFixed(2),
      ),
      embedImageDynamicEnabled: true,
      embedImageDynamicMargin: Number(
        (currentAnalysis.imageRecommendation.margin ?? 0.05).toFixed(2),
      ),
    }));
    setAnalysisOpen(false);
    applyTimerRef.current = window.setTimeout(() => {
      setApplyPending(false);
      toast.success(t("settings.embedCalibrationApplyDone"), {
        durationMs: 2200,
      });
      applyTimerRef.current = null;
    }, 450);
  }

  const matchCount = [...labelsByAsset.values()].filter(
    (v) => v === "match",
  ).length;
  const rejectCount = [...labelsByAsset.values()].filter(
    (v) => v === "reject",
  ).length;
  const hasLabels = matchCount + rejectCount > 0;
  const stepDone1 = results.length > 0;
  const stepDone2 = hasLabels;

  return (
    <div className="min-w-[400px] overflow-hidden rounded-g-lg border border-g-line shadow-g-sm">
      {/* ── Step indicator ───────────────────────────── */}
      <div className="flex items-center gap-0 border-b border-g-line bg-g-surface px-3 py-2">
        <StepDot
          num={1}
          done={stepDone1}
          label={t("settings.embedCalibrationStep1")}
        />
        <div className="mx-1 h-px flex-1 bg-g-line" />
        <StepDot
          num={2}
          done={stepDone2}
          label={t("settings.embedCalibrationStep2")}
        />
        <div className="mx-1 h-px flex-1 bg-g-line" />
        <StepDot
          num={3}
          done={!!currentAnalysis}
          label={t("settings.embedCalibrationStep3")}
        />
      </div>

      {/* ── Step 1: Search ───────────────────────────── */}
      <div className="grid gap-2 border-b border-g-line bg-g-surface-2 p-2.5 min-[760px]:grid-cols-[1fr_140px_auto]">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.embedCalibrationQueryPlaceholder")}
          aria-label={t("settings.embedCalibrationQuery")}
        />
        <Select
          value={searchType}
          onChange={(value) => setSearchType(value as SearchType)}
          options={[
            { value: "hybrid", label: t("settings.embedTypeHybrid") },
            { value: "text", label: t("settings.embedTypeText") },
            { value: "image", label: t("settings.embedTypeImage") },
          ]}
          aria-label={t("settings.embedSearchType")}
        />
        <Button
          type="button"
          variant="primary"
          leadingIcon={
            previewMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )
          }
          disabled={!canSearch || busy}
          onClick={handlePreview}
        >
          {previewMutation.isPending
            ? t("settings.embedCalibrationPreviewing")
            : t("settings.embedCalibrationPreview")}
        </Button>
      </div>

      {mutationError && (
        <div className="border-b border-g-red/20 bg-g-red-soft px-3 py-2 text-g-caption text-g-red">
          {errorMessage(mutationError)}
        </div>
      )}

      {/* ── Step 2: Label summary ────────────────────── */}
      {stepDone1 && (
        <div className="flex items-center gap-2 border-b border-g-line bg-g-surface-2 px-3 py-2">
          {hasLabels ? (
            <span className="font-g-mono text-g-chip tabular-nums text-g-ink-3">
              {t("settings.embedCalibrationLabelSummary", {
                match: matchCount,
                reject: rejectCount,
              })}
            </span>
          ) : (
            <span className="font-g text-g-caption text-g-ink-4">
              {t("settings.embedCalibrationNoLabels")}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leadingIcon={<Pencil size={13} />}
            onClick={() => {
              if (!previewMutation.isPending) setPreviewOpen(true);
            }}
            disabled={previewMutation.isPending || results.length === 0}
          >
            {t("settings.embedCalibrationEditLabels")}
          </Button>
        </div>
      )}

      {/* ── Step 3: Analyze ──────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 bg-g-surface-2 px-3 py-2.5">
        <Button
          type="button"
          variant="secondary"
          leadingIcon={
            analyzeMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <SlidersHorizontal size={14} />
            )
          }
          disabled={busy}
          onClick={handleAnalyze}
        >
          {analyzeMutation.isPending
            ? t("settings.embedCalibrationAnalyzing")
            : t("settings.embedCalibrationAnalyze")}
        </Button>

        {currentAnalysis && (
          <>
            <div className="flex items-center gap-1.5 rounded-g-pill border border-g-blue/25 bg-g-blue-soft px-2.5 py-1 font-g-mono text-g-chip tabular-nums text-g-blue">
              <span className="font-[590]">
                {t("settings.embedCalibrationTextMetric", {
                  threshold: score(
                    currentAnalysis.textRecommendation.threshold,
                  ),
                  f1: pct(currentAnalysis.textRecommendation.f1),
                })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-g-pill border border-g-purple/25 bg-g-purple-soft px-2.5 py-1 font-g-mono text-g-chip tabular-nums text-g-purple">
              <span className="font-[590]">
                {t("settings.embedCalibrationImageMetric", {
                  threshold: score(
                    currentAnalysis.imageRecommendation.threshold,
                  ),
                  margin: score(
                    currentAnalysis.imageRecommendation.margin ?? 0,
                  ),
                  f1: pct(currentAnalysis.imageRecommendation.f1),
                })}
              </span>
            </div>
            <Button
              type="button"
              variant="primary"
              trailingIcon={
                applyPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowRight size={14} />
                )
              }
              disabled={busy || applyPending}
              onClick={applyRecommendation}
            >
              {applyPending
                ? t("settings.embedCalibrationApplying")
                : t("settings.embedCalibrationApply")}
            </Button>
          </>
        )}
      </div>

      {previewOpen && (
        <Modal
          title={t("settings.embedCalibrationPreviewTitle")}
          description={t("settings.embedCalibrationPreviewDesc", {
            query: previewContext?.query ?? q,
          })}
          onClose={() => setPreviewOpen(false)}
          size="lg"
          bodyPadding="none"
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <div className="font-g-mono text-g-chip text-g-ink-4">
                {previewMutation.data &&
                  t("settings.embedCalibrationPreviewCount", {
                    count: results.length,
                  })}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPreviewOpen(false)}
              >
                {t("common.close")}
              </Button>
            </div>
          }
        >
          <div className="p-3">
            {results.length === 0 && (
              <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-3">
                {t("settings.embedCalibrationNoResults")}
              </div>
            )}

            {results.length > 0 && (
              <div className="grid gap-1.5">
                {results.map((result) => {
                  const label = labelsByAsset.get(result.assetId);
                  const pendingLabel =
                    saveLabelMutation.isPending &&
                    saveLabelMutation.variables?.result.assetId ===
                      result.assetId
                      ? saveLabelMutation.variables.label
                      : null;
                  return (
                    <div
                      key={result.assetId}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-2 py-1.5"
                    >
                      <ImagePreview
                        src={result.item?.url || result.thumbnailUrl}
                        alt={result.repoPath}
                        enabled={imagePreviewEnabled}
                        delayMs={imagePreviewDelayMs}
                        size={imagePreviewSize}
                      >
                        <AssetThumbnail
                          src={result.thumbnailUrl}
                          alt={result.repoPath}
                          size="sm"
                        />
                      </ImagePreview>
                      <div className="min-w-0">
                        <div className="truncate font-g text-g-ui font-[510] text-g-ink">
                          {result.repoPath}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-g-mono text-g-chip text-g-ink-4">
                          <span>{score(result.similarity)}</span>
                          <span>{result.matchType ?? "semantic"}</span>
                          {label && (
                            <Badge tone={label === "match" ? "green" : "red"}>
                              {label === "match"
                                ? t("settings.embedCalibrationMatch")
                                : t("settings.embedCalibrationReject")}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={label === "match" ? "primary" : "secondary"}
                          leadingIcon={
                            pendingLabel === "match" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )
                          }
                          disabled={busy}
                          onClick={() =>
                            saveLabelMutation.mutate({
                              result,
                              label: "match",
                              query: previewContext?.query ?? q,
                              searchType:
                                previewContext?.searchType ?? searchType,
                            })
                          }
                        >
                          {t("settings.embedCalibrationMatch")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={label === "reject" ? "danger" : "secondary"}
                          leadingIcon={
                            pendingLabel === "reject" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <X size={13} />
                            )
                          }
                          disabled={busy}
                          onClick={() =>
                            saveLabelMutation.mutate({
                              result,
                              label: "reject",
                              query: previewContext?.query ?? q,
                              searchType:
                                previewContext?.searchType ?? searchType,
                            })
                          }
                        >
                          {t("settings.embedCalibrationReject")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

      {analysisOpen && (
        <Modal
          title={t("settings.embedCalibrationAnalysisTitle")}
          description={t("settings.embedCalibrationAnalysisDesc")}
          onClose={() => setAnalysisOpen(false)}
          size="md"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAnalysisOpen(false)}
              >
                {t("common.close")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                leadingIcon={
                  applyPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : undefined
                }
                disabled={!currentAnalysis || busy || applyPending}
                onClick={applyRecommendation}
              >
                {applyPending
                  ? t("settings.embedCalibrationApplying")
                  : t("settings.embedCalibrationApply")}
              </Button>
            </div>
          }
        >
          {analyzeMutation.isPending && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-g-md border border-g-line bg-g-surface-2 font-g text-g-ui text-g-ink-3">
              <Loader2 size={18} className="animate-spin" />
              <span>{t("settings.embedCalibrationAnalysisLoading")}</span>
            </div>
          )}

          {analyzeMutation.error && (
            <div className="rounded-g-md border border-g-red/30 bg-g-red/5 p-3 text-g-caption text-g-red">
              {errorMessage(analyzeMutation.error)}
            </div>
          )}

          {!analyzeMutation.isPending && !analyzeMutation.error && (
            <div className="space-y-3">
              {currentAnalysis && (
                <>
                  <div className="grid gap-2 min-[560px]:grid-cols-3">
                    <div className="rounded-g-md border border-g-line bg-g-surface-2 p-2">
                      <div className="flex items-center gap-1 font-g text-g-chip text-g-ink-4">
                        <span>{t("settings.embedCalibrationLabels")}</span>
                        <HelpTip
                          label={t("settings.embedCalibrationLabelsHelp")}
                        />
                      </div>
                      <div className="font-g-mono text-g-body text-g-ink">
                        {currentAnalysis.labels}
                      </div>
                    </div>
                    <div className="rounded-g-md border border-g-line bg-g-surface-2 p-2">
                      <div className="flex items-center gap-1 font-g text-g-chip text-g-ink-4">
                        <span>{t("settings.embedCalibrationScored")}</span>
                        <HelpTip
                          label={t("settings.embedCalibrationScoredHelp")}
                        />
                      </div>
                      <div className="font-g-mono text-g-body text-g-ink">
                        {currentAnalysis.scored}
                      </div>
                    </div>
                    <div className="rounded-g-md border border-g-line bg-g-surface-2 p-2">
                      <div className="flex items-center gap-1 font-g text-g-chip text-g-ink-4">
                        <span>{t("settings.embedCalibrationSkipped")}</span>
                        <HelpTip
                          label={t("settings.embedCalibrationSkippedHelp")}
                        />
                      </div>
                      <div className="font-g-mono text-g-body text-g-ink">
                        {currentAnalysis.skipped}
                      </div>
                    </div>
                  </div>

                  {currentAnalysis.labels === 0 && (
                    <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-3">
                      {t("settings.embedCalibrationAnalysisNoLabels")}
                    </div>
                  )}

                  {currentAnalysis.labels > 0 &&
                    currentAnalysis.scored === 0 && (
                      <div className="rounded-g-md border border-g-line bg-g-surface-2 p-3 text-g-ui text-g-ink-3">
                        {t("settings.embedCalibrationAnalysisNoScores")}
                      </div>
                    )}

                  <div className="grid gap-2">
                    <div className="rounded-g-md border border-g-line bg-g-surface p-3">
                      <div className="mb-2 flex items-center gap-1 font-g text-g-ui font-[590] text-g-ink">
                        <span>{t("settings.embedCalibrationText")}</span>
                        <HelpTip
                          label={t("settings.embedCalibrationTextHint")}
                        />
                      </div>
                      <div className="grid gap-1 font-g-mono text-g-chip text-g-ink-3">
                        <span>
                          {t("settings.embedCalibrationThreshold", {
                            threshold: score(
                              currentAnalysis.textRecommendation.threshold,
                            ),
                          })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>
                            {t("settings.embedCalibrationMetricDetail", {
                              precision: pct(
                                currentAnalysis.textRecommendation.precision,
                              ),
                              recall: pct(
                                currentAnalysis.textRecommendation.recall,
                              ),
                              f1: pct(currentAnalysis.textRecommendation.f1),
                            })}
                          </span>
                          <HelpTip
                            label={t("settings.embedCalibrationMetricHelp")}
                          />
                        </span>
                      </div>
                    </div>

                    <div className="rounded-g-md border border-g-line bg-g-surface p-3">
                      <div className="mb-2 flex items-center gap-1 font-g text-g-ui font-[590] text-g-ink">
                        <span>{t("settings.embedCalibrationImage")}</span>
                        <HelpTip
                          label={t("settings.embedCalibrationImageHint")}
                        />
                      </div>
                      <div className="grid gap-1 font-g-mono text-g-chip text-g-ink-3">
                        <span>
                          {t("settings.embedCalibrationThreshold", {
                            threshold: score(
                              currentAnalysis.imageRecommendation.threshold,
                            ),
                          })}
                        </span>
                        <span>
                          {t("settings.embedCalibrationMargin", {
                            margin: score(
                              currentAnalysis.imageRecommendation.margin ?? 0,
                            ),
                          })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>
                            {t("settings.embedCalibrationMetricDetail", {
                              precision: pct(
                                currentAnalysis.imageRecommendation.precision,
                              ),
                              recall: pct(
                                currentAnalysis.imageRecommendation.recall,
                              ),
                              f1: pct(currentAnalysis.imageRecommendation.f1),
                            })}
                          </span>
                          <HelpTip
                            label={t("settings.embedCalibrationMetricHelp")}
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

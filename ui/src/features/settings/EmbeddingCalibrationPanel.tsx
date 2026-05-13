import {
  ArrowRight,
  Check,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeEmbeddingCalibration,
  embeddingCalibrationLabels,
  saveEmbeddingCalibrationLabel,
  semanticSearch,
} from "@/api";
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
  Select,
  TextInput,
} from "@/components/ui";
import { errorMessage } from "@/i18n";
import type { SettingsDraft } from "./types";

type Props = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

type SearchType = "text" | "image" | "hybrid";
type LabelsResponse = { labels: EmbeddingCalibrationLabel[] };

function labelsQueryKey(query: string, searchType: SearchType) {
  return ["embed-calibration-labels", query, searchType] as const;
}

function pct(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function score(value: number) {
  return value.toFixed(3);
}

function MetricCard({
  label,
  tone,
  threshold,
  margin,
  f1,
  t,
}: {
  label: string;
  tone: "blue" | "purple";
  threshold: string;
  margin?: string;
  f1: string;
  t: (key: string) => string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-g-md border border-g-line bg-g-surface px-2.5 py-2">
      <Badge tone={tone}>{label}</Badge>
      <div className="flex items-center gap-1.5 font-g-mono text-g-chip tabular-nums">
        <span className="text-g-ink-4">{t("settings.embedCalibrationThreshold")}</span>
        <span className="font-[590] text-g-ink">{threshold}</span>
      </div>
      {margin != null && (
        <div className="flex items-center gap-1.5 font-g-mono text-g-chip tabular-nums">
          <span className="text-g-ink-4">{t("settings.embedCalibrationMargin")}</span>
          <span className="font-[590] text-g-ink">{margin}</span>
        </div>
      )}
      <Badge tone="green">F1 {f1}</Badge>
    </div>
  );
}

export function EmbeddingCalibrationPanel({
  draft,
  settings,
  onUpdateDraft,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("hybrid");
  const [analysis, setAnalysis] = useState<EmbeddingCalibrationAnalysis | null>(
    null,
  );
  const q = query.trim();
  const labelKey = labelsQueryKey(q, searchType);

  const labelsQuery = useQuery({
    queryKey: labelKey,
    queryFn: () => embeddingCalibrationLabels({ q, type: searchType }),
    enabled: q !== "",
  });
  const labelsByAsset = useMemo(() => {
    const map = new Map<string, "match" | "reject">();
    for (const label of labelsQuery.data?.labels ?? []) {
      map.set(label.assetId, label.label);
    }
    return map;
  }, [labelsQuery.data?.labels]);

  const previewMutation = useMutation({
    mutationFn: () =>
      semanticSearch({
        q,
        type: searchType,
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
      saveEmbeddingCalibrationLabel({
        query,
        searchType,
        assetId: result.assetId,
        projectId: result.projectId,
        repoPath: result.repoPath,
        contentHash: result.item?.contentHash ?? "",
        label,
      }),
    onMutate: async (variables) => {
      const key = labelsQueryKey(variables.query, variables.searchType);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LabelsResponse>(key);
      const optimistic: EmbeddingCalibrationLabel = {
        id: previous?.labels.find(
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
          ...(current?.labels ?? []).filter(
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
          ...(current?.labels ?? []).filter(
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

  const canSearch = q !== "" && Boolean(settings?.llmEnabled);
  const results = previewMutation.data?.results ?? [];
  const busy =
    previewMutation.isPending ||
    saveLabelMutation.isPending ||
    analyzeMutation.isPending;
  const mutationError =
    previewMutation.error ?? saveLabelMutation.error ?? analyzeMutation.error;

  function applyRecommendation() {
    if (!analysis) return;
    onUpdateDraft((current) => ({
      ...current,
      embedSearchThreshold: Number(
        analysis.textRecommendation.threshold.toFixed(2),
      ),
      embedImageSearchThreshold: Number(
        analysis.imageRecommendation.threshold.toFixed(2),
      ),
      embedImageDynamicEnabled: true,
      embedImageDynamicMargin: Number(
        (analysis.imageRecommendation.margin ?? 0.05).toFixed(2),
      ),
    }));
  }

  return (
    <div className="min-w-[400px] space-y-3 rounded-g-md border border-g-line bg-g-surface-2 p-3">
      {/* ── Search row ───────────────────────────────── */}
      <div className="grid gap-2 min-[760px]:grid-cols-[1fr_140px_auto]">
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
          variant="secondary"
          leadingIcon={
            previewMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )
          }
          disabled={!canSearch || busy}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending
            ? t("settings.embedCalibrationPreviewing")
            : t("settings.embedCalibrationPreview")}
        </Button>
      </div>

      {mutationError && (
        <div className="text-g-caption text-g-red">
          {errorMessage(mutationError)}
        </div>
      )}

      {previewMutation.isPending && (
        <div className="flex items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-2 py-2 font-g text-g-ui text-g-ink-3">
          <Loader2 size={14} className="animate-spin" />
          <span>{t("settings.embedCalibrationLoading")}</span>
        </div>
      )}

      {/* ── Results list ─────────────────────────────── */}
      {results.length > 0 && (
        <div className="grid gap-1.5">
          {results.map((result) => {
            const label = labelsByAsset.get(result.assetId);
            const pendingLabel =
              saveLabelMutation.isPending &&
              saveLabelMutation.variables?.result.assetId === result.assetId
                ? saveLabelMutation.variables.label
                : null;
            return (
              <div
                key={result.assetId}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-g-md border border-g-line bg-g-surface px-2 py-1.5"
              >
                <AssetThumbnail
                  src={result.thumbnailUrl}
                  alt={result.repoPath}
                  size="sm"
                />
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
                        query: q,
                        searchType,
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
                        query: q,
                        searchType,
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

      {/* ── Analysis section ─────────────────────────── */}
      <div className="space-y-2.5 border-t border-g-line pt-3">
        <div className="flex items-center gap-2">
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
            onClick={() => analyzeMutation.mutate()}
          >
            {analyzeMutation.isPending
              ? t("settings.embedCalibrationAnalyzing")
              : t("settings.embedCalibrationAnalyze")}
          </Button>
          {!analysis && (
            <span className="font-g text-g-caption text-g-ink-4">
              {t("settings.embedCalibrationNoLabels")}
            </span>
          )}
        </div>

        {analysis && (
          <div className="flex flex-wrap items-stretch gap-2">
            <MetricCard
              label={t("settings.embedCalibrationTextLabel")}
              tone="blue"
              threshold={score(analysis.textRecommendation.threshold)}
              f1={pct(analysis.textRecommendation.f1)}
              t={t}
            />
            <MetricCard
              label={t("settings.embedCalibrationImageLabel")}
              tone="purple"
              threshold={score(analysis.imageRecommendation.threshold)}
              margin={score(analysis.imageRecommendation.margin ?? 0)}
              f1={pct(analysis.imageRecommendation.f1)}
              t={t}
            />
            <Button
              type="button"
              variant="primary"
              trailingIcon={<ArrowRight size={14} />}
              disabled={busy}
              onClick={applyRecommendation}
              className="self-center"
            >
              {t("settings.embedCalibrationApply")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

import { Check, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  analyzeEmbeddingCalibration,
  embeddingCalibrationLabels,
  saveEmbeddingCalibrationLabel,
  semanticSearch,
} from "@/api";
import type {
  EmbeddingCalibrationAnalysis,
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

function pct(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function score(value: number) {
  return value.toFixed(3);
}

export function EmbeddingCalibrationPanel({
  draft,
  settings,
  onUpdateDraft,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("hybrid");
  const [analysis, setAnalysis] = useState<EmbeddingCalibrationAnalysis | null>(
    null,
  );
  const q = query.trim();

  const labelsQuery = useQuery({
    queryKey: ["embed-calibration-labels", q, searchType],
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
    }: {
      result: SemanticSearchResult;
      label: "match" | "reject";
    }) =>
      saveEmbeddingCalibrationLabel({
        query: q,
        searchType,
        assetId: result.assetId,
        projectId: result.projectId,
        repoPath: result.repoPath,
        contentHash: result.item?.contentHash ?? "",
        label,
      }),
    onSuccess: () => {
      void labelsQuery.refetch();
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
          leadingIcon={<Search size={14} />}
          disabled={!canSearch || busy}
          onClick={() => previewMutation.mutate()}
        >
          {t("settings.embedCalibrationPreview")}
        </Button>
      </div>

      {previewMutation.error && (
        <div className="text-g-caption text-g-red">
          {errorMessage(previewMutation.error)}
        </div>
      )}

      {results.length > 0 && (
        <div className="grid gap-1.5">
          {results.map((result) => {
            const label = labelsByAsset.get(result.assetId);
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
                    leadingIcon={<Check size={13} />}
                    disabled={busy}
                    onClick={() =>
                      saveLabelMutation.mutate({ result, label: "match" })
                    }
                  >
                    {t("settings.embedCalibrationMatch")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={label === "reject" ? "danger" : "secondary"}
                    leadingIcon={<X size={13} />}
                    disabled={busy}
                    onClick={() =>
                      saveLabelMutation.mutate({ result, label: "reject" })
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-g-line pt-3">
        <Button
          type="button"
          variant="secondary"
          leadingIcon={<SlidersHorizontal size={14} />}
          disabled={busy}
          onClick={() => analyzeMutation.mutate()}
        >
          {t("settings.embedCalibrationAnalyze")}
        </Button>
        {analysis && (
          <div className="flex flex-wrap items-center gap-2 font-g-mono text-g-chip text-g-ink-3">
            <span>
              {t("settings.embedCalibrationTextMetric", {
                threshold: score(analysis.textRecommendation.threshold),
                f1: pct(analysis.textRecommendation.f1),
              })}
            </span>
            <span>
              {t("settings.embedCalibrationImageMetric", {
                threshold: score(analysis.imageRecommendation.threshold),
                margin: score(analysis.imageRecommendation.margin ?? 0),
                f1: pct(analysis.imageRecommendation.f1),
              })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={applyRecommendation}
            >
              {t("settings.embedCalibrationApply")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

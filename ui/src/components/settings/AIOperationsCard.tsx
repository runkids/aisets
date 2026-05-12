import {
  LoaderCircle,
  Play,
  ScanText,
  ShieldCheck,
  Square,
  Star,
  Tags,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useEmbedRepairCheckQuery,
  usePromptPresetsQuery,
  useRepairEmbeddingsMutation,
} from "../../queries";
import { errorMessage } from "../../i18n";
import type { AITagActivityState } from "../../activity/aiTagActivity";
import { isAITagActivityBusy } from "../../activity/aiTagActivity";
import type { VLMOcrActivityState } from "../../activity/vlmOcrActivity";
import { isVLMOcrActivityBusy } from "../../activity/vlmOcrActivity";
import type { EmbedActivityState } from "../../activity/embedActivity";
import { isEmbedActivityBusy } from "../../activity/embedActivity";
import type {
  AITagRunCounts,
  EmbedRepairCounts,
  EmbedRunCounts,
  SettingsInfo,
  VLMOcrRunCounts,
  Workspace,
} from "../../types";
import type { ScopeProject } from "./AIScopePicker";
import { AIScopePicker } from "./AIScopePicker";
import { Button, Card, Select } from "../ui";
import {
  AITagProgressText,
  VLMOcrProgressText,
  EmbedProgressText,
  LastRunText,
} from "./AIActivityProgress";
import type { LastRunRecord } from "./aiSectionUtils";
import {
  AI_TAG_LAST_RUN_KEY,
  VLM_OCR_LAST_RUN_KEY,
  EMBED_LAST_RUN_KEY,
  clearLastRun,
  readLastRun,
  saveLastRun,
} from "./aiSectionUtils";
import type { SettingsDraft } from "./types";
import { useToast } from "../shared/ToastProvider";

type AIOperationsCardProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  working: boolean;
  aiBusy: boolean;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  embedActivity: EmbedActivityState;
  workspaces: Workspace[];
  projects: ScopeProject[];
  activeWorkspaceId: string;
  onStartAITag: (
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopAITag: () => void;
  onStartVLMOcr: (
    presetId?: string,
    projectIds?: string[],
    scopeLabel?: string,
  ) => void;
  onStopVLMOcr: () => void;
  onStartEmbed: (
    projectIds?: string[],
    scopeLabel?: string,
    force?: boolean,
  ) => void;
  onStopEmbed: () => void;
};

export function AIOperationsCard({
  draft,
  settings,
  working,
  aiBusy,
  aiTagActivity,
  vlmOcrActivity,
  embedActivity,
  workspaces,
  projects,
  activeWorkspaceId,
  onStartAITag,
  onStopAITag,
  onStartVLMOcr,
  onStopVLMOcr,
  onStartEmbed,
  onStopEmbed,
}: AIOperationsCardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const repairEmbeddingsMutation = useRepairEmbeddingsMutation();

  const tagPresetsQuery = usePromptPresetsQuery("tag");
  const ocrPresetsQuery = usePromptPresetsQuery("ocr");
  const [selectedTagPresetIdOverride, setSelectedTagPresetId] =
    useState<string>("");
  const [selectedOcrPresetIdOverride, setSelectedOcrPresetId] =
    useState<string>("");

  const tagDefaultPresetId = useMemo(
    () => tagPresetsQuery.data?.presets?.find((p) => p.isDefault)?.id ?? "",
    [tagPresetsQuery.data?.presets],
  );
  const ocrDefaultPresetId = useMemo(
    () => ocrPresetsQuery.data?.presets?.find((p) => p.isDefault)?.id ?? "",
    [ocrPresetsQuery.data?.presets],
  );
  const selectedTagPresetId = selectedTagPresetIdOverride || tagDefaultPresetId;
  const selectedOcrPresetId = selectedOcrPresetIdOverride || ocrDefaultPresetId;

  const [tagWorkspaceId, setTagWorkspaceId] =
    useState<string>(activeWorkspaceId);
  const [tagProjectId, setTagProjectId] = useState<string>("");
  const [ocrWorkspaceId, setOcrWorkspaceId] =
    useState<string>(activeWorkspaceId);
  const [ocrProjectId, setOcrProjectId] = useState<string>("");
  const [embedWorkspaceId, setEmbedWorkspaceId] =
    useState<string>(activeWorkspaceId);
  const [embedProjectId, setEmbedProjectId] = useState<string>("");

  function resolveProjectIds(
    wsId: string,
    projId: string,
  ): string[] | undefined {
    if (projId) return [projId];
    if (wsId) {
      const ids = projects
        .filter((p) => p.workspaceId === wsId)
        .map((p) => p.id);
      return ids.length ? ids : undefined;
    }
    return undefined;
  }

  const resolveScopeLabel = useCallback(
    (wsId: string, projId: string): string => {
      const allLabel = t("settings.aiLastRunScopeAll");
      const wsName = wsId
        ? (workspaces.find((w) => w.id === wsId)?.name ?? wsId)
        : allLabel;
      const projName = projId
        ? (projects.find((p) => p.id === projId)?.name ?? projId)
        : allLabel;
      return `${wsName} / ${projName}`;
    },
    [t, workspaces, projects],
  );

  // ── LastRun persistence ────────────────────────────────────────

  const [lastAITagRun, setLastAITagRun] =
    useState<LastRunRecord<AITagRunCounts> | null>(() =>
      readLastRun<AITagRunCounts>(AI_TAG_LAST_RUN_KEY),
    );
  const [lastVLMOcrRun, setLastVLMOcrRun] =
    useState<LastRunRecord<VLMOcrRunCounts> | null>(() =>
      readLastRun<VLMOcrRunCounts>(VLM_OCR_LAST_RUN_KEY),
    );
  const [lastEmbedRun, setLastEmbedRun] =
    useState<LastRunRecord<EmbedRunCounts> | null>(() =>
      readLastRun<EmbedRunCounts>(EMBED_LAST_RUN_KEY),
    );

  const prevAITagPhase = useRef(aiTagActivity.phase);
  useEffect(() => {
    const prev = prevAITagPhase.current;
    prevAITagPhase.current = aiTagActivity.phase;
    if (
      (prev === "running" || prev === "stopping" || prev === "saving") &&
      (aiTagActivity.phase === "done" ||
        aiTagActivity.phase === "stopped" ||
        aiTagActivity.phase === "error") &&
      aiTagActivity.counts
    ) {
      const sl = aiTagActivity.scopeLabel;
      const elapsedMs =
        aiTagActivity.startedAt != null
          ? Date.now() - aiTagActivity.startedAt
          : undefined;
      const pn = aiTagActivity.providerName;
      const mn = aiTagActivity.modelName;
      const errs =
        aiTagActivity.errors.length > 0 ? aiTagActivity.errors : undefined;
      const record: LastRunRecord<AITagRunCounts> = {
        counts: aiTagActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
        elapsedMs,
        providerName: pn,
        modelName: mn,
        errors: errs,
      };
      saveLastRun(
        AI_TAG_LAST_RUN_KEY,
        aiTagActivity.counts,
        sl,
        elapsedMs,
        pn,
        mn,
        errs,
      );
      setLastAITagRun(record);
    }
  }, [
    aiTagActivity.phase,
    aiTagActivity.counts,
    aiTagActivity.startedAt,
    aiTagActivity.scopeLabel,
  ]);

  const prevVLMOcrPhase = useRef(vlmOcrActivity.phase);
  useEffect(() => {
    const prev = prevVLMOcrPhase.current;
    prevVLMOcrPhase.current = vlmOcrActivity.phase;
    if (
      (prev === "running" || prev === "stopping" || prev === "saving") &&
      (vlmOcrActivity.phase === "done" ||
        vlmOcrActivity.phase === "stopped" ||
        vlmOcrActivity.phase === "error") &&
      vlmOcrActivity.counts
    ) {
      const sl = vlmOcrActivity.scopeLabel;
      const elapsedMs =
        vlmOcrActivity.startedAt != null
          ? Date.now() - vlmOcrActivity.startedAt
          : undefined;
      const pn = vlmOcrActivity.providerName;
      const mn = vlmOcrActivity.modelName;
      const errs =
        vlmOcrActivity.errors.length > 0 ? vlmOcrActivity.errors : undefined;
      const record: LastRunRecord<VLMOcrRunCounts> = {
        counts: vlmOcrActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
        elapsedMs,
        providerName: pn,
        modelName: mn,
        errors: errs,
      };
      saveLastRun(
        VLM_OCR_LAST_RUN_KEY,
        vlmOcrActivity.counts,
        sl,
        elapsedMs,
        pn,
        mn,
        errs,
      );
      setLastVLMOcrRun(record);
    }
  }, [
    vlmOcrActivity.phase,
    vlmOcrActivity.counts,
    vlmOcrActivity.startedAt,
    vlmOcrActivity.scopeLabel,
  ]);

  const prevEmbedPhase = useRef(embedActivity.phase);
  useEffect(() => {
    const prev = prevEmbedPhase.current;
    prevEmbedPhase.current = embedActivity.phase;
    if (
      (prev === "running" || prev === "stopping") &&
      (embedActivity.phase === "done" ||
        embedActivity.phase === "stopped" ||
        embedActivity.phase === "error") &&
      embedActivity.counts
    ) {
      const sl = embedActivity.scopeLabel;
      const elapsedMs =
        embedActivity.startedAt != null
          ? Date.now() - embedActivity.startedAt
          : undefined;
      const pn = embedActivity.providerName;
      const mn = embedActivity.modelName;
      const errs =
        embedActivity.errors.length > 0 ? embedActivity.errors : undefined;
      const record: LastRunRecord<EmbedRunCounts> = {
        counts: embedActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
        elapsedMs,
        providerName: pn,
        modelName: mn,
        errors: errs,
      };
      saveLastRun(
        EMBED_LAST_RUN_KEY,
        embedActivity.counts,
        sl,
        elapsedMs,
        pn,
        mn,
        errs,
      );
      setLastEmbedRun(record);
    }
  }, [
    embedActivity.phase,
    embedActivity.counts,
    embedActivity.startedAt,
    embedActivity.scopeLabel,
  ]);

  const providerEnabled = draft.llmEnabled && draft.llmProvider !== "";
  const agentDetected = !!settings?.agentRuntime?.available;
  const vlmAvailable =
    providerEnabled ||
    agentDetected ||
    (settings?.agentRuntime?.adapters?.length ?? 0) > 0;
  const repairCheckQuery = useEmbedRepairCheckQuery(vlmAvailable);
  const repairCheckCounts = repairCheckQuery.data?.counts;
  const repairableIssueCount = repairCheckCounts
    ? repairCheckCounts.invalidAiTags +
      repairCheckCounts.clearedI18nEntries +
      repairCheckCounts.deletedStaleTextEmbeddings
    : 0;
  const hasRepairableIssues = repairableIssueCount > 0;
  const repairCheckBusy =
    repairCheckQuery.isFetching || repairEmbeddingsMutation.isPending;

  function embedRepairSummary(counts: EmbedRepairCounts) {
    return t("settings.embedRepairResult", {
      invalid: counts.invalidAiTags,
      i18n: counts.clearedI18nEntries,
      embeddings: counts.deletedStaleTextEmbeddings,
      skipped: counts.skippedRows,
    });
  }

  function embedRepairStatusText() {
    if (repairCheckQuery.isFetching) return t("settings.embedRepairChecking");
    if (repairCheckQuery.isError) return t("settings.embedRepairCheckFailed");
    if (!repairCheckCounts) return null;
    if (hasRepairableIssues) return t("settings.embedRepairNeedsRepair");
    return null;
  }

  async function onCheckEmbeddingRepair() {
    try {
      const result = await repairCheckQuery.refetch({ throwOnError: true });
      const counts = result.data?.counts;
      if (!counts) return;
      const repairable =
        counts.invalidAiTags +
        counts.clearedI18nEntries +
        counts.deletedStaleTextEmbeddings;
      if (repairable > 0 || counts.skippedRows > 0) {
        toast.show("warning", embedRepairSummary(counts), {
          title: t("settings.embedRepairCheckIssues"),
          durationMs: 6000,
        });
        return;
      }
      toast.success(t("settings.embedRepairClean"), {
        title: t("settings.embedRepairCheckSuccess"),
      });
    } catch (err) {
      toast.error(errorMessage(err), {
        title: t("settings.embedRepairFailed"),
      });
    }
  }

  function onRepairEmbeddings(apply: boolean) {
    repairEmbeddingsMutation.mutate(apply, {
      onSuccess: (result) => {
        if (apply) {
          clearLastRun(EMBED_LAST_RUN_KEY);
          setLastEmbedRun(null);
        }
        toast.success(embedRepairSummary(result.counts), {
          title: t(
            apply
              ? "settings.embedRepairApplySuccess"
              : "settings.embedRepairCheckSuccess",
          ),
          durationMs: 6000,
        });
      },
      onError: (err) => {
        toast.error(errorMessage(err), {
          title: t("settings.embedRepairFailed"),
        });
      },
    });
  }

  if (!vlmAvailable) return null;

  return (
    <Card
      className="border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
      padding="none"
    >
      {/* ── AI Tag ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-6 pt-3 pb-1 md:px-8">
        <Tags size={15} className="shrink-0 text-g-ink-3" />
        <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
          {t("settings.aiTagGroup")}
        </span>
      </div>
      <div className="flex items-start justify-between gap-6 px-6 pt-1 pb-3 md:px-8">
        <p className="font-g text-g-ui tracking-g-ui text-g-ink-3 pt-1.5 max-w-[28ch]">
          {t("settings.aiTagDescription")}
        </p>
        <div className="flex flex-col gap-1.5 shrink-0 w-[520px]">
          {!isAITagActivityBusy(aiTagActivity) && (
            <AIScopePicker
              workspaces={workspaces}
              projects={projects}
              selectedWorkspaceId={tagWorkspaceId}
              selectedProjectId={tagProjectId}
              disabled={isAITagActivityBusy(aiTagActivity)}
              onChangeWorkspace={setTagWorkspaceId}
              onChangeProject={setTagProjectId}
            />
          )}
          <div className="flex items-center justify-end gap-1.5">
            {isAITagActivityBusy(aiTagActivity) ? (
              <Button
                variant="secondary"
                leadingIcon={
                  aiTagActivity.phase === "stopping" ? (
                    <LoaderCircle
                      size={14}
                      className="animate-[icon-spin_900ms_linear_infinite]"
                    />
                  ) : (
                    <Square size={14} />
                  )
                }
                onClick={onStopAITag}
                disabled={aiTagActivity.phase === "stopping"}
              >
                {aiTagActivity.phase === "stopping"
                  ? t("settings.aiTagStopping")
                  : t("settings.aiTagStop")}
              </Button>
            ) : (
              <>
                {tagPresetsQuery.data?.presets &&
                  tagPresetsQuery.data.presets.length > 0 && (
                    <Select
                      value={selectedTagPresetId}
                      options={tagPresetsQuery.data.presets.map((p) => ({
                        value: p.id,
                        label: p.name,
                        icon: p.isDefault ? (
                          <Star
                            size={14}
                            className="fill-current text-g-yellow"
                          />
                        ) : undefined,
                      }))}
                      onChange={setSelectedTagPresetId}
                      aria-label={t("settings.aiTagGroup")}
                      className="min-w-0 flex-1"
                    />
                  )}
                <Button
                  variant="primary"
                  leadingIcon={<Play size={14} />}
                  disabled={working || draft.llmVisionModel === ""}
                  onClick={() =>
                    onStartAITag(
                      selectedTagPresetId || undefined,
                      resolveProjectIds(tagWorkspaceId, tagProjectId),
                      resolveScopeLabel(tagWorkspaceId, tagProjectId),
                    )
                  }
                >
                  {t("settings.aiTagRun")}
                </Button>
              </>
            )}
          </div>
          {isAITagActivityBusy(aiTagActivity) ||
          aiTagActivity.phase === "error" ? (
            <AITagProgressText
              activity={aiTagActivity}
              startedAt={aiTagActivity.startedAt}
            />
          ) : lastAITagRun ? (
            <LastRunText
              counts={lastAITagRun.counts}
              timestamp={lastAITagRun.timestamp}
              scopeLabel={lastAITagRun.scopeLabel}
              elapsedMs={lastAITagRun.elapsedMs}
              providerName={lastAITagRun.providerName}
              modelName={lastAITagRun.modelName}
              errors={lastAITagRun.errors}
            />
          ) : null}
        </div>
      </div>

      {/* ── VLM OCR ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 border-t border-g-line px-6 pt-3 pb-1 md:px-8">
        <ScanText size={15} className="shrink-0 text-g-ink-3" />
        <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
          {t("settings.aiOcrGroup")}
        </span>
      </div>
      <div className="flex items-start justify-between gap-6 px-6 pt-1 pb-3 md:px-8">
        <p className="font-g text-g-ui tracking-g-ui text-g-ink-3 pt-1.5 max-w-[28ch]">
          {t("settings.aiOcrDescription")}
        </p>
        <div className="flex flex-col gap-1.5 shrink-0 w-[520px]">
          {!isVLMOcrActivityBusy(vlmOcrActivity) && (
            <AIScopePicker
              workspaces={workspaces}
              projects={projects}
              selectedWorkspaceId={ocrWorkspaceId}
              selectedProjectId={ocrProjectId}
              disabled={isVLMOcrActivityBusy(vlmOcrActivity)}
              onChangeWorkspace={setOcrWorkspaceId}
              onChangeProject={setOcrProjectId}
            />
          )}
          <div className="flex items-center justify-end gap-1.5">
            {isVLMOcrActivityBusy(vlmOcrActivity) ? (
              <Button
                variant="secondary"
                leadingIcon={
                  vlmOcrActivity.phase === "stopping" ? (
                    <LoaderCircle
                      size={14}
                      className="animate-[icon-spin_900ms_linear_infinite]"
                    />
                  ) : (
                    <Square size={14} />
                  )
                }
                onClick={onStopVLMOcr}
                disabled={vlmOcrActivity.phase === "stopping"}
              >
                {vlmOcrActivity.phase === "stopping"
                  ? t("settings.aiOcrStopping")
                  : t("settings.aiOcrStop")}
              </Button>
            ) : (
              <>
                {ocrPresetsQuery.data?.presets &&
                  ocrPresetsQuery.data.presets.length > 0 && (
                    <Select
                      value={selectedOcrPresetId}
                      options={ocrPresetsQuery.data.presets.map((p) => ({
                        value: p.id,
                        label: p.name,
                        icon: p.isDefault ? (
                          <Star
                            size={14}
                            className="fill-current text-g-yellow"
                          />
                        ) : undefined,
                      }))}
                      onChange={setSelectedOcrPresetId}
                      aria-label={t("settings.aiOcrGroup")}
                      className="min-w-0 flex-1"
                    />
                  )}
                <Button
                  variant="primary"
                  leadingIcon={<Play size={14} />}
                  disabled={working || draft.llmVisionModel === ""}
                  onClick={() =>
                    onStartVLMOcr(
                      selectedOcrPresetId || undefined,
                      resolveProjectIds(ocrWorkspaceId, ocrProjectId),
                      resolveScopeLabel(ocrWorkspaceId, ocrProjectId),
                    )
                  }
                >
                  {t("settings.aiOcrRun")}
                </Button>
              </>
            )}
          </div>
          {isVLMOcrActivityBusy(vlmOcrActivity) ||
          vlmOcrActivity.phase === "error" ? (
            <VLMOcrProgressText
              activity={vlmOcrActivity}
              startedAt={vlmOcrActivity.startedAt}
            />
          ) : lastVLMOcrRun ? (
            <LastRunText
              counts={lastVLMOcrRun.counts}
              timestamp={lastVLMOcrRun.timestamp}
              scopeLabel={lastVLMOcrRun.scopeLabel}
              elapsedMs={lastVLMOcrRun.elapsedMs}
              providerName={lastVLMOcrRun.providerName}
              modelName={lastVLMOcrRun.modelName}
              errors={lastVLMOcrRun.errors}
            />
          ) : null}
        </div>
      </div>

      {/* ── Embed ──────────────────────────────────────────────── */}
      {draft.llmEmbedModel && (
        <>
          <div className="flex items-center gap-2.5 border-t border-g-line px-6 pt-3 pb-1 md:px-8">
            <Waypoints size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.embedRunGroup")}
            </span>
          </div>
          <div className="flex items-start justify-between gap-6 px-6 pt-1 pb-3 md:px-8">
            <p className="font-g text-g-ui tracking-g-ui text-g-ink-3 pt-1.5 max-w-[28ch]">
              {t("settings.embedDescription")}
            </p>
            <div className="flex flex-col gap-1.5 shrink-0 w-[520px]">
              {!isEmbedActivityBusy(embedActivity) && (
                <AIScopePicker
                  workspaces={workspaces}
                  projects={projects}
                  selectedWorkspaceId={embedWorkspaceId}
                  selectedProjectId={embedProjectId}
                  disabled={aiBusy}
                  onChangeWorkspace={setEmbedWorkspaceId}
                  onChangeProject={setEmbedProjectId}
                />
              )}
              <div className="flex items-center justify-end gap-1.5">
                {isEmbedActivityBusy(embedActivity) ? (
                  <Button
                    variant="secondary"
                    leadingIcon={
                      embedActivity.phase === "stopping" ? (
                        <LoaderCircle
                          size={14}
                          className="animate-[icon-spin_900ms_linear_infinite]"
                        />
                      ) : (
                        <Square size={14} />
                      )
                    }
                    onClick={onStopEmbed}
                    disabled={embedActivity.phase === "stopping"}
                  >
                    {embedActivity.phase === "stopping"
                      ? t("settings.embedStopping")
                      : t("settings.embedStop")}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      leadingIcon={
                        repairCheckQuery.isFetching ? (
                          <LoaderCircle
                            size={14}
                            className="animate-[icon-spin_900ms_linear_infinite]"
                          />
                        ) : (
                          <ShieldCheck size={14} />
                        )
                      }
                      disabled={aiBusy || repairCheckBusy}
                      onClick={onCheckEmbeddingRepair}
                    >
                      {repairCheckQuery.isFetching
                        ? t("settings.embedRepairChecking")
                        : t("settings.embedRepairCheck")}
                    </Button>
                    {hasRepairableIssues && (
                      <Button
                        variant="secondary"
                        leadingIcon={
                          repairEmbeddingsMutation.isPending ? (
                            <LoaderCircle
                              size={14}
                              className="animate-[icon-spin_900ms_linear_infinite]"
                            />
                          ) : (
                            <ShieldCheck size={14} />
                          )
                        }
                        disabled={aiBusy || repairCheckBusy}
                        onClick={() => onRepairEmbeddings(true)}
                      >
                        {t("settings.embedRepairApply")}
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      leadingIcon={<Play size={14} />}
                      disabled={aiBusy || !draft.llmEmbedModel}
                      onClick={() => {
                        onStartEmbed(
                          resolveProjectIds(embedWorkspaceId, embedProjectId),
                          resolveScopeLabel(embedWorkspaceId, embedProjectId),
                          true,
                        );
                      }}
                    >
                      {t("settings.embedRun")}
                    </Button>
                  </>
                )}
              </div>
              {!isEmbedActivityBusy(embedActivity) && embedRepairStatusText() ? (
                <p className="font-g text-g-caption tracking-g-ui text-g-ink-3 text-right">
                  {embedRepairStatusText()}
                </p>
              ) : null}
              {isEmbedActivityBusy(embedActivity) ||
              embedActivity.phase === "error" ? (
                <EmbedProgressText
                  activity={embedActivity}
                  startedAt={embedActivity.startedAt}
                />
              ) : lastEmbedRun ? (
                <LastRunText
                  counts={lastEmbedRun.counts}
                  timestamp={lastEmbedRun.timestamp}
                  scopeLabel={lastEmbedRun.scopeLabel}
                  elapsedMs={lastEmbedRun.elapsedMs}
                  providerName={lastEmbedRun.providerName}
                  modelName={lastEmbedRun.modelName}
                  errors={lastEmbedRun.errors}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

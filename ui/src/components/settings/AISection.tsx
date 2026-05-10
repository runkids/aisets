import {
  AlertTriangle,
  LoaderCircle,
  Play,
  RefreshCw,
  ScanText,
  Square,
  Star,
  Tags,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePromptPresetsQuery } from "../../queries";
import type { AITagActivityState } from "../../aiTagActivity";
import { isAITagActivityBusy } from "../../aiTagActivity";
import type { VLMOcrActivityState } from "../../vlmOcrActivity";
import { isVLMOcrActivityBusy } from "../../vlmOcrActivity";
import type { AITagRunCounts, VLMOcrRunCounts, Workspace } from "../../types";
import { AiChipIcon } from "../ui/AiChipIcon";
import type { ScopeProject } from "./AIScopePicker";
import { AIScopePicker } from "./AIScopePicker";

const AI_TAG_LAST_RUN_KEY = "aisets:ai-tag:last-run";
const VLM_OCR_LAST_RUN_KEY = "aisets:vlm-ocr:last-run";

type LastRunRecord<T> = { counts: T; timestamp: number; scopeLabel?: string };

function readLastRun<T>(key: string): LastRunRecord<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LastRunRecord<T>) : null;
  } catch {
    return null;
  }
}

function saveLastRun<T>(key: string, counts: T, scopeLabel?: string): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ counts, timestamp: Date.now(), scopeLabel }),
    );
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

import { useLLMModelsQuery, useLLMHealthMutation } from "../../queries";
import type { SettingsInfo } from "../../types";
import {
  Button,
  Card,
  IconButton,
  Select,
  Switch,
  TextInput,
  Tooltip,
} from "../ui";
import { LLM_MAX_CONCURRENCY } from "./constants";
import { FieldRow } from "./index";
import type { SettingsDraft } from "./types";

type AISectionProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  working: boolean;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  workspaces: Workspace[];
  projects: ScopeProject[];
  activeWorkspaceId: string;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onStartAITag: (presetId?: string, projectIds?: string[]) => void;
  onStopAITag: () => void;
  onStartVLMOcr: (presetId?: string, projectIds?: string[]) => void;
  onStopVLMOcr: () => void;
};

function deriveHost(endpoint: string | undefined): string {
  try {
    return new URL(endpoint ?? "http://localhost").hostname;
  } catch {
    return "localhost";
  }
}

export function AISection({
  draft,
  settings,
  working,
  aiTagActivity,
  vlmOcrActivity,
  workspaces,
  projects,
  activeWorkspaceId,
  settingActions,
  onUpdateDraft,
  onStartAITag,
  onStopAITag,
  onStartVLMOcr,
  onStopVLMOcr,
}: AISectionProps) {
  const { t } = useTranslation();

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

  const [lastAITagRun, setLastAITagRun] =
    useState<LastRunRecord<AITagRunCounts> | null>(() =>
      readLastRun<AITagRunCounts>(AI_TAG_LAST_RUN_KEY),
    );
  const [lastVLMOcrRun, setLastVLMOcrRun] =
    useState<LastRunRecord<VLMOcrRunCounts> | null>(() =>
      readLastRun<VLMOcrRunCounts>(VLM_OCR_LAST_RUN_KEY),
    );

  const tagScopeLabelRef = useRef(
    resolveScopeLabel(tagWorkspaceId, tagProjectId),
  );
  const ocrScopeLabelRef = useRef(
    resolveScopeLabel(ocrWorkspaceId, ocrProjectId),
  );

  useEffect(() => {
    tagScopeLabelRef.current = resolveScopeLabel(tagWorkspaceId, tagProjectId);
  }, [tagWorkspaceId, tagProjectId, resolveScopeLabel]);

  useEffect(() => {
    ocrScopeLabelRef.current = resolveScopeLabel(ocrWorkspaceId, ocrProjectId);
  }, [ocrWorkspaceId, ocrProjectId, resolveScopeLabel]);

  const prevAITagPhase = useRef(aiTagActivity.phase);
  useEffect(() => {
    const prev = prevAITagPhase.current;
    prevAITagPhase.current = aiTagActivity.phase;
    if (
      (prev === "running" || prev === "stopping" || prev === "saving") &&
      (aiTagActivity.phase === "done" || aiTagActivity.phase === "stopped") &&
      aiTagActivity.counts
    ) {
      const sl = tagScopeLabelRef.current;
      const record: LastRunRecord<AITagRunCounts> = {
        counts: aiTagActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
      };
      saveLastRun(AI_TAG_LAST_RUN_KEY, aiTagActivity.counts, sl);
      setLastAITagRun(record);
    }
  }, [aiTagActivity.phase, aiTagActivity.counts]);

  const prevVLMOcrPhase = useRef(vlmOcrActivity.phase);
  useEffect(() => {
    const prev = prevVLMOcrPhase.current;
    prevVLMOcrPhase.current = vlmOcrActivity.phase;
    if (
      (prev === "running" || prev === "stopping" || prev === "saving") &&
      (vlmOcrActivity.phase === "done" || vlmOcrActivity.phase === "stopped") &&
      vlmOcrActivity.counts
    ) {
      const sl = ocrScopeLabelRef.current;
      const record: LastRunRecord<VLMOcrRunCounts> = {
        counts: vlmOcrActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
      };
      saveLastRun(VLM_OCR_LAST_RUN_KEY, vlmOcrActivity.counts, sl);
      setLastVLMOcrRun(record);
    }
  }, [vlmOcrActivity.phase, vlmOcrActivity.counts]);

  const aiBusy =
    isAITagActivityBusy(aiTagActivity) || isVLMOcrActivityBusy(vlmOcrActivity);

  const host = deriveHost(settings?.llmEndpoint);
  const defaultEndpoints: Record<string, string> = {
    ollama: `http://${host}:11434`,
    "openai-compat": `http://${host}:1234/v1`,
  };

  const providerEnabled = draft.llmEnabled && draft.llmProvider !== "";
  const modelsQuery = useLLMModelsQuery(
    providerEnabled && draft.llmEndpoint !== "",
    providerEnabled
      ? { provider: draft.llmProvider, endpoint: draft.llmEndpoint }
      : undefined,
  );
  const healthMutation = useLLMHealthMutation();

  const models = modelsQuery.data?.models ?? [];
  const modelOptions = [
    { value: "", label: t("settings.llmSelectModel") },
    ...models.map((m) => ({ value: m.name, label: m.name })),
  ];

  const providerOptions = [
    { value: "ollama", label: t("settings.llmProviderOllama") },
    {
      value: "openai-compat",
      label: t("settings.llmProviderOpenAICompat"),
    },
  ];

  const runtime = healthMutation.data ?? settings?.llmRuntime;
  const isConnected = runtime?.connected ?? false;
  const statusText = healthMutation.isPending
    ? t("settings.llmTesting")
    : isConnected
      ? t("settings.llmConnected", { count: runtime?.models.length ?? 0 })
      : runtime?.error
        ? runtime.error
        : t("settings.llmDisconnected");

  function handleProviderChange(value: string) {
    onUpdateDraft((current) => ({
      ...current,
      llmProvider: value,
      llmEndpoint: defaultEndpoints[value] ?? current.llmEndpoint,
      llmVisionModel: "",
      llmEmbedModel: "",
    }));
  }

  function handleTestConnection() {
    void healthMutation.mutate({
      provider: draft.llmProvider,
      endpoint: draft.llmEndpoint,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <AiChipIcon size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.ai")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow
            label={t("settings.llmEnabled")}
            description={t("settings.llmEnabledHint")}
          >
            <Switch
              checked={draft.llmEnabled}
              disabled={aiBusy}
              onCheckedChange={(next) =>
                onUpdateDraft((current) => ({
                  ...current,
                  llmEnabled: next,
                  llmProvider:
                    next && !current.llmProvider
                      ? "ollama"
                      : current.llmProvider,
                  llmEndpoint:
                    next && !current.llmEndpoint
                      ? defaultEndpoints["ollama"]
                      : current.llmEndpoint,
                }))
              }
              aria-label={t("settings.llmEnabled")}
            />
          </FieldRow>

          {draft.llmEnabled && (
            <>
              <FieldRow label={t("settings.llmProvider")}>
                <Select
                  value={draft.llmProvider || "ollama"}
                  options={providerOptions}
                  onChange={handleProviderChange}
                  disabled={aiBusy}
                  aria-label={t("settings.llmProvider")}
                  className="min-w-[400px]"
                />
              </FieldRow>

              <FieldRow label={t("settings.llmEndpoint")}>
                <TextInput
                  value={draft.llmEndpoint}
                  disabled={aiBusy}
                  onChange={(e) =>
                    onUpdateDraft((current) => ({
                      ...current,
                      llmEndpoint: e.target.value,
                    }))
                  }
                  aria-label={t("settings.llmEndpoint")}
                  className="w-full min-w-[400px]"
                />
              </FieldRow>

              <FieldRow
                label={t("settings.llmVisionModel")}
                description={t("settings.llmVisionModelHint")}
              >
                <div className="flex items-center gap-1.5 min-w-[400px]">
                  <Select
                    value={draft.llmVisionModel}
                    options={modelOptions}
                    disabled={aiBusy}
                    onChange={(value) =>
                      onUpdateDraft((current) => ({
                        ...current,
                        llmVisionModel: value,
                      }))
                    }
                    aria-label={t("settings.llmVisionModel")}
                    className="flex-1"
                  />
                  <IconButton
                    aria-label={t("settings.llmRefreshModels")}
                    onClick={() => void modelsQuery.refetch()}
                    disabled={modelsQuery.isFetching}
                    data-loading={modelsQuery.isFetching || undefined}
                  >
                    <RefreshCw size={14} />
                  </IconButton>
                </div>
              </FieldRow>

              <FieldRow
                label={t("settings.llmEmbedModel")}
                description={t("settings.llmEmbedModelHint")}
              >
                <div className="flex items-center gap-1.5 min-w-[400px]">
                  <Select
                    value={draft.llmEmbedModel}
                    options={modelOptions}
                    disabled={aiBusy}
                    onChange={(value) =>
                      onUpdateDraft((current) => ({
                        ...current,
                        llmEmbedModel: value,
                      }))
                    }
                    aria-label={t("settings.llmEmbedModel")}
                    className="flex-1"
                  />
                  <IconButton
                    aria-label={t("settings.llmRefreshModels")}
                    onClick={() => void modelsQuery.refetch()}
                    disabled={modelsQuery.isFetching}
                    data-loading={modelsQuery.isFetching || undefined}
                  >
                    <RefreshCw size={14} />
                  </IconButton>
                </div>
              </FieldRow>

              <FieldRow label={t("settings.llmStatus")}>
                <div className="flex items-center gap-3 min-w-[400px]">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span
                      className={`size-2 shrink-0 rounded-full ${isConnected ? "bg-g-green" : "bg-g-red"}`}
                      aria-hidden="true"
                    />
                    <span className="font-g text-g-ui tracking-g-ui text-g-ink-2 truncate">
                      {statusText}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={working || healthMutation.isPending}
                  >
                    {t("settings.llmTestConnection")}
                  </Button>
                </div>
              </FieldRow>
              <div>
                <FieldRow
                  label={t("settings.llmConcurrency")}
                  description={t("settings.llmConcurrencyHint")}
                >
                  <TextInput
                    type="number"
                    min={1}
                    max={LLM_MAX_CONCURRENCY}
                    value={String(draft.llmConcurrency)}
                    disabled={aiBusy}
                    onChange={(e) =>
                      onUpdateDraft((current) => ({
                        ...current,
                        llmConcurrency: Math.max(
                          1,
                          Math.min(
                            LLM_MAX_CONCURRENCY,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      }))
                    }
                    aria-label={t("settings.llmConcurrency")}
                    className="min-w-[400px]"
                  />
                </FieldRow>
                {draft.llmConcurrency > 1 && (
                  <div className="flex items-start gap-1.5 pb-4 text-g-amber">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span className="font-g text-[11px] leading-snug">
                      {t("settings.llmConcurrencyWarning")}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
          {settingActions}
        </div>
      </Card>

      {providerEnabled && (
        <Card
          className="border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <Tags size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.aiTagGroup")}
            </span>
          </div>
          <div className="flex items-start justify-between gap-6 px-6 py-4 md:px-8">
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
                                className="fill-current text-g-amber"
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
                <AITagProgressText activity={aiTagActivity} />
              ) : lastAITagRun ? (
                <LastRunText
                  counts={lastAITagRun.counts}
                  timestamp={lastAITagRun.timestamp}
                  scopeLabel={lastAITagRun.scopeLabel}
                />
              ) : null}
            </div>
          </div>
        </Card>
      )}

      {providerEnabled && (
        <Card
          className="border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <ScanText size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.aiOcrGroup")}
            </span>
          </div>
          <div className="flex items-start justify-between gap-6 px-6 py-4 md:px-8">
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
                                className="fill-current text-g-amber"
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
                <VLMOcrProgressText activity={vlmOcrActivity} />
              ) : lastVLMOcrRun ? (
                <LastRunText
                  counts={lastVLMOcrRun.counts}
                  timestamp={lastVLMOcrRun.timestamp}
                  scopeLabel={lastVLMOcrRun.scopeLabel}
                />
              ) : null}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function aiTagProgressLabel(
  activity: AITagActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const counts = activity.counts;
  switch (activity.phase) {
    case "saving":
      return t("settings.aiTagSaving");
    case "running":
    case "stopping":
      return counts
        ? t("activity.aiTagCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
            cacheHit: counts.cacheHit,
          })
        : t("settings.aiTagSaving");
    case "done":
      return t("settings.aiTagDone", {
        ready: counts?.ready ?? 0,
        skipped: counts?.skipped ?? 0,
        cacheHit: counts?.cacheHit ?? 0,
      });
    case "stopped":
      return t("settings.aiTagStopped");
    case "error":
      return activity.errorMessage ?? t("settings.aiTagFailed");
    default:
      return "";
  }
}

function TokenBadge({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number;
  outputTokens: number;
}) {
  const { t } = useTranslation();
  if (inputTokens <= 0 && outputTokens <= 0) return null;
  return (
    <Tooltip
      label={t("settings.aiTokenTooltip", {
        input: inputTokens.toLocaleString(),
        output: outputTokens.toLocaleString(),
      })}
    >
      <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4 cursor-default">
        ↑{formatTokenCount(inputTokens)} ↓{formatTokenCount(outputTokens)}
      </span>
    </Tooltip>
  );
}

function LastRunText({
  counts,
  timestamp,
  scopeLabel,
}: {
  counts: AITagRunCounts | VLMOcrRunCounts;
  timestamp: number;
  scopeLabel?: string;
}) {
  const { t } = useTranslation();
  const date = new Date(timestamp);
  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr =
    date.toDateString() === new Date().toDateString()
      ? timeStr
      : date.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        timeStr;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-4 flex items-center gap-1.5">
        <span>{t("settings.aiLastRun", { time: dateStr })}</span>
        {"ready" in counts && (
          <span>
            {t("settings.aiLastRunCounts", {
              ready: counts.ready,
              skipped: counts.skipped,
              cacheHit: counts.cacheHit,
            })}
          </span>
        )}
      </p>
      {scopeLabel && (
        <span className="font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {scopeLabel}
        </span>
      )}
      {"inputTokens" in counts &&
        (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
          <TokenBadge
            inputTokens={counts.inputTokens ?? 0}
            outputTokens={counts.outputTokens ?? 0}
          />
        )}
    </div>
  );
}

function AITagProgressText({ activity }: { activity: AITagActivityState }) {
  const { t } = useTranslation();
  const busy = isAITagActivityBusy(activity);
  const label = aiTagProgressLabel(activity, t);
  const counts = activity.counts;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
      </p>
      {busy && activity.currentFile && (
        <p className="max-w-[400px] truncate font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {activity.currentFile}
        </p>
      )}
      {counts && (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
        <TokenBadge
          inputTokens={counts.inputTokens ?? 0}
          outputTokens={counts.outputTokens ?? 0}
        />
      )}
    </div>
  );
}

function vlmOcrProgressLabel(
  activity: VLMOcrActivityState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const counts = activity.counts;
  switch (activity.phase) {
    case "saving":
      return t("settings.aiOcrSaving");
    case "running":
    case "stopping":
      return counts
        ? t("activity.aiOcrCounts", {
            processed: counts.processed,
            ready: counts.ready,
            failed: counts.failed,
            skipped: counts.skipped,
            cacheHit: counts.cacheHit,
          })
        : t("settings.aiOcrSaving");
    case "done":
      return t("settings.aiOcrDone", {
        ready: counts?.ready ?? 0,
        skipped: counts?.skipped ?? 0,
        cacheHit: counts?.cacheHit ?? 0,
      });
    case "stopped":
      return t("settings.aiOcrStopped");
    case "error":
      return activity.errorMessage ?? t("settings.aiOcrFailed");
    default:
      return "";
  }
}

function VLMOcrProgressText({ activity }: { activity: VLMOcrActivityState }) {
  const { t } = useTranslation();
  const busy = isVLMOcrActivityBusy(activity);
  const label = vlmOcrProgressLabel(activity, t);
  const counts = activity.counts;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
      </p>
      {busy && activity.currentFile && (
        <p className="max-w-[400px] truncate font-g-mono text-[10px] tracking-g-mono text-g-ink-4">
          {activity.currentFile}
        </p>
      )}
      {counts && (counts.inputTokens ?? 0) + (counts.outputTokens ?? 0) > 0 && (
        <TokenBadge
          inputTokens={counts.inputTokens ?? 0}
          outputTokens={counts.outputTokens ?? 0}
        />
      )}
    </div>
  );
}

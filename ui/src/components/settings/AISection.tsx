import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  LoaderCircle,
  MessageSquareText,
  Play,
  RefreshCw,
  ScanText,
  Settings2,
  Square,
  Star,
  Tags,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePromptPresetsQuery,
  useCreatePromptPresetMutation,
  useUpdatePromptPresetMutation,
  useUpdateSettingsMutation,
} from "../../queries";
import { useToast } from "../ToastProvider";
import { errorMessage } from "../../i18n";
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

type LastRunRecord<T> = {
  counts: T;
  timestamp: number;
  scopeLabel?: string;
  elapsedMs?: number;
};

function readLastRun<T>(key: string): LastRunRecord<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LastRunRecord<T>) : null;
  } catch {
    return null;
  }
}

function saveLastRun<T>(
  key: string,
  counts: T,
  scopeLabel?: string,
  elapsedMs?: number,
): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ counts, timestamp: Date.now(), scopeLabel, elapsedMs }),
    );
  } catch {
    // ignore storage errors (quota, private mode)
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

import { useLLMModelsQuery, useLLMHealthMutation } from "../../queries";
import type { SettingsInfo } from "../../types";
import { cn } from "../../lib/cn";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Select,
  Switch,
  Textarea,
  TextInput,
  Tooltip,
} from "../ui";
import {
  LLM_MAX_CONCURRENCY,
  LLM_MIN_TIMEOUT,
  LLM_MAX_TIMEOUT,
} from "./constants";
import type { Mode } from "../../ui";
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
  onNavigate?: (mode: Mode) => void;
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
  onNavigate,
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

  const [connectionExpanded, setConnectionExpanded] = useState(false);
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
      const record: LastRunRecord<AITagRunCounts> = {
        counts: aiTagActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
        elapsedMs,
      };
      saveLastRun(AI_TAG_LAST_RUN_KEY, aiTagActivity.counts, sl, elapsedMs);
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
      const record: LastRunRecord<VLMOcrRunCounts> = {
        counts: vlmOcrActivity.counts,
        timestamp: Date.now(),
        scopeLabel: sl,
        elapsedMs,
      };
      saveLastRun(VLM_OCR_LAST_RUN_KEY, vlmOcrActivity.counts, sl, elapsedMs);
      setLastVLMOcrRun(record);
    }
  }, [
    vlmOcrActivity.phase,
    vlmOcrActivity.counts,
    vlmOcrActivity.startedAt,
    vlmOcrActivity.scopeLabel,
  ]);

  const aiBusy =
    isAITagActivityBusy(aiTagActivity) || isVLMOcrActivityBusy(vlmOcrActivity);

  const host = deriveHost(settings?.llmEndpoint);
  const defaultEndpoints: Record<string, string> = {
    ollama: `http://${host}:11434`,
    "openai-compat": `http://${host}:1234/v1`,
    omlx: `http://${host}:8000/v1`,
  };

  const providerEnabled = draft.llmEnabled && draft.llmProvider !== "";
  const modelsQuery = useLLMModelsQuery(
    providerEnabled && draft.llmEndpoint !== "",
    providerEnabled
      ? {
          provider: draft.llmProvider,
          endpoint: draft.llmEndpoint,
          apiKey: draft.llmApiKey || undefined,
        }
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
    {
      value: "omlx",
      label: t("settings.llmProviderOMLX"),
    },
  ];
  const providerLabel =
    providerOptions.find((o) => o.value === draft.llmProvider)?.label ?? "";

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
      apiKey: draft.llmApiKey || undefined,
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
              <div className="py-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 text-left"
                  onClick={() => setConnectionExpanded((prev) => !prev)}
                  aria-expanded={connectionExpanded}
                >
                  <Settings2 size={15} className="shrink-0 text-g-ink-3" />
                  <span className="min-w-0 flex-1 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
                    {t("settings.llmConnectionHeading")}
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 text-g-ink-4 transition-transform duration-200 ease-g",
                      connectionExpanded && "rotate-180",
                    )}
                  />
                </button>
                {!connectionExpanded && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {providerLabel && (
                      <Badge tone="default">{providerLabel}</Badge>
                    )}
                    {draft.llmVisionModel && (
                      <Badge tone="default">{draft.llmVisionModel}</Badge>
                    )}
                    <Badge tone={isConnected ? "green" : "default"}>
                      {isConnected
                        ? t("settings.llmStatusConnected")
                        : t("settings.llmStatusNotTested")}
                    </Badge>
                  </div>
                )}
              </div>

              {connectionExpanded && (
                <>
                  <FieldRow
                    label={t("settings.llmProvider")}
                    description={
                      draft.llmProvider === "omlx"
                        ? t("settings.llmOmlxGrammarHint")
                        : undefined
                    }
                  >
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
                    label={t("settings.llmApiKey")}
                    description={t("settings.llmApiKeyHint")}
                  >
                    <TextInput
                      type="password"
                      value={draft.llmApiKey}
                      disabled={aiBusy}
                      onChange={(e) =>
                        onUpdateDraft((current) => ({
                          ...current,
                          llmApiKey: e.target.value,
                        }))
                      }
                      placeholder={t("settings.llmApiKeyPlaceholder")}
                      aria-label={t("settings.llmApiKey")}
                      className="w-full min-w-[400px]"
                    />
                  </FieldRow>

                  <FieldRow
                    label={t("settings.llmVisionModel")}
                    description={t(
                      `settings.llmVisionModelHint_${draft.llmProvider.replace("-", "_")}`,
                      { defaultValue: t("settings.llmVisionModelHint") },
                    )}
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
                    description={t(
                      `settings.llmEmbedModelHint_${draft.llmProvider.replace("-", "_")}`,
                      { defaultValue: t("settings.llmEmbedModelHint") },
                    )}
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

                  <FieldRow
                    label={t("settings.llmTimeout")}
                    description={t("settings.llmTimeoutHint")}
                  >
                    <TextInput
                      type="number"
                      min={LLM_MIN_TIMEOUT}
                      max={LLM_MAX_TIMEOUT}
                      value={String(draft.llmTimeout)}
                      disabled={aiBusy}
                      onChange={(e) =>
                        onUpdateDraft((current) => ({
                          ...current,
                          llmTimeout: Math.max(
                            LLM_MIN_TIMEOUT,
                            Math.min(
                              LLM_MAX_TIMEOUT,
                              Number(e.target.value) || LLM_MIN_TIMEOUT,
                            ),
                          ),
                        }))
                      }
                      aria-label={t("settings.llmTimeout")}
                      className="min-w-[400px]"
                    />
                  </FieldRow>
                </>
              )}
            </>
          )}
          {settingActions}
        </div>
      </Card>

      {providerEnabled && (
        <PromptsLocaleCard
          draft={draft}
          systemPromptEnabled={settings?.llmSystemPromptEnabled ?? false}
          onUpdateDraft={onUpdateDraft}
          onNavigate={onNavigate}
        />
      )}

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
  elapsedMs,
}: {
  counts: AITagRunCounts | VLMOcrRunCounts;
  timestamp: number;
  scopeLabel?: string;
  elapsedMs?: number;
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

  const sep = (
    <span className="text-g-ink-5 select-none" aria-hidden>
      ·
    </span>
  );

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-4 flex items-center gap-1.5">
        <span>{t("settings.aiLastRun", { time: dateStr })}</span>
        {"ready" in counts && (
          <>
            {sep}
            <span>
              {t("settings.aiLastRunCounts", {
                ready: counts.ready,
                skipped: counts.skipped,
                cacheHit: counts.cacheHit,
              })}
            </span>
          </>
        )}
        {counts.failed > 0 && (
          <>
            {sep}
            <span className="text-g-red">
              {t("settings.aiLastRunFailed", { failed: counts.failed })}
            </span>
          </>
        )}
        {elapsedMs != null && (
          <>
            {sep}
            <span>{formatElapsed(elapsedMs)}</span>
          </>
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

function ActivityErrorPanel({
  errors,
}: {
  errors: { repoPath: string; message: string }[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (errors.length === 0) return null;
  return (
    <div className="mt-1 w-full rounded-g-md border border-g-line bg-g-surface text-g-caption leading-[1.45]">
      <div className="flex items-center">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 px-2 py-1.5 text-left text-g-red hover:bg-g-surface-2"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform duration-100 ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="flex-1 truncate">
            {t("activity.failedCount", {
              count: errors.length,
              defaultValue: "{{count}} failed",
            })}
          </span>
        </button>
        <button
          type="button"
          aria-label={
            copied
              ? t("activity.errorsCopied", { defaultValue: "Copied" })
              : t("activity.copyErrors", { defaultValue: "Copy errors" })
          }
          className="shrink-0 px-2 py-1.5 text-g-ink-4 hover:text-g-ink transition-colors duration-100"
          onClick={() => {
            const text = errors
              .map((e) => `${e.repoPath}\n${e.message}`)
              .join("\n\n");
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? (
            <Check size={12} className="text-g-green" />
          ) : (
            <Copy size={12} />
          )}
        </button>
      </div>
      {expanded && (
        <ul className="max-h-[160px] overflow-y-auto border-t border-g-line">
          {errors.map((err, i) => (
            <li
              key={i}
              className="border-b border-g-line px-2 py-1 last:border-b-0"
            >
              <span className="block truncate font-g-mono text-g-chip text-g-ink-2">
                {err.repoPath}
              </span>
              <span className="block truncate text-g-red">{err.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AITagProgressText({
  activity,
  startedAt,
}: {
  activity: AITagActivityState;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const busy = isAITagActivityBusy(activity);
  const label = aiTagProgressLabel(activity, t);
  const counts = activity.counts;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  const elapsedMs = busy && startedAt ? now - startedAt : undefined;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
        {elapsedMs != null && (
          <>
            <span className="text-g-ink-5 select-none" aria-hidden>
              ·
            </span>
            <span className="text-g-ink-4">{formatElapsed(elapsedMs)}</span>
          </>
        )}
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
      {activity.errors.length > 0 && (
        <ActivityErrorPanel errors={activity.errors} />
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

function VLMOcrProgressText({
  activity,
  startedAt,
}: {
  activity: VLMOcrActivityState;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const busy = isVLMOcrActivityBusy(activity);
  const label = vlmOcrProgressLabel(activity, t);
  const counts = activity.counts;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  const elapsedMs = busy && startedAt ? now - startedAt : undefined;

  return (
    <div className="flex flex-col gap-0.5 items-end">
      <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
        {busy && <LoaderCircle size={12} className="animate-spin shrink-0" />}
        {label}
        {elapsedMs != null && (
          <>
            <span className="text-g-ink-5 select-none" aria-hidden>
              ·
            </span>
            <span className="text-g-ink-4">{formatElapsed(elapsedMs)}</span>
          </>
        )}
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
      {activity.errors.length > 0 && (
        <ActivityErrorPanel errors={activity.errors} />
      )}
    </div>
  );
}

function SystemPromptInline() {
  const { t } = useTranslation();
  const toast = useToast();
  const presetsQuery = usePromptPresetsQuery("system");
  const createMutation = useCreatePromptPresetMutation();
  const updateMutation = useUpdatePromptPresetMutation();

  const preset = presetsQuery.data?.presets?.[0];
  const serverValue = preset?.content?.template ?? "";
  const [localValue, setLocalValue] = useState<string | null>(null);

  const value = localValue ?? serverValue;
  const isDirty = localValue != null && localValue !== serverValue;

  function handleSave() {
    if (preset) {
      updateMutation.mutate(
        {
          id: preset.id,
          name: preset.name,
          content: {
            template: value,
            variables: preset.content.variables ?? {},
          },
        },
        {
          onSuccess: () => {
            setLocalValue(null);
            toast.success(t("prompts.toastSaved"));
          },
          onError: (err) => toast.error(errorMessage(err)),
        },
      );
    } else {
      createMutation.mutate(
        {
          name: "System",
          type: "system",
          content: { template: value, variables: {} },
          isDefault: true,
        },
        {
          onSuccess: () => {
            setLocalValue(null);
            toast.success(t("prompts.toastCreated"));
          },
          onError: (err) => toast.error(errorMessage(err)),
        },
      );
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setLocalValue(e.target.value)}
        rows={4}
        placeholder={t("settings.systemPromptPlaceholder")}
        className="font-g-mono text-g-caption"
      />
      {isDirty && (
        <div className="flex justify-end gap-2">
          <Button size="md" variant="ghost" onClick={() => setLocalValue(null)}>
            {t("action.reset")}
          </Button>
          <Button
            size="md"
            variant="primary"
            onClick={handleSave}
            disabled={updateMutation.isPending || createMutation.isPending}
          >
            {t("action.saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}

function PromptsLocaleCard({
  draft,
  systemPromptEnabled,
  onUpdateDraft,
  onNavigate,
}: {
  draft: SettingsDraft;
  systemPromptEnabled: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onNavigate?: (mode: Mode) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const updateSettings = useUpdateSettingsMutation();

  function handleSystemPromptToggle(checked: boolean) {
    updateSettings.mutate(
      { llmSystemPromptEnabled: checked },
      { onError: (err) => toast.error(errorMessage(err)) },
    );
  }

  return (
    <Card
      className="border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
      padding="none"
    >
      <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
        <MessageSquareText size={15} className="shrink-0 text-g-ink-3" />
        <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
          {t("settings.promptsHeading")}
        </span>
      </div>
      <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
        <FieldRow
          label={t("settings.systemPrompt")}
          description={t("settings.systemPromptHint")}
        >
          <Switch
            checked={systemPromptEnabled}
            onCheckedChange={handleSystemPromptToggle}
            aria-label={t("settings.systemPrompt")}
          />
        </FieldRow>
        {systemPromptEnabled && (
          <div className="py-3">
            <SystemPromptInline />
          </div>
        )}
        <FieldRow
          label={t("settings.llmAutoLocale")}
          description={t("settings.llmAutoLocaleHint")}
        >
          <Switch
            checked={draft.llmAutoLocale}
            onCheckedChange={(next) =>
              onUpdateDraft((current) => ({
                ...current,
                llmAutoLocale: next,
              }))
            }
            aria-label={t("settings.llmAutoLocale")}
          />
        </FieldRow>
        <div className="py-3">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-g-sm px-1.5 py-2 text-left text-g-ui font-[510] text-g-ink-2 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
            onClick={() => onNavigate?.("prompts")}
          >
            <span className="flex-1">{t("settings.managePrompts")}</span>
            <ChevronRight size={14} className="shrink-0 text-g-ink-4" />
          </button>
        </div>
      </div>
    </Card>
  );
}

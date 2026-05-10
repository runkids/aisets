import {
  ChevronRight,
  Info,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  ScanText,
  Square,
  Tags,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { AITagActivityState } from "../../aiTagActivity";
import { isAITagActivityBusy } from "../../aiTagActivity";
import type { VLMOcrActivityState } from "../../vlmOcrActivity";
import { isVLMOcrActivityBusy } from "../../vlmOcrActivity";
import type { AITagRunCounts, VLMOcrRunCounts } from "../../types";
import { AiChipIcon } from "../ui/AiChipIcon";

const AI_TAG_LAST_RUN_KEY = "aisets:ai-tag:last-run";
const VLM_OCR_LAST_RUN_KEY = "aisets:vlm-ocr:last-run";

type LastRunRecord<T> = { counts: T; timestamp: number };

function readLastRun<T>(key: string): LastRunRecord<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LastRunRecord<T>) : null;
  } catch {
    return null;
  }
}

function saveLastRun<T>(key: string, counts: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ counts, timestamp: Date.now() }),
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

const DEFAULT_TAG_PROMPT = `Analyze this image and respond with a JSON object containing:
- "category": one of "icon", "photo", "screenshot", "diagram", "illustration", "pattern", "logo", "banner", "texture", "sprite", "mockup", "artwork"
- "tags": array of 3-8 descriptive tags in lowercase kebab-case (e.g. "dark-mode", "mobile", "login-form", "hero-section")
- "description": one sentence describing the image content
- "languages": array of ISO 639-3 language codes for any visible text (e.g. ["eng"]). Empty array if no text.

Respond ONLY with valid JSON, no markdown or explanation.`;

const DEFAULT_OCR_PROMPT = `Analyze this image and respond with a JSON object:
- "text": all visible text exactly as it appears, preserving original layout, line breaks, indentation and formatting. If the image contains code, preserve indentation exactly. Empty string if no text is visible.
- "languages": array of ISO 639-3 language codes detected in the text (e.g. ["eng"], ["zho", "eng"]). Empty array if no text.

Respond ONLY with valid JSON, no markdown or explanation.`;
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
import { FieldRow } from "./index";
import type { SettingsDraft } from "./types";

type AISectionProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  working: boolean;
  aiTagActivity: AITagActivityState;
  vlmOcrActivity: VLMOcrActivityState;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onStartAITag: () => void;
  onStopAITag: () => void;
  onStartVLMOcr: () => void;
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
  settingActions,
  onUpdateDraft,
  onStartAITag,
  onStopAITag,
  onStartVLMOcr,
  onStopVLMOcr,
}: AISectionProps) {
  const { t } = useTranslation();

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
      (aiTagActivity.phase === "done" || aiTagActivity.phase === "stopped") &&
      aiTagActivity.counts
    ) {
      const record: LastRunRecord<AITagRunCounts> = {
        counts: aiTagActivity.counts,
        timestamp: Date.now(),
      };
      saveLastRun(AI_TAG_LAST_RUN_KEY, aiTagActivity.counts);
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
      const record: LastRunRecord<VLMOcrRunCounts> = {
        counts: vlmOcrActivity.counts,
        timestamp: Date.now(),
      };
      saveLastRun(VLM_OCR_LAST_RUN_KEY, vlmOcrActivity.counts);
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
            </>
          )}
          {settingActions}
        </div>
      </Card>

      {providerEnabled && (
        <Card
          className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <Tags size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.aiTagGroup")}
            </span>
          </div>
          <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
            <FieldRow
              label={t("settings.aiTagGroup")}
              description={t("settings.aiTagDescription")}
              icon={<Tags size={15} />}
              align="start"
            >
              <div className="flex w-full flex-col items-start gap-2 min-[1200px]:w-[560px] min-[1200px]:items-end">
                <div className="flex flex-wrap justify-start gap-2 min-[1200px]:justify-end">
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
                    <Button
                      variant="primary"
                      leadingIcon={<Play size={14} />}
                      disabled={working || draft.llmVisionModel === ""}
                      onClick={onStartAITag}
                    >
                      {t("settings.aiTagRun")}
                    </Button>
                  )}
                </div>
                {isAITagActivityBusy(aiTagActivity) ||
                aiTagActivity.phase === "error" ? (
                  <AITagProgressText activity={aiTagActivity} />
                ) : lastAITagRun ? (
                  <LastRunText
                    counts={lastAITagRun.counts}
                    timestamp={lastAITagRun.timestamp}
                  />
                ) : null}
              </div>
            </FieldRow>
            <PromptEditor
              draftKey="llmTagPrompt"
              defaultPrompt={DEFAULT_TAG_PROMPT}
              labelKey="settings.aiTagCustomPrompt"
              guideKey="settings.aiTagPromptGuide"
              resetKey="settings.aiTagResetPrompt"
              customizedKey="settings.aiTagPromptCustomized"
              draft={draft}
              onUpdateDraft={onUpdateDraft}
            />
          </div>
        </Card>
      )}

      {providerEnabled && (
        <Card
          className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <ScanText size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.aiOcrGroup")}
            </span>
          </div>
          <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
            <FieldRow
              label={t("settings.aiOcrGroup")}
              description={t("settings.aiOcrDescription")}
              icon={<ScanText size={15} />}
              align="start"
            >
              <div className="flex w-full flex-col items-start gap-2 min-[1200px]:w-[560px] min-[1200px]:items-end">
                <div className="flex flex-wrap justify-start gap-2 min-[1200px]:justify-end">
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
                    <Button
                      variant="primary"
                      leadingIcon={<Play size={14} />}
                      disabled={working || draft.llmVisionModel === ""}
                      onClick={onStartVLMOcr}
                    >
                      {t("settings.aiOcrRun")}
                    </Button>
                  )}
                </div>
                {isVLMOcrActivityBusy(vlmOcrActivity) ||
                vlmOcrActivity.phase === "error" ? (
                  <VLMOcrProgressText activity={vlmOcrActivity} />
                ) : lastVLMOcrRun ? (
                  <LastRunText
                    counts={lastVLMOcrRun.counts}
                    timestamp={lastVLMOcrRun.timestamp}
                  />
                ) : null}
              </div>
            </FieldRow>
            <PromptEditor
              draftKey="llmOcrPrompt"
              defaultPrompt={DEFAULT_OCR_PROMPT}
              labelKey="settings.aiOcrCustomPrompt"
              guideKey="settings.aiOcrPromptGuide"
              resetKey="settings.aiOcrResetPrompt"
              customizedKey="settings.aiOcrPromptCustomized"
              draft={draft}
              onUpdateDraft={onUpdateDraft}
            />
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
}: {
  counts: AITagRunCounts | VLMOcrRunCounts;
  timestamp: number;
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

function PromptEditor({
  draftKey,
  defaultPrompt,
  labelKey,
  guideKey,
  resetKey,
  customizedKey,
  draft,
  onUpdateDraft,
}: {
  draftKey: "llmTagPrompt" | "llmOcrPrompt";
  defaultPrompt: string;
  labelKey: string;
  guideKey: string;
  resetKey: string;
  customizedKey: string;
  draft: SettingsDraft;
  onUpdateDraft: AISectionProps["onUpdateDraft"];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isCustomized = draft[draftKey] !== "";

  return (
    <div className="py-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-g-sm px-1 py-2 text-left transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-g-ink-4 transition-transform duration-150 ease-g motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="font-g text-g-ui font-[510] tracking-g-ui text-g-ink-2">
          {t(labelKey)}
        </span>
        {isCustomized && (
          <span className="rounded-full bg-g-accent/15 px-1.5 py-px font-g text-[10px] font-[590] tracking-[0.04em] text-g-accent">
            {t(customizedKey)}
          </span>
        )}
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-g motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3 px-1 pb-3 pt-1">
            <div className="flex items-start gap-2 rounded-g-md border border-g-blue-soft bg-g-blue-soft/20 px-3 py-2.5">
              <Info size={14} className="mt-px shrink-0 text-g-blue" />
              <p className="font-g text-g-caption leading-[1.55] tracking-g-ui text-g-ink-3">
                {t(guideKey)}
              </p>
            </div>

            <textarea
              className="w-full min-h-[180px] resize-y rounded-g-md border border-g-ink-3/25 bg-g-surface-2 px-3.5 py-2.5 font-g-mono text-g-caption leading-[1.65] tracking-g-mono text-g-ink-1 placeholder:text-g-ink-4 focus:border-g-accent focus:outline-none focus:ring-1 focus:ring-g-accent"
              value={draft[draftKey] || defaultPrompt}
              onChange={(e) =>
                onUpdateDraft((current) => ({
                  ...current,
                  [draftKey]:
                    e.target.value === defaultPrompt ? "" : e.target.value,
                }))
              }
            />

            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<RotateCcw size={12} />}
                disabled={!isCustomized}
                onClick={() =>
                  onUpdateDraft((current) => ({
                    ...current,
                    [draftKey]: "",
                  }))
                }
              >
                {t(resetKey)}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

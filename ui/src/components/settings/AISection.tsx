import { LoaderCircle, Play, RefreshCw, ScanText, Square, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AITagActivityState } from "../../aiTagActivity";
import { isAITagActivityBusy } from "../../aiTagActivity";
import type { VLMOcrActivityState } from "../../vlmOcrActivity";
import { isVLMOcrActivityBusy } from "../../vlmOcrActivity";
import { AiChipIcon } from "../ui/AiChipIcon";
import { useLLMModelsQuery, useLLMHealthMutation } from "../../queries";
import type { SettingsInfo } from "../../types";
import { Button, Card, IconButton, Select, Switch, TextInput } from "../ui";
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
  onDismissAITag: () => void;
  onStartVLMOcr: () => void;
  onStopVLMOcr: () => void;
  onDismissVLMOcr: () => void;
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
  onDismissAITag,
  onStartVLMOcr,
  onStopVLMOcr,
  onDismissVLMOcr,
}: AISectionProps) {
  const { t } = useTranslation();

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
                  aria-label={t("settings.llmProvider")}
                  className="min-w-[400px]"
                />
              </FieldRow>

              <FieldRow label={t("settings.llmEndpoint")}>
                <TextInput
                  value={draft.llmEndpoint}
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
                {aiTagActivity.phase !== "idle" && (
                  <AITagProgressText activity={aiTagActivity} />
                )}
              </div>
            </FieldRow>
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
                {vlmOcrActivity.phase !== "idle" && (
                  <VLMOcrProgressText activity={vlmOcrActivity} />
                )}
              </div>
            </FieldRow>
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
        ? `${counts.processed}/${counts.queued + counts.cacheHit + counts.skipped}`
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

function AITagProgressText({ activity }: { activity: AITagActivityState }) {
  const { t } = useTranslation();
  const busy = isAITagActivityBusy(activity);
  const label = aiTagProgressLabel(activity, t);

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
        ? `${counts.processed}/${counts.queued + counts.cacheHit + counts.skipped}`
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
    </div>
  );
}

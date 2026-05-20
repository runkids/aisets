import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  MessageSquareText,
  RefreshCw,
  Settings2,
  Shuffle,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePromptPresetsQuery,
  useCreatePromptPresetMutation,
  useUpdatePromptPresetMutation,
  useUpdateSettingsMutation,
  useDetectAgentCLIsMutation,
  useLLMModelsQuery,
  useLLMHealthMutation,
} from "@/queries";
import { useToast } from "@/components/shared/ToastProvider";
import { errorMessage } from "@/i18n";
import type { SettingsInfo } from "@/types";
import { AiChipIcon } from "@/components/ui/AiChipIcon";
import { VLMBackendSelect } from "./VLMBackendSelect";
import { EmbeddingCalibrationPanel } from "./EmbeddingCalibrationPanel";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Range,
  Select,
  Switch,
  Tabs,
  Textarea,
  TextInput,
  Tooltip,
} from "@/components/ui";
import {
  LLM_MAX_CONCURRENCY,
  LLM_MIN_TIMEOUT,
  LLM_MAX_TIMEOUT,
} from "./constants";
import type { Mode } from "@/ui";
import { FieldRow } from "./index";
import type { SettingsDraft } from "./types";
import {
  agentCliAdapters,
  deriveHost,
  sortedTranslationLocales,
} from "./aiSectionUtils";

type AISettingsCardProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  imagePreviewEnabled: boolean;
  imagePreviewDelaySeconds: number;
  imagePreviewSize: { width: number; height: number };
  working: boolean;
  aiBusy: boolean;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onNavigate?: (mode: Mode) => void;
};

export function AISettingsCard({
  draft,
  settings,
  imagePreviewEnabled,
  imagePreviewDelaySeconds,
  imagePreviewSize,
  working,
  aiBusy,
  settingActions,
  onUpdateDraft,
  onNavigate,
}: AISettingsCardProps) {
  const { t } = useTranslation();
  const vlmBackendMutation = useUpdateSettingsMutation();
  const detectMutation = useDetectAgentCLIsMutation();
  const toast = useToast();
  const [aiTab, setAiTab] = useState<
    "local" | "agent" | "backend" | "prompts" | "search"
  >("local");

  const agentAdapters = agentCliAdapters(settings?.agentRuntime?.adapters);
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
    <Card
      className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
      padding="none"
    >
      <div className="flex items-center gap-3 border-b border-g-line px-6 py-2.5 md:px-8">
        <AiChipIcon size={15} className="shrink-0 text-g-ink-3" />
        <span className="shrink-0 font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
          {t("settings.section.ai")}
        </span>
        <div className="ml-auto overflow-x-auto">
          <Tabs
            value={aiTab}
            items={[
              {
                value: "local" as const,
                label: t("settings.aiTabLocal"),
                icon: <Settings2 />,
              },
              {
                value: "agent" as const,
                label: t("settings.aiTabAgent"),
                icon: <Bot />,
                badge: agentAdapters.length ? (
                  <Badge tone="green">{agentAdapters.length}</Badge>
                ) : undefined,
              },
              {
                value: "backend" as const,
                label: t("settings.aiTabBackend"),
                icon: <Shuffle />,
              },
              {
                value: "prompts" as const,
                label: t("settings.aiTabPrompts"),
                icon: <MessageSquareText />,
              },
              {
                value: "search" as const,
                label: t("settings.aiTabSearch"),
                icon: <Wand2 />,
              },
            ]}
            onChange={setAiTab}
            ariaLabel="AI settings tab"
            variant="segment"
            size="sm"
          />
        </div>
      </div>
      <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
        {aiTab === "local" && (
          <>
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
                    <div className="flex min-w-[320px] items-center gap-3">
                      <Range
                        min={1}
                        max={LLM_MAX_CONCURRENCY}
                        step={1}
                        value={draft.llmConcurrency}
                        disabled={aiBusy}
                        onChange={(e) =>
                          onUpdateDraft((current) => ({
                            ...current,
                            llmConcurrency: Number(e.target.value),
                          }))
                        }
                        aria-label={t("settings.llmConcurrency")}
                      />
                      <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                        {draft.llmConcurrency}
                      </span>
                    </div>
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
                  <div className="flex min-w-[320px] items-center gap-3">
                    <Range
                      min={LLM_MIN_TIMEOUT}
                      max={LLM_MAX_TIMEOUT}
                      step={10}
                      value={draft.llmTimeout}
                      disabled={aiBusy}
                      onChange={(e) =>
                        onUpdateDraft((current) => ({
                          ...current,
                          llmTimeout: Number(e.target.value),
                        }))
                      }
                      aria-label={t("settings.llmTimeout")}
                    />
                    <span className="inline-flex h-g-btn-sm min-w-[44px] items-center justify-center rounded-g-md border border-g-line bg-g-surface-2 font-g-mono text-g-ui font-[590] tabular-nums tracking-g-mono text-g-ink">
                      {draft.llmTimeout}s
                    </span>
                  </div>
                </FieldRow>
              </>
            )}
          </>
        )}

        {aiTab === "agent" && (
          <>
            <FieldRow
              label={t("settings.agentEnabled")}
              description={t("settings.agentEnabledHint")}
            >
              <Switch
                checked={draft.agentEnabled}
                disabled={aiBusy}
                onCheckedChange={(next) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    agentEnabled: next,
                  }))
                }
                aria-label={t("settings.agentEnabled")}
              />
            </FieldRow>

            <FieldRow
              label={t("settings.agentAvailable")}
              description={
                agentAdapters.length
                  ? undefined
                  : t("settings.agentNoneDetected")
              }
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {agentAdapters.map((a) => (
                  <Badge key={a.id} tone="green">
                    {a.name}
                    {a.version ? ` ${a.version}` : ""}
                  </Badge>
                ))}
                <Tooltip label={t("settings.agentDetectTooltip")}>
                  <IconButton
                    size="sm"
                    aria-label={t("settings.agentDetect")}
                    disabled={detectMutation.isPending}
                    onClick={() =>
                      detectMutation.mutate(undefined, {
                        onSuccess: (data) => {
                          const count = agentCliAdapters(
                            data.settings.agentRuntime?.adapters,
                          ).length;
                          toast.success(
                            t("settings.agentDetectDone", { count }),
                          );
                        },
                        onError: (err) => {
                          toast.error(errorMessage(err));
                        },
                      })
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={
                        detectMutation.isPending ? "animate-spin" : undefined
                      }
                    />
                  </IconButton>
                </Tooltip>
              </div>
            </FieldRow>

            <FieldRow
              label={t("settings.agentAdapter")}
              description={t("settings.agentAdapterHint")}
            >
              <Select
                value={draft.agentAdapter || "auto"}
                options={[
                  {
                    value: "auto",
                    label: t("settings.agentAdapterAuto"),
                  },
                  { value: "codex", label: "Codex CLI" },
                  { value: "claude", label: "Claude Code" },
                  { value: "cursor-agent", label: "Cursor Agent" },
                  { value: "antigravity", label: "Antigravity 2.0" },
                  { value: "copilot", label: "Copilot CLI" },
                  { value: "pi", label: "Pi" },
                ]}
                disabled={aiBusy || !draft.agentEnabled}
                onChange={(value) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    agentAdapter: value,
                  }))
                }
                aria-label={t("settings.agentAdapter")}
                className="min-w-[400px]"
              />
            </FieldRow>

            <FieldRow
              label={t("settings.agentModel")}
              description={t("settings.agentModelHint")}
            >
              <TextInput
                value={draft.agentModel}
                disabled={aiBusy || !draft.agentEnabled}
                onChange={(e) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    agentModel: e.target.value,
                  }))
                }
                placeholder="gpt-5.5, claude-sonnet-4-6"
                aria-label={t("settings.agentModel")}
                className="min-w-[400px]"
              />
            </FieldRow>
          </>
        )}

        {aiTab === "backend" && (
          <div className="flex flex-col gap-2.5 py-3">
            {[
              {
                key: "vlmBackend" as const,
                label: t("settings.vlmBackendGlobal"),
                showInherit: false,
              },
              {
                key: "vlmBackendTag" as const,
                label: t("settings.vlmBackendFeatureTag"),
                showInherit: true,
              },
              {
                key: "vlmBackendOcr" as const,
                label: t("settings.vlmBackendFeatureOcr"),
                showInherit: true,
              },
              {
                key: "vlmBackendOptimize" as const,
                label: t("settings.vlmBackendFeatureOptimize"),
                showInherit: true,
              },
              {
                key: "vlmBackendDuplicate" as const,
                label: t("settings.vlmBackendFeatureDuplicate"),
                showInherit: true,
              },
              {
                key: "vlmBackendPrecheck" as const,
                label: t("settings.vlmBackendFeaturePrecheck"),
                showInherit: true,
              },
              {
                key: "vlmBackendTranslate" as const,
                label: t("settings.vlmBackendFeatureTranslate"),
                showInherit: true,
              },
              {
                key: "vlmBackendCanvas" as const,
                label: t("settings.vlmBackendFeatureCanvas"),
                showInherit: true,
              },
            ].map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4"
              >
                <span className="font-g text-g-ui tracking-g-ui text-g-ink-2">
                  {row.label}
                </span>
                <VLMBackendSelect
                  value={draft[row.key]}
                  agentRuntime={settings?.agentRuntime}
                  llmRuntime={settings?.llmRuntime}
                  models={models}
                  showInherit={row.showInherit}
                  disabled={aiBusy}
                  onChange={(v) => {
                    onUpdateDraft((c) => ({ ...c, [row.key]: v }));
                    vlmBackendMutation.mutate(
                      { [row.key]: v },
                      {
                        onSuccess: () =>
                          toast.success(t("toast.settingsSaved")),
                        onError: (err) => toast.error(errorMessage(err)),
                      },
                    );
                  }}
                />
              </div>
            ))}
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-g-line pt-3">
              <span className="font-g text-g-ui tracking-g-ui text-g-ink-2">
                {t("settings.aiNickname")}
              </span>
              <TextInput
                value={draft.aiNickname ?? ""}
                placeholder="Aisets"
                className="w-48"
                onChange={(e) =>
                  onUpdateDraft((c) => ({
                    ...c,
                    aiNickname: e.target.value,
                  }))
                }
                onBlur={() => {
                  vlmBackendMutation.mutate(
                    { aiNickname: draft.aiNickname },
                    {
                      onSuccess: () => toast.success(t("toast.settingsSaved")),
                      onError: (err: unknown) => toast.error(errorMessage(err)),
                    },
                  );
                }}
              />
            </div>
          </div>
        )}

        {aiTab === "prompts" && (
          <div className="py-3">
            <PromptsLocaleCard
              draft={draft}
              systemPromptEnabled={settings?.llmSystemPromptEnabled ?? false}
              onUpdateDraft={onUpdateDraft}
              onNavigate={onNavigate}
              embedded
            />
          </div>
        )}

        {aiTab === "search" && (
          <>
            <FieldRow
              label={t("settings.embedSearchType")}
              description={t("settings.embedSearchTypeHint")}
            >
              <Select
                value={draft.embedSearchType || "hybrid"}
                options={[
                  { value: "hybrid", label: t("settings.embedTypeHybrid") },
                  { value: "text", label: t("settings.embedTypeText") },
                  { value: "image", label: t("settings.embedTypeImage") },
                ]}
                onChange={(value) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    embedSearchType: value,
                  }))
                }
                aria-label={t("settings.embedSearchType")}
                className="min-w-[400px]"
              />
            </FieldRow>

            <FieldRow
              label={t("settings.embedSearchThreshold")}
              description={t("settings.embedSearchThresholdHint")}
            >
              <TextInput
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={String(draft.embedSearchThreshold ?? 0.4)}
                onChange={(e) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    embedSearchThreshold: Math.max(
                      0,
                      Math.min(1, Number(e.target.value) || 0.4),
                    ),
                  }))
                }
                aria-label={t("settings.embedSearchThreshold")}
                className="min-w-[400px]"
              />
            </FieldRow>

            <FieldRow
              label={t("settings.embedImageSearchThreshold")}
              description={t("settings.embedImageSearchThresholdHint")}
            >
              <TextInput
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={String(draft.embedImageSearchThreshold ?? 0.24)}
                onChange={(e) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    embedImageSearchThreshold: Math.max(
                      0,
                      Math.min(1, Number(e.target.value) || 0.24),
                    ),
                  }))
                }
                aria-label={t("settings.embedImageSearchThreshold")}
                className="min-w-[400px]"
              />
            </FieldRow>

            <FieldRow
              label={t("settings.embedImageDynamic")}
              description={t("settings.embedImageDynamicHint")}
            >
              <div className="flex min-w-[400px] items-center gap-3">
                <Switch
                  checked={draft.embedImageDynamicEnabled}
                  onCheckedChange={(checked) =>
                    onUpdateDraft((current) => ({
                      ...current,
                      embedImageDynamicEnabled: checked,
                    }))
                  }
                  aria-label={t("settings.embedImageDynamic")}
                />
                <TextInput
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={String(draft.embedImageDynamicMargin ?? 0.05)}
                  onChange={(e) =>
                    onUpdateDraft((current) => ({
                      ...current,
                      embedImageDynamicMargin: Math.max(
                        0,
                        Math.min(1, Number(e.target.value) || 0.05),
                      ),
                    }))
                  }
                  aria-label={t("settings.embedImageDynamicMargin")}
                  className="w-[120px]"
                />
              </div>
            </FieldRow>

            <FieldRow
              label={t("settings.embedSearchLimit")}
              description={t("settings.embedSearchLimitHint")}
            >
              <TextInput
                type="number"
                min={1}
                max={100}
                value={String(draft.embedSearchLimit ?? 20)}
                onChange={(e) =>
                  onUpdateDraft((current) => ({
                    ...current,
                    embedSearchLimit: Math.max(
                      1,
                      Math.min(100, Number(e.target.value) || 20),
                    ),
                  }))
                }
                aria-label={t("settings.embedSearchLimit")}
                className="min-w-[400px]"
              />
            </FieldRow>

            <FieldRow
              label={t("settings.embedInputFields")}
              description={t("settings.embedInputFieldsHint")}
            >
              <div className="flex flex-wrap gap-2 min-w-[400px]">
                {(
                  [
                    {
                      id: "category",
                      label: t("settings.embedFieldCategory"),
                    },
                    { id: "tags", label: t("settings.embedFieldTags") },
                    {
                      id: "description",
                      label: t("settings.embedFieldDescription"),
                    },
                    {
                      id: "fileName",
                      label: t("settings.embedFieldFileName"),
                    },
                    { id: "ocrText", label: t("settings.embedFieldOcrText") },
                  ] as const
                ).map((field) => {
                  const fields = draft.embedInputFields ?? [
                    "category",
                    "tags",
                    "description",
                  ];
                  const active = fields.includes(field.id);
                  return (
                    <Button
                      key={field.id}
                      variant="chip"
                      size="sm"
                      data-active={active || undefined}
                      onClick={() =>
                        onUpdateDraft((current) => {
                          const cur = current.embedInputFields ?? [
                            "category",
                            "tags",
                            "description",
                          ];
                          const next = active
                            ? cur.filter((f) => f !== field.id)
                            : [...cur, field.id];
                          return {
                            ...current,
                            embedInputFields: next.length > 0 ? next : cur,
                          };
                        })
                      }
                    >
                      {active && <Check size={12} />}
                      {field.label}
                    </Button>
                  );
                })}
              </div>
            </FieldRow>

            <FieldRow
              label={t("settings.embedCalibration")}
              description={t("settings.embedCalibrationHint")}
            >
              <EmbeddingCalibrationPanel
                draft={draft}
                settings={settings}
                imagePreviewEnabled={imagePreviewEnabled}
                imagePreviewDelayMs={imagePreviewDelaySeconds * 1000}
                imagePreviewSize={imagePreviewSize}
                onUpdateDraft={onUpdateDraft}
              />
            </FieldRow>
          </>
        )}

        {(aiTab === "local" || aiTab === "agent" || aiTab === "search") &&
          settingActions}
      </div>
    </Card>
  );
}

// ── Prompt sub-components (used by the "prompts" tab) ──────────────

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
        <div className="flex justify-end">
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
  embedded,
}: {
  draft: SettingsDraft;
  systemPromptEnabled: boolean;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onNavigate?: (mode: Mode) => void;
  embedded?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const updateSettings = useUpdateSettingsMutation();

  function handleSystemPromptToggle(checked: boolean) {
    updateSettings.mutate(
      { llmSystemPromptEnabled: checked },
      {
        onSuccess: () =>
          toast.success(
            checked
              ? t("settings.systemPromptEnabled")
              : t("settings.systemPromptDisabled"),
          ),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  const content = (
    <div
      className={
        embedded
          ? "divide-y divide-g-line"
          : "divide-y divide-g-line px-6 py-2 md:px-8 md:py-3"
      }
    >
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
          onCheckedChange={(next) => {
            onUpdateDraft((current) => ({
              ...current,
              llmAutoLocale: next,
            }));
            updateSettings.mutate(
              { llmAutoLocale: next },
              {
                onSuccess: () =>
                  toast.success(
                    next
                      ? t("settings.autoLocaleEnabled")
                      : t("settings.autoLocaleDisabled"),
                  ),
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
          aria-label={t("settings.llmAutoLocale")}
        />
      </FieldRow>
      <FieldRow
        label={t("settings.llmTranslationLocales")}
        description={t("settings.llmTranslationLocalesHint")}
      >
        <div className="flex flex-wrap gap-2 min-w-[400px]">
          {sortedTranslationLocales(i18n.language).map((locale) => {
            const locales = draft.llmTranslationLocales ?? ["en"];
            const active = locales.includes(locale.id);
            return (
              <Button
                key={locale.id}
                variant="chip"
                size="sm"
                data-active={active || undefined}
                disabled={locale.id === "en"}
                onClick={() =>
                  onUpdateDraft((current) => {
                    const cur = current.llmTranslationLocales ?? ["en"];
                    const next = active
                      ? cur.filter((l) => l !== locale.id)
                      : [...cur, locale.id];
                    return {
                      ...current,
                      llmTranslationLocales: next.includes("en")
                        ? next
                        : ["en", ...next],
                    };
                  })
                }
              >
                {active && <Check size={12} />}
                {locale.label}
              </Button>
            );
          })}
        </div>
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
  );

  if (embedded) return content;

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
      {content}
    </Card>
  );
}

import { BrainCircuit, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLLMModelsQuery, useLLMHealthMutation } from "../../queries";
import type { SettingsInfo } from "../../types";
import { Button, Card, IconButton, Select, TextInput } from "../ui";
import { FieldRow } from "./index";
import type { SettingsDraft } from "./types";

type AISectionProps = {
  draft: SettingsDraft;
  settings?: SettingsInfo;
  working: boolean;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama: "http://localhost:11434",
  "openai-compat": "http://localhost:1234/v1",
};

export function AISection({
  draft,
  settings,
  working,
  settingActions,
  onUpdateDraft,
}: AISectionProps) {
  const { t } = useTranslation();

  const providerEnabled = draft.llmProvider !== "";
  const modelsQuery = useLLMModelsQuery(providerEnabled);
  const healthMutation = useLLMHealthMutation();

  const models = modelsQuery.data?.models ?? [];
  const modelOptions = [
    { value: "", label: t("settings.llmSelectModel") },
    ...models.map((m) => ({ value: m.name, label: m.name })),
  ];

  const providerOptions = [
    { value: "", label: t("settings.llmProviderDisabled") },
    { value: "ollama", label: t("settings.llmProviderOllama") },
    {
      value: "openai-compat",
      label: t("settings.llmProviderOpenAICompat"),
    },
  ];

  const runtime = settings?.llmRuntime;
  const isConnected = runtime?.connected ?? false;
  const statusText = isConnected
    ? t("settings.llmConnected", { count: runtime?.models.length ?? 0 })
    : runtime?.error
      ? runtime.error
      : t("settings.llmDisconnected");

  function handleProviderChange(value: string) {
    onUpdateDraft((current) => ({
      ...current,
      llmProvider: value,
      llmEndpoint: DEFAULT_ENDPOINTS[value] ?? current.llmEndpoint,
      llmVisionModel: "",
      llmEmbedModel: "",
    }));
  }

  function handleTestConnection() {
    void healthMutation.mutate(undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
        padding="none"
      >
        <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
          <BrainCircuit size={15} className="shrink-0 text-g-ink-3" />
          <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
            {t("settings.section.ai")}
          </span>
        </div>
        <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
          <FieldRow label={t("settings.llmProvider")}>
            <Select
              value={draft.llmProvider}
              options={providerOptions}
              onChange={handleProviderChange}
              aria-label={t("settings.llmProvider")}
            />
          </FieldRow>

          {providerEnabled && (
            <>
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
                  className="w-full min-w-[280px]"
                />
              </FieldRow>

              <FieldRow label={t("settings.llmVisionModel")}>
                <div className="flex items-center gap-1.5 min-w-[280px]">
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

              <FieldRow label={t("settings.llmEmbedModel")}>
                <div className="flex items-center gap-1.5 min-w-[280px]">
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
                <div className="flex items-center gap-3 min-w-[280px]">
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
        </div>
        <div className="border-t border-g-line px-6 py-2 md:px-8 md:py-3">
          {settingActions}
        </div>
      </Card>
    </div>
  );
}

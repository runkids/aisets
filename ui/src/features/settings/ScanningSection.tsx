import {
  Download,
  Globe2,
  Link,
  LoaderCircle,
  Plus,
  ScanText,
  Sliders,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/i18n";
import { projectScanIntentLabel } from "@/projectScanIntent";
import type { ProjectScanIntent } from "@/types";
import type { SettingsDraft, OCRLanguagePack } from "./types";
import { scanProfileOptions } from "./constants";
import { FieldRow } from "./FieldRow";
import { ocrLanguageLabel } from "./helpers";
import { OCRLanguageSelect } from "./OCRLanguageSelect";
import {
  Button,
  Card,
  ConfirmDialog,
  Modal,
  Notice,
  Select,
  Switch,
  Textarea,
  TextInput,
} from "@/components/ui";

type ScanningSectionProps = {
  draft: SettingsDraft;
  settingsLoading: boolean;
  working: boolean;
  ocrWorking: boolean;
  ocrRunStopping: boolean;
  ocrRunActive: boolean;
  ocrStopDisabled: boolean;
  ocrProgress: string;
  ocrLanguagePacks: OCRLanguagePack[];
  hasSelectedOCRLanguages: boolean;
  hasUninstalledSelectedOCRLanguages: boolean;
  selectedOCRLanguagesInstalled: boolean;
  missingSelectedOCRLanguages: string[];
  ocrRuntimeInstalled: boolean;
  ocrRuntimeEngineAvailable: boolean;
  ocrRuntimeEngineError: string;
  ocrRuntimePlatform: string;
  updatePending: boolean;
  updateError: Error | null;
  catalogActions: ReactNode;
  ocrActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onInstallOCR: () => void;
  onRemoveOCR: () => void;
  onRunOCR: () => void;
  onStopOCR: () => void;
  installOCRPending: boolean;
  removeOCRPending: boolean;
};

export function ScanningSection({
  draft,
  settingsLoading,
  working,
  ocrWorking,
  ocrRunStopping,
  ocrRunActive,
  ocrStopDisabled,
  ocrProgress,
  ocrLanguagePacks,
  hasSelectedOCRLanguages,
  hasUninstalledSelectedOCRLanguages,
  selectedOCRLanguagesInstalled,
  missingSelectedOCRLanguages,
  ocrRuntimeInstalled,
  ocrRuntimeEngineAvailable,
  ocrRuntimeEngineError,
  ocrRuntimePlatform,
  updatePending,
  updateError,
  catalogActions,
  ocrActions,
  onUpdateDraft,
  onInstallOCR,
  onRemoveOCR,
  onRunOCR,
  onStopOCR,
  installOCRPending,
  removeOCRPending,
}: ScanningSectionProps) {
  const { t } = useTranslation();
  const [ocrLimitsOpen, setOCRLimitsOpen] = useState(false);
  const [runOCRConfirmOpen, setRunOCRConfirmOpen] = useState(false);
  const [removeOCRConfirmOpen, setRemoveOCRConfirmOpen] = useState(false);
  const [excludeScope, setExcludeScope] = useState<
    "global" | ProjectScanIntent
  >("global");

  const ocrEngineInstallHintKey =
    ocrRuntimePlatform === "darwin"
      ? "settings.ocrEngineInstallHintDarwin"
      : ocrRuntimePlatform === "windows"
        ? "settings.ocrEngineInstallHintWindows"
        : ocrRuntimePlatform === "linux"
          ? "settings.ocrEngineInstallHintLinux"
          : "settings.ocrEngineInstallHintFallback";

  const excludeScopeOptions = [
    {
      value: "global",
      label: t("settings.excludeScope.global"),
      description: t("settings.excludeScope.globalHint"),
    },
    ...(["code", "assetPack", "library", "mixed"] as ProjectScanIntent[]).map(
      (intent) => ({
        value: intent,
        label: projectScanIntentLabel(t, intent),
        description: t(`settings.excludeScope.${intent}Hint`),
      }),
    ),
  ];
  const excludePatternsText =
    excludeScope === "global"
      ? draft.excludePatternsText
      : draft.excludePatternsByIntentText[excludeScope];

  return (
    <>
      <div className="flex flex-col gap-4">
        <Card
          className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <ScanText size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.catalogGroup")}
            </span>
          </div>
          <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
            <FieldRow
              label={t("settings.scanOnOpen")}
              description={t("settings.scanOnOpenHint")}
              icon={<ScanText size={15} />}
            >
              <Switch
                checked={draft.scanOnOpen}
                onCheckedChange={(next) =>
                  onUpdateDraft((prev) => ({ ...prev, scanOnOpen: next }))
                }
                disabled={settingsLoading || updatePending}
                aria-label={t("settings.scanOnOpen")}
              />
            </FieldRow>
            <FieldRow
              label={t("settings.scanProfileLabel")}
              description={t("settings.scanProfileHint")}
              icon={<Sliders size={15} />}
              align="start"
            >
              <div className="w-full min-[1200px]:w-[420px]">
                <Select
                  value={draft.scanProfile}
                  options={scanProfileOptions.map((option) => ({
                    ...option,
                    label: t(`settings.scanProfile.${option.value}`),
                    description: t(`settings.scanProfile.${option.value}Hint`),
                  }))}
                  onChange={(value) =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      scanProfile: value as typeof draft.scanProfile,
                    }))
                  }
                  aria-label={t("settings.scanProfileLabel")}
                />
              </div>
            </FieldRow>
            {draft.scanProfile === "custom" && (
              <FieldRow
                label={t("settings.scanAnalysesLabel")}
                description={t("settings.scanAnalysesHint")}
                icon={<Sliders size={15} />}
                align="start"
              >
                <div className="grid w-full gap-2 min-[1200px]:w-[420px]">
                  {(
                    ["references", "nearDuplicates", "optimization"] as const
                  ).map((analysis) => (
                    <label
                      key={analysis}
                      className="flex min-h-10 items-center justify-between gap-3 rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-g text-g-ui font-[510] text-g-ink">
                          {t(`settings.scanAnalyses.${analysis}`)}
                        </span>
                        <span className="block truncate text-g-caption text-g-ink-3">
                          {t(`settings.scanAnalyses.${analysis}Hint`)}
                        </span>
                      </span>
                      <Switch
                        checked={draft.scanAnalyses[analysis]}
                        onCheckedChange={(next) =>
                          onUpdateDraft((prev) => ({
                            ...prev,
                            scanAnalyses: {
                              ...prev.scanAnalyses,
                              [analysis]: next,
                            },
                          }))
                        }
                        aria-label={t(`settings.scanAnalyses.${analysis}`)}
                      />
                    </label>
                  ))}
                </div>
              </FieldRow>
            )}
            <FieldRow
              label={t("settings.excludePatterns")}
              description={t("settings.excludePatternsHint")}
              icon={<Sliders size={15} />}
              align="start"
            >
              <div className="grid w-full gap-2 min-[1200px]:w-[420px]">
                <Select
                  value={excludeScope}
                  options={excludeScopeOptions}
                  onChange={(value) =>
                    setExcludeScope(value as "global" | ProjectScanIntent)
                  }
                  aria-label={t("settings.excludeScopeLabel")}
                />
                <Textarea
                  disabled={settingsLoading || updatePending}
                  value={excludePatternsText}
                  onChange={(event) => {
                    const value = event.target.value;
                    onUpdateDraft((prev) =>
                      excludeScope === "global"
                        ? { ...prev, excludePatternsText: value }
                        : {
                            ...prev,
                            excludePatternsByIntentText: {
                              ...prev.excludePatternsByIntentText,
                              [excludeScope]: value,
                            },
                          },
                    );
                  }}
                  rows={6}
                  className="w-full"
                  textareaClassName="min-h-36 font-g-mono text-g-ui tracking-g-mono"
                />
                <p className="font-g text-g-caption tracking-g-ui text-g-ink-3">
                  {excludeScope === "global"
                    ? t("settings.excludeScopeGlobalNote")
                    : t("settings.excludeScopeIntentNote", {
                        intent: projectScanIntentLabel(t, excludeScope),
                      })}
                </p>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.importAliases")}
              description={t("settings.importAliasesHint")}
              icon={<Link size={15} />}
              align="start"
            >
              <div className="grid w-full gap-2 min-[1200px]:w-[420px]">
                {draft.importAliases.map((alias) => (
                  <div key={alias.id} className="flex items-center gap-2">
                    <TextInput
                      disabled={settingsLoading || updatePending}
                      value={alias.key}
                      onChange={(event) => {
                        const value = event.target.value;
                        onUpdateDraft((prev) => ({
                          ...prev,
                          importAliases: prev.importAliases.map((a) =>
                            a.id === alias.id ? { ...a, key: value } : a,
                          ),
                        }));
                      }}
                      placeholder="@scope/package"
                      className="flex-1"
                      inputClassName="font-g-mono text-g-ui tracking-g-mono"
                    />
                    <span className="shrink-0 text-g-ink-3">&rarr;</span>
                    <TextInput
                      disabled={settingsLoading || updatePending}
                      value={alias.value}
                      onChange={(event) => {
                        const value = event.target.value;
                        onUpdateDraft((prev) => ({
                          ...prev,
                          importAliases: prev.importAliases.map((a) =>
                            a.id === alias.id ? { ...a, value } : a,
                          ),
                        }));
                      }}
                      placeholder="packages/package"
                      className="flex-1"
                      inputClassName="font-g-mono text-g-ui tracking-g-mono"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-g-ink-3 hover:bg-g-hover hover:text-g-ink"
                      onClick={() =>
                        onUpdateDraft((prev) => ({
                          ...prev,
                          importAliases: prev.importAliases.filter(
                            (a) => a.id !== alias.id,
                          ),
                        }))
                      }
                      aria-label={t("settings.importAliasRemove")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={settingsLoading || updatePending}
                  onClick={() =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      importAliases: [
                        ...prev.importAliases,
                        { id: `alias-${Date.now()}`, key: "", value: "" },
                      ],
                    }))
                  }
                >
                  <Plus size={14} />
                  {t("settings.importAliasAdd")}
                </Button>
              </div>
            </FieldRow>
            {updateError && (
              <Notice tone="danger">{errorMessage(updateError)}</Notice>
            )}
            {catalogActions}
          </div>
        </Card>
        <Card
          className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm"
          padding="none"
        >
          <div className="flex items-center gap-2.5 border-b border-g-line px-6 py-3 md:px-8">
            <ScanText size={15} className="shrink-0 text-g-ink-3" />
            <span className="font-g text-g-ui font-[590] uppercase tracking-[0.06em] text-g-ink-3">
              {t("settings.ocrGroup")}
            </span>
          </div>
          <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
            <FieldRow
              label={t("settings.ocrEnabled")}
              description={t("settings.ocrEnabledHint")}
              icon={<ScanText size={15} />}
            >
              <Switch
                checked={draft.ocrEnabled}
                onCheckedChange={(next) =>
                  onUpdateDraft((prev) => ({ ...prev, ocrEnabled: next }))
                }
                disabled={settingsLoading || updatePending}
                aria-label={t("settings.ocrEnabled")}
              />
            </FieldRow>
            <FieldRow
              label={t("settings.ocrLanguages")}
              description={t("settings.ocrLanguagesHint")}
              icon={<Globe2 size={15} />}
              align="start"
            >
              <div className="w-full min-[1200px]:w-[420px]">
                <OCRLanguageSelect
                  value={draft.ocrLanguages}
                  packs={ocrLanguagePacks}
                  onChange={(languages) =>
                    onUpdateDraft((prev) => ({
                      ...prev,
                      ocrLanguages: languages,
                    }))
                  }
                  disabled={settingsLoading || updatePending}
                />
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.ocrLimits")}
              description={t("settings.ocrLimitsHint")}
              icon={<Sliders size={15} />}
              align="start"
            >
              <div className="flex w-full items-center justify-start min-[1200px]:w-[420px] min-[1200px]:justify-end">
                <Button
                  variant="secondary"
                  className="min-w-[96px]"
                  leadingIcon={<Sliders size={14} />}
                  onClick={() => setOCRLimitsOpen(true)}
                  aria-label={`${t("settings.ocrLimits")} ${t("settings.ocrLimitsEdit")}`}
                  disabled={settingsLoading || updatePending}
                >
                  {t("settings.ocrLimitsEdit")}
                </Button>
              </div>
            </FieldRow>
            <FieldRow
              label={t("settings.ocrRuntime")}
              description={t("settings.ocrRuntimeHint")}
              icon={<Download size={15} />}
              align="start"
            >
              <div className="flex w-full flex-col items-start gap-2 min-[1200px]:w-[560px] min-[1200px]:items-end">
                <div className="flex flex-wrap justify-start gap-2 min-[1200px]:justify-end">
                  <Button
                    variant="secondary"
                    leadingIcon={
                      installOCRPending ? (
                        <LoaderCircle
                          size={14}
                          className="animate-[icon-spin_900ms_linear_infinite]"
                        />
                      ) : (
                        <Download size={14} />
                      )
                    }
                    onClick={() => void onInstallOCR()}
                    disabled={
                      working ||
                      ocrWorking ||
                      !hasSelectedOCRLanguages ||
                      !hasUninstalledSelectedOCRLanguages
                    }
                  >
                    {installOCRPending
                      ? t("settings.ocrInstalling")
                      : t("settings.ocrInstall")}
                  </Button>
                  <Button
                    variant="secondary"
                    leadingIcon={
                      removeOCRPending ? (
                        <LoaderCircle
                          size={14}
                          className="animate-[icon-spin_900ms_linear_infinite]"
                        />
                      ) : (
                        <Trash2 size={14} />
                      )
                    }
                    onClick={() => setRemoveOCRConfirmOpen(true)}
                    disabled={working || ocrWorking || !ocrRuntimeInstalled}
                  >
                    {removeOCRPending
                      ? t("settings.ocrRemoving")
                      : t("settings.ocrRemove")}
                  </Button>
                  {ocrWorking ? (
                    <Button
                      variant="secondary"
                      leadingIcon={
                        ocrRunStopping ? (
                          <LoaderCircle
                            size={14}
                            className="animate-[icon-spin_900ms_linear_infinite]"
                          />
                        ) : (
                          <Square size={14} />
                        )
                      }
                      onClick={onStopOCR}
                      disabled={ocrRunStopping || ocrStopDisabled}
                    >
                      {ocrRunStopping
                        ? t("settings.ocrStopping")
                        : t("settings.ocrStop")}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      leadingIcon={<ScanText size={14} />}
                      onClick={() => setRunOCRConfirmOpen(true)}
                      disabled={
                        working ||
                        !draft.ocrEnabled ||
                        !ocrRuntimeInstalled ||
                        !ocrRuntimeEngineAvailable ||
                        !selectedOCRLanguagesInstalled
                      }
                    >
                      {t("settings.ocrRun")}
                    </Button>
                  )}
                </div>
                <p className="font-g text-g-caption tracking-g-ui text-g-ink-3">
                  {ocrRuntimeInstalled
                    ? t("settings.ocrInstalled")
                    : t("settings.ocrNotInstalled")}
                </p>
                <p className="w-full rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2 text-left font-g text-g-ui leading-[1.55] tracking-g-ui text-g-ink-3">
                  {t("settings.ocrCacheScopeHint")}
                </p>
                {ocrRuntimeEngineAvailable === false && (
                  <div className="w-full rounded-g-md border border-g-red/40 bg-g-red/10 px-3 py-2 text-left font-g text-g-caption leading-[1.55] tracking-g-ui text-g-red">
                    <p>
                      {t("settings.ocrEngineUnavailable", {
                        error: ocrRuntimeEngineError,
                      })}
                    </p>
                    <p className="mt-1 font-g-mono text-g-chip tracking-g-mono">
                      {t(ocrEngineInstallHintKey)}
                    </p>
                  </div>
                )}
                {ocrRuntimeInstalled &&
                  missingSelectedOCRLanguages.length > 0 && (
                    <p className="font-g text-g-caption tracking-g-ui text-g-red">
                      {t("settings.ocrMissingSelectedLanguages", {
                        languages: missingSelectedOCRLanguages
                          .map((language) => ocrLanguageLabel(language, t))
                          .join(", "),
                      })}
                    </p>
                  )}
                {ocrProgress && (
                  <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3 flex items-center gap-1.5">
                    {ocrRunActive && (
                      <LoaderCircle
                        size={12}
                        className="animate-spin shrink-0"
                      />
                    )}
                    {ocrProgress}
                  </p>
                )}
              </div>
            </FieldRow>
            {updateError && (
              <Notice tone="danger">{errorMessage(updateError)}</Notice>
            )}
            {ocrActions}
          </div>
        </Card>
      </div>
      {ocrLimitsOpen && (
        <Modal
          title={t("settings.ocrLimitsHelpTitle")}
          description={t("settings.ocrLimitsHelpDesc")}
          size="md"
          onClose={() => setOCRLimitsOpen(false)}
          bodyClassName="space-y-4"
        >
          <Notice tone="info">{t("settings.ocrLimitsKeepDefaults")}</Notice>

          <fieldset className="space-y-0.5 rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <legend className="sr-only">
              {t("settings.ocrGroupPerformance")}
            </legend>
            <p className="mb-2.5 font-g text-g-caption font-[510] uppercase tracking-[0.04em] text-g-ink-3">
              {t("settings.ocrGroupPerformance")}
            </p>

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrMaxPixels")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrMaxPixelsHint")}
              </span>
              <TextInput
                type="number"
                min={100000}
                step={100000}
                value={String(draft.ocrMaxPixels)}
                suffix={<span>{t("settings.ocrMaxPixelsSuffix")}</span>}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    ocrMaxPixels: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrMaxPixels")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrMaxPixelsDefault")}
              </span>
            </label>

            <div className="my-2 border-t border-g-line" role="separator" />

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrBatchSize")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrBatchSizeHint")}
              </span>
              <TextInput
                type="number"
                min={1}
                max={200}
                step={5}
                value={String(draft.ocrBatchSize)}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    ocrBatchSize: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrBatchSize")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrBatchSizeDefault")}
              </span>
            </label>

            <div className="my-2 border-t border-g-line" role="separator" />

            <label className="grid gap-1.5">
              <span className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                {t("settings.ocrConcurrency")}
              </span>
              <span className="font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                {t("settings.ocrConcurrencyHint")}
              </span>
              <TextInput
                type="number"
                min={1}
                max={2}
                value={String(draft.ocrConcurrency)}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    ocrConcurrency: Number(event.target.value),
                  }))
                }
                aria-label={t("settings.ocrConcurrency")}
              />
              <span className="font-g text-g-chip tracking-g-ui text-g-ink-3">
                {t("settings.ocrConcurrencyDefault")}
              </span>
            </label>
          </fieldset>

          <fieldset className="rounded-g-md border border-g-line bg-g-surface-2 p-3">
            <legend className="sr-only">{t("settings.ocrGroupSearch")}</legend>
            <p className="mb-2.5 font-g text-g-caption font-[510] uppercase tracking-[0.04em] text-g-ink-3">
              {t("settings.ocrGroupSearch")}
            </p>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                  {t("settings.ocrFuzzySearch")}
                </div>
                <p className="mt-1 font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
                  {t("settings.ocrFuzzySearchHint")}
                </p>
              </div>
              <Switch
                checked={draft.ocrFuzzySearch}
                onCheckedChange={(next) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    ocrFuzzySearch: next,
                  }))
                }
                aria-label={t("settings.ocrFuzzySearch")}
              />
            </div>
          </fieldset>
        </Modal>
      )}
      <ConfirmDialog
        open={runOCRConfirmOpen}
        title={t("settings.ocrRunConfirmTitle")}
        message={
          <div className="grid gap-2">
            <p>{t("settings.ocrRunConfirmIntro")}</p>
            <ul className="m-0 list-disc space-y-1 pl-4">
              <li>{t("settings.ocrRunConfirmLocal")}</li>
              <li>
                {t("settings.ocrRunConfirmBatch", {
                  batchSize: draft.ocrBatchSize,
                })}
              </li>
              <li>{t("settings.ocrRunConfirmSettings")}</li>
              <li>{t("settings.ocrRunConfirmSearch")}</li>
            </ul>
          </div>
        }
        confirmText={t("settings.ocrRunConfirmAction")}
        cancelText={t("common.cancel")}
        loading={ocrWorking}
        onConfirm={() => void onRunOCR()}
        onCancel={() => setRunOCRConfirmOpen(false)}
      />
      <ConfirmDialog
        open={removeOCRConfirmOpen}
        title={t("settings.ocrRemoveConfirmTitle")}
        message={t("settings.ocrRemoveConfirmMessage")}
        confirmText={t("settings.ocrRemoveConfirmAction")}
        cancelText={t("common.cancel")}
        variant="danger"
        loading={removeOCRPending}
        onConfirm={() => void onRemoveOCR()}
        onCancel={() => setRemoveOCRConfirmOpen(false)}
      />
    </>
  );
}

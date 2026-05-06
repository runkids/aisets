import {
  Download,
  FolderKanban,
  Globe2,
  Image,
  Info,
  Keyboard,
  Moon,
  Paintbrush,
  RotateCcw,
  Scan,
  Settings2,
  Sliders,
  Sun,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportSettings } from "../api";
import { errorMessage, supportedLanguages } from "../i18n/index";
import {
  useCatalogQuery,
  useImportSettingsMutation,
  useResetDatabaseMutation,
  useSettingsQuery,
  useUpdateSettingsMutation,
} from "../queries";
import type { ExportData, SettingsInfo, SettingsUpdate } from "../types";
import {
  Badge,
  Button,
  Card,
  Notice,
  Rail,
  RailItem,
  RailSection,
  Select,
  Switch,
  Tabs,
  Textarea,
  TextInput,
} from "./ui";

type Props = {
  theme: "light" | "dark";
  imagePreviewEnabled: boolean;
  onThemeChange: (theme: "light" | "dark") => void;
  onImagePreviewEnabledChange: (enabled: boolean) => void;
};

type Section =
  | "workspace"
  | "projects"
  | "theme"
  | "scanning"
  | "optimization"
  | "hotkeys"
  | "about";

type SettingsDraft = {
  workspaceName: string;
  defaultProjectRoot: string;
  autoScanOnOpen: boolean;
  scanOnOpen: boolean;
  excludePatternsText: string;
  optimizationDefaultQuality: number;
  optimizationAutoApply: boolean;
};

const sectionMeta: { id: Section; icon: ReactNode }[] = [
  { id: "workspace", icon: <Settings2 size={15} /> },
  { id: "projects", icon: <FolderKanban size={15} /> },
  { id: "theme", icon: <Paintbrush size={15} /> },
  { id: "scanning", icon: <Scan size={15} /> },
  { id: "optimization", icon: <Sliders size={15} /> },
  { id: "hotkeys", icon: <Keyboard size={15} /> },
  { id: "about", icon: <Info size={15} /> },
];

const defaultSettings: SettingsUpdate = {
  workspaceName: "Asset Studio",
  defaultProjectRoot: "/workspace",
  autoScanOnOpen: false,
  scanOnOpen: false,
  excludePatterns: [],
  optimizationDefaultQuality: 80,
  optimizationAutoApply: false,
};

function draftFromSettings(settings?: SettingsInfo): SettingsDraft {
  return {
    workspaceName:
      settings?.workspaceName ?? defaultSettings.workspaceName ?? "",
    defaultProjectRoot:
      settings?.defaultProjectRoot ?? defaultSettings.defaultProjectRoot ?? "",
    autoScanOnOpen: settings?.autoScanOnOpen ?? false,
    scanOnOpen: settings?.scanOnOpen ?? false,
    excludePatternsText: (settings?.excludePatterns ?? []).join("\n"),
    optimizationDefaultQuality: settings?.optimizationDefaultQuality ?? 80,
    optimizationAutoApply: settings?.optimizationAutoApply ?? false,
  };
}

function updateFromDraft(draft: SettingsDraft): SettingsUpdate {
  return {
    workspaceName: draft.workspaceName,
    defaultProjectRoot: draft.defaultProjectRoot,
    autoScanOnOpen: draft.autoScanOnOpen,
    scanOnOpen: draft.scanOnOpen,
    excludePatterns: draft.excludePatternsText
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean),
    optimizationDefaultQuality: draft.optimizationDefaultQuality,
    optimizationAutoApply: draft.optimizationAutoApply,
  };
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8">
      <div className="min-w-0">
        <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
          {label}
        </span>
        {description && (
          <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 justify-start md:min-w-[280px] md:justify-end">
        {children}
      </div>
    </div>
  );
}

function SectionHeading(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  void props;
  return null;
}

function sectionIcon(id: Section) {
  return sectionMeta.find((section) => section.id === id)?.icon;
}

function PathRow({ label, value }: { label: string; value?: string }) {
  return (
    <FieldRow label={label}>
      <code className="max-w-full truncate rounded-g-pill bg-g-surface-2 px-3 py-1 font-g-mono text-g-chip tracking-g-mono text-g-ink-2">
        {value ?? "..."}
      </code>
    </FieldRow>
  );
}

function SettingsActions({
  disabled,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
}: {
  disabled: boolean;
  onSave: () => void;
  onReset: () => void;
  saveLabel: string;
  resetLabel: string;
}) {
  return (
    <div className="flex gap-2 py-4">
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        {saveLabel}
      </Button>
      <Button variant="ghost" onClick={onReset} disabled={disabled}>
        {resetLabel}
      </Button>
    </div>
  );
}

export function SettingsView({
  theme,
  imagePreviewEnabled,
  onThemeChange,
  onImagePreviewEnabledChange,
}: Props) {
  const { i18n, t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>("workspace");
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const settingsQuery = useSettingsQuery();
  const catalogQuery = useCatalogQuery();
  const importMutation = useImportSettingsMutation();
  const resetMutation = useResetDatabaseMutation();
  const updateMutation = useUpdateSettingsMutation();

  const settings = settingsQuery.data?.settings;
  const draft = draftOverride ?? draftFromSettings(settings);
  const projects = catalogQuery.data?.projects ?? [];
  const items = catalogQuery.data?.items ?? [];
  const working =
    importMutation.isPending ||
    resetMutation.isPending ||
    updateMutation.isPending;
  const settingsActionDisabled = settingsQuery.isLoading || working;

  const assetCountByProject: Record<string, number> = {};
  for (const item of items) {
    assetCountByProject[item.projectId] =
      (assetCountByProject[item.projectId] ?? 0) + 1;
  }

  function updateDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    setDraftOverride((current) =>
      updater(current ?? draftFromSettings(settingsQuery.data?.settings)),
    );
  }

  async function onSaveSettings() {
    const result = await updateMutation.mutateAsync(updateFromDraft(draft));
    setDraftOverride(draftFromSettings(result.settings));
  }

  async function onResetSettings() {
    const result = await updateMutation.mutateAsync(defaultSettings);
    setDraftOverride(draftFromSettings(result.settings));
  }

  async function onExport() {
    const data = await exportSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asset-studio-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File) {
    const text = await file.text();
    const data = JSON.parse(text) as ExportData;
    await importMutation.mutateAsync(data);
    setDraftOverride(null);
  }

  async function onReset() {
    const confirmed = window.confirm(t("settings.resetConfirm"));
    if (!confirmed) return;
    await resetMutation.mutateAsync();
  }

  const settingActions = (
    <SettingsActions
      disabled={settingsActionDisabled}
      onSave={() => void onSaveSettings()}
      onReset={() => void onResetSettings()}
      saveLabel={t("settings.save")}
      resetLabel={t("settings.reset")}
    />
  );

  return (
    <>
      <Rail as="nav" variant="settings" aria-label={t("mode.settings")}>
        <RailSection>
          {sectionMeta.map(({ id, icon }) => (
            <RailItem
              key={id}
              variant="settings"
              active={activeSection === id}
              icon={icon}
              label={t(`settings.section.${id}`)}
              onClick={() => setActiveSection(id)}
            />
          ))}
        </RailSection>
      </Rail>

      <div className="content-scroll settings-content-scroll">
        <div className="content-grid settings-content-grid">
          {activeSection === "workspace" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.workspace")}
                description={t("settings.workspaceDesc")}
                icon={sectionIcon("workspace")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.workspaceName")}
                  icon={<Settings2 size={15} />}
                >
                  <TextInput
                    type="text"
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    value={draft.workspaceName}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        workspaceName: event.target.value,
                      }))
                    }
                    placeholder="Asset Studio"
                    className="w-full md:w-80"
                    inputClassName="font-g tracking-g-ui"
                  />
                </FieldRow>
                <FieldRow
                  label={t("settings.defaultRoot")}
                  description={t("settings.defaultRootHint")}
                  icon={<FolderKanban size={15} />}
                >
                  <TextInput
                    type="text"
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    value={draft.defaultProjectRoot}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        defaultProjectRoot: event.target.value,
                      }))
                    }
                    placeholder="/workspace"
                    className="w-full md:w-80"
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "projects" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.projects")}
                description={t("settings.projectsDesc")}
                icon={sectionIcon("projects")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                {projects.length === 0 ? (
                  <p className="py-4 font-g text-g-ui text-g-ink-3">
                    {t("settings.noProjects")}
                  </p>
                ) : (
                  projects.map((project) => (
                    <FieldRow
                      key={project.id}
                      label={project.name}
                      description={project.path}
                    >
                      <Badge tone="line">
                        {t("settings.projectAssets", {
                          count: assetCountByProject[project.id] ?? 0,
                        })}
                      </Badge>
                    </FieldRow>
                  ))
                )}
              </div>
            </Card>
          )}

          {activeSection === "theme" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.theme")}
                description={t("settings.appearanceDesc")}
                icon={sectionIcon("theme")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.language")}
                  icon={<Globe2 size={15} />}
                >
                  <Select
                    value={i18n.language}
                    options={supportedLanguages.map((lang) => ({
                      value: lang.code,
                      label: lang.label,
                    }))}
                    onChange={(value) => i18n.changeLanguage(value)}
                    aria-label={t("settings.language")}
                  />
                </FieldRow>
                <FieldRow
                  label={t("settings.theme")}
                  icon={<Paintbrush size={15} />}
                >
                  <Tabs
                    value={theme}
                    items={[
                      {
                        value: "light",
                        label: t("settings.light"),
                        icon: <Sun size={15} />,
                      },
                      {
                        value: "dark",
                        label: t("settings.dark"),
                        icon: <Moon size={15} />,
                      },
                    ]}
                    onChange={onThemeChange}
                    ariaLabel={t("settings.theme")}
                  />
                </FieldRow>
                <FieldRow
                  label={t("settings.imagePreview")}
                  description={t("settings.imagePreviewHint")}
                  icon={<Image size={15} />}
                >
                  <Switch
                    checked={imagePreviewEnabled}
                    onCheckedChange={onImagePreviewEnabledChange}
                    aria-label={t("settings.imagePreview")}
                  />
                </FieldRow>
              </div>
            </Card>
          )}

          {activeSection === "scanning" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.scanning")}
                description={t("settings.scanningDesc")}
                icon={sectionIcon("scanning")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.scanOnOpen")}
                  description={t("settings.scanOnOpenHint")}
                  icon={<Scan size={15} />}
                >
                  <Switch
                    checked={draft.scanOnOpen}
                    onCheckedChange={(next) =>
                      updateDraft((prev) => ({ ...prev, scanOnOpen: next }))
                    }
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    aria-label={t("settings.scanOnOpen")}
                  />
                </FieldRow>
                <FieldRow
                  label={t("settings.excludePatterns")}
                  description={t("settings.excludePatternsHint")}
                  icon={<Sliders size={15} />}
                >
                  <Textarea
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    value={draft.excludePatternsText}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        excludePatternsText: event.target.value,
                      }))
                    }
                    placeholder={"node_modules\n.git\ndist/**"}
                    className="w-full md:w-80"
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "optimization" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.optimization")}
                description={t("settings.optimizationDesc")}
                icon={sectionIcon("optimization")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.defaultQuality")}
                  description={t("settings.defaultQualityHint")}
                  icon={<Sliders size={15} />}
                >
                  <div className="flex w-full items-center justify-start gap-3 md:justify-end">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.optimizationDefaultQuality}
                      disabled={
                        settingsQuery.isLoading || updateMutation.isPending
                      }
                      onChange={(event) =>
                        updateDraft((prev) => ({
                          ...prev,
                          optimizationDefaultQuality: Number(
                            event.target.value,
                          ),
                        }))
                      }
                      className="w-56 rounded-g-sm accent-g-active-bg focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
                      aria-label={t("settings.defaultQuality")}
                    />
                    <Badge tone="line">
                      {draft.optimizationDefaultQuality}
                    </Badge>
                  </div>
                </FieldRow>
                <FieldRow
                  label={t("settings.autoApply")}
                  description={t("settings.autoApplyHint")}
                  icon={<Sliders size={15} />}
                >
                  <Switch
                    checked={draft.optimizationAutoApply}
                    onCheckedChange={(next) =>
                      updateDraft((prev) => ({
                        ...prev,
                        optimizationAutoApply: next,
                      }))
                    }
                    disabled={
                      settingsQuery.isLoading || updateMutation.isPending
                    }
                    aria-label={t("settings.autoApply")}
                  />
                </FieldRow>
                {updateMutation.error && (
                  <Notice tone="danger">
                    {errorMessage(updateMutation.error)}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "hotkeys" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.hotkeys")}
                description={t("settings.hotkeysDesc")}
                icon={sectionIcon("hotkeys")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                {[
                  { keys: "⌘ K", action: t("settings.hotkeyPalette") },
                  { keys: "Esc", action: t("settings.hotkeyClose") },
                ].map(({ keys, action }) => (
                  <FieldRow key={keys} label={action}>
                    <kbd className="rounded-g-sm border border-g-line-strong bg-g-surface-2 px-2 py-0.5 font-g-mono text-g-caption text-g-ink-3">
                      {keys}
                    </kbd>
                  </FieldRow>
                ))}
              </div>
            </Card>
          )}

          {activeSection === "about" && (
            <Card className="settings-panel" padding="none">
              <SectionHeading
                title={t("settings.section.about")}
                description={t("settings.aboutDesc")}
                icon={sectionIcon("about")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.version")}
                  icon={<Info size={15} />}
                >
                  <Badge tone="default">0.1.0</Badge>
                </FieldRow>
                <FieldRow
                  label={t("settings.license")}
                  icon={<Info size={15} />}
                >
                  <span className="font-g text-g-ui text-g-ink-2">MIT</span>
                </FieldRow>
                <FieldRow label={t("settings.data")}>
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    <Button
                      variant="secondary"
                      leadingIcon={<Download size={15} />}
                      onClick={onExport}
                    >
                      {t("settings.export")}
                    </Button>
                    <Button
                      variant="secondary"
                      leadingIcon={<Upload size={15} />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={working}
                    >
                      {t("settings.import")}
                    </Button>
                    <Button
                      variant="danger"
                      leadingIcon={<RotateCcw size={15} />}
                      onClick={() => void onReset()}
                      disabled={working}
                    >
                      {t("settings.resetDatabase")}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void onImport(file);
                      }}
                    />
                  </div>
                </FieldRow>
                <PathRow
                  label={t("settings.databasePath")}
                  value={settings?.databasePath}
                />
                <PathRow
                  label={t("settings.dataDir")}
                  value={settings?.dataDir}
                />
                <PathRow
                  label={t("settings.cacheDir")}
                  value={settings?.cacheDir}
                />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

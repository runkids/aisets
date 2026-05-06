import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FolderKanban,
  Globe2,
  Image,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Paintbrush,
  Pencil,
  Plus,
  RotateCcw,
  Scan,
  Settings2,
  Sliders,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportSettings } from "../api";
import { errorMessage, languageOptionsForLocale } from "../i18n/index";
import {
  useAddWorkspaceMutation,
  useCatalogQuery,
  useDirectoryListingQuery,
  useImportSettingsMutation,
  useRemoveProjectMutation,
  useRemoveWorkspaceMutation,
  useRenameProjectMutation,
  useRenameWorkspaceMutation,
  useResetDatabaseMutation,
  useSettingsQuery,
  useSwitchWorkspaceMutation,
  useUpdateSettingsMutation,
} from "../queries";
import type { ExportData, SettingsInfo, SettingsUpdate } from "../types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Keycap,
  Notice,
  PromptDialog,
  Rail,
  RailItem,
  RailSection,
  Select,
  Switch,
  Tabs,
  Textarea,
  TextInput,
} from "./ui";

type ThemePreference = "light" | "dark" | "system";

type Props = {
  theme: ThemePreference;
  imagePreviewEnabled: boolean;
  onThemeChange: (theme: ThemePreference) => void;
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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
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
  defaultProjectRoot: "",
  autoScanOnOpen: false,
  scanOnOpen: false,
  excludePatterns: [],
  optimizationDefaultQuality: 80,
  optimizationAutoApply: false,
};

const workspaceRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 sm:pointer-events-none sm:absolute sm:right-[calc(100%+6px)] sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:rounded-g-md sm:bg-g-surface-2 sm:p-1 sm:opacity-0 sm:shadow-g-sm sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";
const projectRowActionRevealClass =
  "flex flex-wrap items-center gap-1.5 pl-3 sm:pointer-events-none sm:absolute sm:right-2 sm:top-1/2 sm:z-10 sm:-translate-y-1/2 sm:flex-nowrap sm:rounded-g-md sm:bg-g-surface-2 sm:p-1 sm:pl-1 sm:opacity-0 sm:shadow-g-sm sm:transition-opacity sm:duration-[120ms] sm:ease-g sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100";
const activeWorkspaceBadgeClass =
  "inline-flex items-center justify-center gap-2 w-[112px] h-8 px-3 border border-g-line-strong rounded-g-md bg-g-surface-2 text-g-ink-2 shadow-g-sm font-g text-[12px] font-[590] leading-none tracking-[-0.012em] [&_svg]:size-3.5 [&_svg]:text-g-green";
const switchWorkspaceButtonClass =
  "inline-flex items-center justify-center gap-2 w-[112px] h-8 px-3 border border-g-line-strong rounded-g-md bg-g-surface-2 text-g-ink shadow-g-sm font-g text-[12px] font-[590] leading-none tracking-[-0.012em] [&_svg]:size-3.5 hover:bg-g-surface-3";
const projectAssetsBadgeClass =
  "shrink-0 border-g-line bg-g-surface-2 text-g-ink-3";

function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

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
  align = "center",
  children,
}: {
  label: string;
  description?: string;
  icon?: ReactNode;
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div
      className={
        align === "start"
          ? "grid grid-cols-1 items-start gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8"
          : "grid grid-cols-1 items-center gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8"
      }
    >
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
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(
    null,
  );
  const [removeWorkspaceId, setRemoveWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [resetDatabaseOpen, setResetDatabaseOpen] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState("");
  const [installedApp, setInstalledApp] = useState(() => isStandaloneApp());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const settingsQuery = useSettingsQuery();
  const defaultDirectoryQuery = useDirectoryListingQuery(
    "",
    activeSection === "workspace",
  );
  const catalogQuery = useCatalogQuery();
  const addWorkspaceMutation = useAddWorkspaceMutation();
  const importMutation = useImportSettingsMutation();
  const removeProjectMutation = useRemoveProjectMutation();
  const removeWorkspaceMutation = useRemoveWorkspaceMutation();
  const renameProjectMutation = useRenameProjectMutation();
  const renameWorkspaceMutation = useRenameWorkspaceMutation();
  const resetMutation = useResetDatabaseMutation();
  const switchWorkspaceMutation = useSwitchWorkspaceMutation();
  const updateMutation = useUpdateSettingsMutation();

  const settings = settingsQuery.data?.settings;
  const draft = draftOverride ?? draftFromSettings(settings);
  const defaultRootPlaceholder = t("settings.defaultRootPlaceholder");
  const defaultRootCurrentPath = defaultDirectoryQuery.data?.path
    ? t("settings.defaultRootCurrentPath", {
        path: defaultDirectoryQuery.data.path,
      })
    : "";
  const workspaces = settings?.workspaces ?? [];
  const activeWorkspaceId = settings?.activeWorkspaceId ?? "default";
  const projects = catalogQuery.data?.projects ?? [];
  const settingsProjects = settings?.projects ?? projects;
  const items = catalogQuery.data?.items ?? [];
  const workspaceProjects = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      [] as typeof settingsProjects,
    ]),
  );
  for (const project of settingsProjects) {
    const group = workspaceProjects.get(project.workspaceId);
    if (group) {
      group.push(project);
    }
  }
  const workspaceBeingRenamed = workspaces.find(
    (workspace) => workspace.id === renameWorkspaceId,
  );
  const workspaceBeingRemoved = workspaces.find(
    (workspace) => workspace.id === removeWorkspaceId,
  );
  const projectBeingRenamed = settingsProjects.find(
    (project) => project.id === renameProjectId,
  );
  const projectBeingRemoved = settingsProjects.find(
    (project) => project.id === removeProjectId,
  );
  const working =
    addWorkspaceMutation.isPending ||
    importMutation.isPending ||
    removeProjectMutation.isPending ||
    removeWorkspaceMutation.isPending ||
    renameProjectMutation.isPending ||
    renameWorkspaceMutation.isPending ||
    resetMutation.isPending ||
    switchWorkspaceMutation.isPending ||
    updateMutation.isPending;
  const settingsActionDisabled = settingsQuery.isLoading || working;

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage("");
    }
    function onAppInstalled() {
      setInstalledApp(true);
      setInstallPrompt(null);
      setInstallMessage(t("settings.installInstalled"));
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [t]);

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

  function onAddWorkspace(name: string) {
    addWorkspaceMutation.mutate(name, {
      onSuccess: (result) => {
        setAddWorkspaceOpen(false);
        setDraftOverride(draftFromSettings(result.settings));
      },
    });
  }

  async function onSwitchWorkspace(workspaceId: string) {
    const result = await switchWorkspaceMutation.mutateAsync(workspaceId);
    setDraftOverride(draftFromSettings(result.settings));
  }

  function onRenameWorkspace(name: string) {
    if (!workspaceBeingRenamed) return;
    renameWorkspaceMutation.mutate(
      { id: workspaceBeingRenamed.id, name },
      {
        onSuccess: (result) => {
          setRenameWorkspaceId(null);
          setDraftOverride(draftFromSettings(result.settings));
        },
      },
    );
  }

  function onRemoveWorkspace() {
    if (!workspaceBeingRemoved) return;
    removeWorkspaceMutation.mutate(workspaceBeingRemoved.id, {
      onSuccess: (result) => {
        setRemoveWorkspaceId(null);
        setDraftOverride(draftFromSettings(result.settings));
      },
    });
  }

  function onRenameProject(name: string) {
    if (!projectBeingRenamed) return;
    renameProjectMutation.mutate(
      { id: projectBeingRenamed.id, name },
      { onSuccess: () => setRenameProjectId(null) },
    );
  }

  function onRemoveProject() {
    if (!projectBeingRemoved) return;
    removeProjectMutation.mutate(projectBeingRemoved.id, {
      onSuccess: () => setRemoveProjectId(null),
    });
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

  async function onInstallApp() {
    if (installedApp) {
      setInstallMessage(t("settings.installInstalled"));
      return;
    }
    if (!installPrompt) {
      setInstallMessage(t("settings.installManualHint"));
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallMessage(
      choice.outcome === "accepted"
        ? t("settings.installAccepted")
        : t("settings.installDismissed"),
    );
  }

  function onReset() {
    resetMutation.mutate(undefined, {
      onSuccess: () => setResetDatabaseOpen(false),
    });
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

      <div className="content-scroll">
        <div className="content-grid ml-0 mr-auto max-w-[1040px]">
          {activeSection === "workspace" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.workspace")}
                description={t("settings.workspaceDesc")}
                icon={sectionIcon("workspace")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                <FieldRow
                  label={t("settings.workspaces")}
                  description={t("settings.workspacesHint")}
                  align="start"
                >
                  <div className="flex w-full flex-col gap-2 md:w-[560px] md:items-stretch">
                    <div className="grid gap-2" role="list">
                      {workspaces.map((workspace) => {
                        const isActive = workspace.id === activeWorkspaceId;
                        const summary = t("settings.workspaceProjects", {
                          count: workspace.projectCount,
                        });

                        return (
                          <div
                            key={workspace.id}
                            role="listitem"
                            data-active={isActive || undefined}
                            className="group relative flex flex-col gap-2 rounded-g-md border border-g-line bg-g-surface px-3 py-2 shadow-g-sm transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:bg-g-surface-2 focus-within:bg-g-surface-2 data-[active=true]:border-g-line-strong data-[active=true]:bg-g-surface-2 sm:flex-row sm:items-center"
                          >
                            {isActive ? (
                              <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                <span className="grid size-8 shrink-0 place-items-center rounded-g-md bg-g-surface-3 text-g-ink-2">
                                  <FolderKanban size={15} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate font-g-display text-g-body font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                                    {workspace.name}
                                  </span>
                                  <span className="block font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                    {summary}
                                  </span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                <span className="grid size-8 shrink-0 place-items-center rounded-g-md bg-g-surface-3 text-g-ink-2">
                                  <FolderKanban size={15} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate font-g-display text-g-body font-[510] leading-[1.3] tracking-[-0.013em] text-g-ink">
                                    {workspace.name}
                                  </span>
                                  <span className="block font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                    {summary}
                                  </span>
                                </span>
                              </div>
                            )}
                            <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                              <div className={workspaceRowActionRevealClass}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  leadingIcon={<Pencil size={13} />}
                                  disabled={working}
                                  onClick={() =>
                                    setRenameWorkspaceId(workspace.id)
                                  }
                                >
                                  {t("action.rename")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  leadingIcon={<Trash2 size={13} />}
                                  disabled={working || workspaces.length <= 1}
                                  className="text-g-red hover:bg-g-red-soft hover:text-g-red"
                                  onClick={() =>
                                    setRemoveWorkspaceId(workspace.id)
                                  }
                                >
                                  {t("action.delete")}
                                </Button>
                              </div>
                              {isActive && (
                                <Badge
                                  tone="line"
                                  className={activeWorkspaceBadgeClass}
                                >
                                  <CheckCircle2 aria-hidden="true" />
                                  {t("settings.activeWorkspace")}
                                </Badge>
                              )}
                              {!isActive && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  leadingIcon={<ArrowLeftRight size={13} />}
                                  disabled={working}
                                  className={switchWorkspaceButtonClass}
                                  onClick={() =>
                                    void onSwitchWorkspace(workspace.id)
                                  }
                                >
                                  {t("settings.switchWorkspaceAction")}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Plus size={13} />}
                      disabled={working}
                      className="self-start"
                      onClick={() => setAddWorkspaceOpen(true)}
                    >
                      {t("settings.addWorkspace")}
                    </Button>
                  </div>
                </FieldRow>
                <FieldRow
                  label={t("settings.defaultRoot")}
                  description={t("settings.defaultRootHint")}
                  icon={<FolderKanban size={15} />}
                  align="start"
                >
                  <div className="flex w-full flex-col gap-1.5 md:w-[560px]">
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
                      placeholder={defaultRootPlaceholder}
                      className="w-full"
                    />
                    {defaultRootCurrentPath && (
                      <p className="break-all text-left font-g-mono text-g-caption tracking-g-mono text-g-ink-3 md:text-right">
                        {defaultRootCurrentPath}
                      </p>
                    )}
                  </div>
                </FieldRow>
                {(updateMutation.error ||
                  addWorkspaceMutation.error ||
                  renameWorkspaceMutation.error ||
                  removeWorkspaceMutation.error ||
                  switchWorkspaceMutation.error) && (
                  <Notice tone="danger">
                    {errorMessage(
                      updateMutation.error ??
                        addWorkspaceMutation.error ??
                        renameWorkspaceMutation.error ??
                        removeWorkspaceMutation.error ??
                        switchWorkspaceMutation.error,
                    )}
                  </Notice>
                )}
                {settingActions}
              </div>
            </Card>
          )}

          {activeSection === "projects" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.projects")}
                description={t("settings.projectsDesc")}
                icon={sectionIcon("projects")}
              />
              <div className="px-6 py-5 md:px-8">
                {settingsProjects.length === 0 ? (
                  <p className="font-g text-g-ui text-g-ink-3">
                    {t("settings.noProjects")}
                  </p>
                ) : (
                  <div className="space-y-5">
                    {workspaces.map((workspace) => {
                      const groupedProjects =
                        workspaceProjects.get(workspace.id) ?? [];
                      const isActive = workspace.id === activeWorkspaceId;

                      return (
                        <section key={workspace.id} className="space-y-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid size-8 shrink-0 place-items-center rounded-g-md bg-g-surface-3 text-g-ink-2">
                                <FolderKanban size={15} />
                              </span>
                              <div className="min-w-0">
                                <h3 className="truncate font-g-display text-g-body font-[590] leading-[1.3] tracking-[-0.013em] text-g-ink">
                                  {workspace.name}
                                </h3>
                                <p className="font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                  {t("settings.workspaceProjects", {
                                    count: groupedProjects.length,
                                  })}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                              {isActive ? (
                                <Badge
                                  tone="line"
                                  className={activeWorkspaceBadgeClass}
                                >
                                  <CheckCircle2 aria-hidden="true" />
                                  {t("settings.activeWorkspace")}
                                </Badge>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  leadingIcon={<ArrowLeftRight size={13} />}
                                  disabled={working}
                                  className={switchWorkspaceButtonClass}
                                  onClick={() =>
                                    void onSwitchWorkspace(workspace.id)
                                  }
                                >
                                  {t("settings.switchWorkspaceAction")}
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="ml-4 grid gap-1.5 border-l border-g-line pl-4 sm:ml-10">
                            {groupedProjects.length === 0 ? (
                              <p className="py-2 font-g text-g-ui text-g-ink-3">
                                {t("settings.noProjectsInWorkspace")}
                              </p>
                            ) : (
                              groupedProjects.map((project) => (
                                <div
                                  key={project.id}
                                  className="group relative flex flex-col gap-2 rounded-g-md px-2 py-2 transition-[background] duration-[120ms] ease-g hover:bg-g-surface-2 focus-within:bg-g-surface-2 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex min-w-0 items-start gap-2">
                                    <span className="mt-2 size-1.5 shrink-0 rounded-g-pill bg-g-line-strong" />
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <div className="min-w-0 truncate font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
                                          {project.name}
                                        </div>
                                        {project.workspaceId ===
                                          activeWorkspaceId && (
                                          <Badge
                                            tone="line"
                                            className={projectAssetsBadgeClass}
                                          >
                                            {t("settings.projectAssets", {
                                              count:
                                                assetCountByProject[
                                                  project.id
                                                ] ?? 0,
                                            })}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="truncate font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                                        {project.path}
                                      </div>
                                    </div>
                                  </div>
                                  <div className={projectRowActionRevealClass}>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      leadingIcon={<Pencil size={13} />}
                                      disabled={working}
                                      onClick={() =>
                                        setRenameProjectId(project.id)
                                      }
                                    >
                                      {t("action.rename")}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      leadingIcon={<Trash2 size={13} />}
                                      disabled={working}
                                      className="text-g-red hover:bg-g-red-soft hover:text-g-red"
                                      onClick={() =>
                                        setRemoveProjectId(project.id)
                                      }
                                    >
                                      {t("action.delete")}
                                    </Button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
                {(renameProjectMutation.error ||
                  removeProjectMutation.error) && (
                  <Notice tone="danger" className="mt-4">
                    {errorMessage(
                      renameProjectMutation.error ??
                        removeProjectMutation.error,
                    )}
                  </Notice>
                )}
              </div>
            </Card>
          )}

          {activeSection === "theme" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
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
                    options={languageOptionsForLocale().map((lang) => ({
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
                      {
                        value: "system",
                        label: t("settings.system"),
                        icon: <Monitor size={15} />,
                      },
                    ]}
                    onChange={onThemeChange}
                    ariaLabel={t("settings.theme")}
                    className="w-full min-w-[280px] max-w-full [&_[role=tab]]:min-w-0 [&_[role=tab]]:flex-1"
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
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
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
                  align="start"
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
                    rows={6}
                    className="w-full md:w-[420px]"
                    textareaClassName="min-h-36 resize-y"
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
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
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
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
              <SectionHeading
                title={t("settings.section.hotkeys")}
                description={t("settings.hotkeysDesc")}
                icon={sectionIcon("hotkeys")}
              />
              <div className="divide-y divide-g-line px-6 py-2 md:px-8 md:py-3">
                {[
                  { keys: "⌘ P", action: t("settings.hotkeyPalette") },
                  { keys: "Esc", action: t("settings.hotkeyClose") },
                ].map(({ keys, action }) => (
                  <FieldRow key={keys} label={action}>
                    <Keycap>{keys}</Keycap>
                  </FieldRow>
                ))}
              </div>
            </Card>
          )}

          {activeSection === "about" && (
            <Card
              className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
              padding="none"
            >
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
                <FieldRow
                  label={t("settings.installApp")}
                  description={t("settings.installAppHint")}
                  align="start"
                >
                  <div className="flex w-full flex-col items-start gap-2 md:w-[420px] md:items-end">
                    <Button
                      variant="secondary"
                      leadingIcon={<Download size={15} />}
                      onClick={() => void onInstallApp()}
                      disabled={installedApp}
                    >
                      {installedApp
                        ? t("settings.installInstalledAction")
                        : t("settings.installAppAction")}
                    </Button>
                    {installMessage && (
                      <Notice tone={installedApp ? "success" : "info"}>
                        {installMessage}
                      </Notice>
                    )}
                  </div>
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
                      onClick={() => setResetDatabaseOpen(true)}
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
      <PromptDialog
        open={addWorkspaceOpen}
        title={t("settings.addWorkspace")}
        label={t("settings.workspaceName")}
        placeholder={t("settings.addWorkspacePrompt")}
        confirmText={t("settings.addWorkspace")}
        cancelText={t("common.cancel")}
        loading={addWorkspaceMutation.isPending}
        onConfirm={onAddWorkspace}
        onCancel={() => setAddWorkspaceOpen(false)}
      />
      <PromptDialog
        open={Boolean(workspaceBeingRenamed)}
        title={t("settings.renameWorkspace")}
        label={t("settings.workspaceName")}
        placeholder={t("settings.renameWorkspacePrompt")}
        defaultValue={workspaceBeingRenamed?.name ?? ""}
        confirmText={t("action.rename")}
        cancelText={t("common.cancel")}
        loading={renameWorkspaceMutation.isPending}
        onConfirm={onRenameWorkspace}
        onCancel={() => setRenameWorkspaceId(null)}
      />
      <ConfirmDialog
        open={Boolean(workspaceBeingRemoved)}
        variant="danger"
        title={t("settings.removeWorkspace")}
        message={t("settings.removeWorkspaceConfirm", {
          name: workspaceBeingRemoved?.name ?? "",
        })}
        confirmText={t("action.delete")}
        cancelText={t("common.cancel")}
        loading={removeWorkspaceMutation.isPending}
        onConfirm={onRemoveWorkspace}
        onCancel={() => setRemoveWorkspaceId(null)}
      />
      <PromptDialog
        open={Boolean(projectBeingRenamed)}
        title={t("projects.renameDialogTitle")}
        label={t("projects.renameLabel")}
        defaultValue={projectBeingRenamed?.name ?? ""}
        confirmText={t("projects.renameDialogConfirm")}
        cancelText={t("common.cancel")}
        loading={renameProjectMutation.isPending}
        onConfirm={onRenameProject}
        onCancel={() => setRenameProjectId(null)}
      />
      <ConfirmDialog
        open={Boolean(projectBeingRemoved)}
        variant="danger"
        title={t("projects.removeDialogTitle")}
        message={t("projects.removeConfirm", {
          name: projectBeingRemoved?.name ?? "",
        })}
        confirmText={t("projects.removeDialogConfirm")}
        cancelText={t("common.cancel")}
        loading={removeProjectMutation.isPending}
        onConfirm={onRemoveProject}
        onCancel={() => setRemoveProjectId(null)}
      />
      <ConfirmDialog
        open={resetDatabaseOpen}
        variant="danger"
        title={t("settings.resetDatabase")}
        message={t("settings.resetConfirm")}
        confirmText={t("settings.resetDatabase")}
        cancelText={t("common.cancel")}
        loading={resetMutation.isPending}
        onConfirm={onReset}
        onCancel={() => setResetDatabaseOpen(false)}
      />
    </>
  );
}

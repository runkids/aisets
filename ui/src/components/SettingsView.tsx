import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportSettings } from "../api";
import { errorMessage } from "../i18n/index";
import {
  useCatalogQuery,
  useAddWorkspaceMutation,
  useImportSettingsMutation,
  useInstallOCRMutation,
  useRemoveProjectMutation,
  useRemoveOCRMutation,
  useRemoveWorkspaceMutation,
  useRenameProjectMutation,
  useRenameWorkspaceMutation,
  useResetDatabaseMutation,
  useRunOCRMutation,
  useSettingsQuery,
  useSwitchWorkspaceMutation,
  useUpdateAppMutation,
  useUpdateSettingsMutation,
  useVersionQuery,
  useDirectoryListingQuery,
} from "../queries";
import type { ExportData } from "../types";
import { Rail, RailItem, RailSection } from "./ui";
import { useToast } from "./ToastProvider";
import type {
  SettingsViewProps,
  Section,
  SettingsDraft,
} from "./settings/types";
import { sectionMeta, defaultSettings } from "./settings/constants";
import {
  draftFromSettings,
  updateFromDraft,
  ocrProgressLabel,
} from "./settings/helpers";
import { SettingsActions } from "./settings/FieldRow";
import { WorkspaceSection } from "./settings/WorkspaceSection";
import { ProjectsSection } from "./settings/ProjectsSection";
import { ThemeSection } from "./settings/ThemeSection";
import { ScanningSection } from "./settings/ScanningSection";
import { CustomFiltersSection } from "./settings/CustomFiltersSection";
import { OptimizationSection } from "./settings/OptimizationSection";
import { AboutSection } from "./settings/AboutSection";
import { HotkeysSection } from "./settings/HotkeysSection";

export function SettingsView({
  theme,
  imagePreviewEnabled,
  imageBackgroundMode,
  onThemeChange,
  onImagePreviewEnabledChange,
  onImageBackgroundModeChange,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [activeSection, setActiveSection] = useState<Section>("workspace");
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(
    null,
  );
  const ocrRunBatchRef = useRef(0);
  const ocrRunAbortRef = useRef<AbortController | null>(null);
  const [ocrProgress, setOCRProgress] = useState("");
  const [ocrRunStopping, setOCRRunStopping] = useState(false);
  const [ocrRunActive, setOCRRunActive] = useState(false);

  const settingsQuery = useSettingsQuery();
  const defaultDirectoryQuery = useDirectoryListingQuery(
    "",
    activeSection === "workspace",
  );
  const catalogQuery = useCatalogQuery();
  const versionQuery = useVersionQuery();
  const addWorkspaceMutation = useAddWorkspaceMutation();
  const importMutation = useImportSettingsMutation();
  const installOCRMutation = useInstallOCRMutation();
  const removeProjectMutation = useRemoveProjectMutation();
  const removeOCRMutation = useRemoveOCRMutation();
  const removeWorkspaceMutation = useRemoveWorkspaceMutation();
  const renameProjectMutation = useRenameProjectMutation();
  const renameWorkspaceMutation = useRenameWorkspaceMutation();
  const resetMutation = useResetDatabaseMutation();
  const runOCRMutation = useRunOCRMutation({
    onEvent: (event) => {
      if ("counts" in event && event.counts) {
        setOCRProgress(
          t("settings.ocrBatchProgress", {
            batch: Math.max(ocrRunBatchRef.current, 1),
            progress: ocrProgressLabel(event.counts, t),
          }),
        );
      }
    },
  });
  const switchWorkspaceMutation = useSwitchWorkspaceMutation();
  const updateAppMutation = useUpdateAppMutation();
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
  const working =
    addWorkspaceMutation.isPending ||
    importMutation.isPending ||
    installOCRMutation.isPending ||
    removeProjectMutation.isPending ||
    removeOCRMutation.isPending ||
    removeWorkspaceMutation.isPending ||
    renameProjectMutation.isPending ||
    renameWorkspaceMutation.isPending ||
    resetMutation.isPending ||
    switchWorkspaceMutation.isPending ||
    updateAppMutation.isPending ||
    updateMutation.isPending;
  const ocrWorking = ocrRunActive || runOCRMutation.isPending;
  const settingsActionDisabled =
    settingsQuery.isLoading || working || ocrWorking;
  const ocrLanguagePacks = settings?.ocrRuntime.availableLanguages ?? [];
  const installedOCRLanguages = new Set(
    ocrLanguagePacks
      .filter((pack) => pack.installed)
      .map((pack) => pack.language),
  );
  const selectedOCRLanguageList = draft.ocrLanguages;
  const hasSelectedOCRLanguages = selectedOCRLanguageList.length > 0;
  const hasUninstalledSelectedOCRLanguages = selectedOCRLanguageList.some(
    (language) => !installedOCRLanguages.has(language),
  );
  const missingSelectedOCRLanguages = selectedOCRLanguageList.filter(
    (language) => !installedOCRLanguages.has(language),
  );
  const selectedOCRLanguagesInstalled =
    hasSelectedOCRLanguages && missingSelectedOCRLanguages.length === 0;

  const assetCountByProject: Record<string, number> = {};
  for (const stat of catalogQuery.data?.projectStats ?? []) {
    assetCountByProject[stat.projectId] = stat.totalFiles;
  }

  function updateDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    setDraftOverride((current) =>
      updater(current ?? draftFromSettings(settingsQuery.data?.settings)),
    );
  }

  async function onSaveSettings() {
    try {
      const result = await updateMutation.mutateAsync(updateFromDraft(draft));
      setDraftOverride(draftFromSettings(result.settings));
      toast.success(t("toast.settingsSaved"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("toast.settingsSaveFailed"),
      });
    }
  }

  async function onInstallOCR() {
    try {
      await installOCRMutation.mutateAsync(selectedOCRLanguageList);
      toast.success(t("settings.ocrInstallSuccess"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.ocrInstallFailed"),
      });
    }
  }

  async function onRemoveOCR() {
    try {
      await removeOCRMutation.mutateAsync(undefined);
      setOCRProgress("");
      toast.success(t("settings.ocrRemoveSuccess"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.ocrRemoveFailed"),
      });
    }
  }

  async function onRunOCRConfirmed() {
    try {
      setOCRRunActive(true);
      setOCRRunStopping(false);
      setOCRProgress("");
      ocrRunBatchRef.current = 0;
      await updateMutation.mutateAsync(updateFromDraft(draft));
      for (;;) {
        const controller = new AbortController();
        ocrRunAbortRef.current = controller;
        ocrRunBatchRef.current += 1;
        const result = await runOCRMutation.mutateAsync(controller.signal);
        if (!result?.hasMore || controller.signal.aborted) {
          break;
        }
      }
      toast.success(t("settings.ocrRunSuccess"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info(t("settings.ocrRunStopped"));
        return;
      }
      toast.error(errorMessage(error), {
        title: t("settings.ocrRunFailed"),
      });
    } finally {
      ocrRunAbortRef.current = null;
      setOCRRunActive(false);
      setOCRRunStopping(false);
    }
  }

  function onStopOCR() {
    setOCRRunStopping(true);
    ocrRunAbortRef.current?.abort();
  }

  async function onSwitchWorkspace(workspaceId: string) {
    const result = await switchWorkspaceMutation.mutateAsync(workspaceId);
    setDraftOverride(draftFromSettings(result.settings));
  }

  function onAddWorkspace(value: { name: string; iconImage: string }) {
    addWorkspaceMutation.mutate(value, {
      onSuccess: (result) => {
        setDraftOverride(draftFromSettings(result.settings));
      },
    });
  }

  function onRenameWorkspace(
    workspaceId: string,
    value: { name: string; iconImage: string },
  ) {
    renameWorkspaceMutation.mutate(
      { id: workspaceId, ...value },
      {
        onSuccess: (result) => {
          setDraftOverride(draftFromSettings(result.settings));
          toast.success(
            t("settings.updateWorkspaceSuccess", { name: value.name }),
          );
        },
      },
    );
  }

  function onRemoveWorkspace(workspaceId: string) {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    removeWorkspaceMutation.mutate(workspaceId, {
      onSuccess: (result) => {
        setDraftOverride(draftFromSettings(result.settings));
        toast.success(
          t("settings.removeWorkspaceSuccess", {
            name: workspace?.name ?? "",
          }),
        );
      },
    });
  }

  function onRenameProject(
    projectId: string,
    value: { name: string; iconImage: string },
  ) {
    renameProjectMutation.mutate(
      { id: projectId, name: value.name, iconImage: value.iconImage },
      {
        onSuccess: () => {
          toast.success(t("projects.renameSuccess", { name: value.name }));
        },
      },
    );
  }

  function onRemoveProject(projectId: string) {
    const project = settingsProjects.find((p) => p.id === projectId);
    removeProjectMutation.mutate(projectId, {
      onSuccess: () => {
        toast.success(
          t("projects.removeSuccess", { name: project?.name ?? "" }),
        );
      },
    });
  }

  async function onResetAllSettings() {
    const result = await updateMutation.mutateAsync(defaultSettings);
    setDraftOverride(draftFromSettings(result.settings));
    await removeOCRMutation.mutateAsync(undefined).catch(() => {});
    setOCRProgress("");
    toast.success(t("toast.settingsReset"));
  }

  function onResetSectionDraft(section: Section) {
    const serverDraft = draftFromSettings(settingsQuery.data?.settings);
    updateDraft((current) => {
      switch (section) {
        case "workspace":
          return {
            ...current,
            workspaceName: serverDraft.workspaceName,
            defaultProjectRoot: serverDraft.defaultProjectRoot,
          };
        case "scanning":
          return {
            ...current,
            autoScanOnOpen: serverDraft.autoScanOnOpen,
            scanOnOpen: serverDraft.scanOnOpen,
            scanProfile: serverDraft.scanProfile,
            scanAnalyses: serverDraft.scanAnalyses,
            ocrEnabled: serverDraft.ocrEnabled,
            ocrLanguages: serverDraft.ocrLanguages,
            ocrMaxPixels: serverDraft.ocrMaxPixels,
            ocrBatchSize: serverDraft.ocrBatchSize,
            ocrConcurrency: serverDraft.ocrConcurrency,
            ocrFuzzySearch: serverDraft.ocrFuzzySearch,
            excludePatternsText: serverDraft.excludePatternsText,
          };
        case "customFilters":
          return {
            ...current,
            customAssetFilters: serverDraft.customAssetFilters,
          };
        case "optimization":
          return {
            ...current,
            optimizationDefaultQuality: serverDraft.optimizationDefaultQuality,
            optimizationAutoApply: serverDraft.optimizationAutoApply,
            optimizationThresholds: serverDraft.optimizationThresholds,
          };
        default:
          return serverDraft;
      }
    });
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

  async function onUpdateApp() {
    try {
      const result = await updateAppMutation.mutateAsync();
      if (result.update.devMode) {
        toast.success(t("settings.updateDevSuccess"));
        return;
      }
      if (result.update.updated) {
        toast.success(
          t("settings.updateSuccess", {
            version: result.update.latestVersion ?? "",
          }),
        );
        return;
      }
      toast.info(t("settings.updateAlreadyCurrent"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.updateFailed"),
      });
    }
  }

  function onResetDatabase() {
    resetMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("toast.databaseReset"));
      },
      onError: (error) => {
        toast.error(errorMessage(error), {
          title: t("toast.databaseResetFailed"),
        });
      },
    });
  }

  function settingActionsFor(section: Section) {
    return (
      <SettingsActions
        disabled={settingsActionDisabled}
        onSave={() => void onSaveSettings()}
        onReset={() => onResetSectionDraft(section)}
        saveLabel={t("settings.save")}
        resetLabel={t("settings.reset")}
      />
    );
  }

  return (
    <>
      <Rail
        as="nav"
        variant="settings"
        className="ml-3 px-0"
        aria-label={t("mode.settings")}
      >
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

      <div className="flex-1 overflow-y-auto overflow-x-hidden mt-3 px-3 pb-12 max-[768px]:mt-3 max-[768px]:px-3 max-[768px]:pb-8">
        <div className="flex flex-col gap-6 ml-0 mr-auto max-w-[1040px] w-full">
          {activeSection === "workspace" && (
            <WorkspaceSection
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              draft={draft}
              defaultRootPlaceholder={defaultRootPlaceholder}
              defaultRootCurrentPath={defaultRootCurrentPath}
              working={working}
              settingActions={settingActionsFor("workspace")}
              onUpdateDraft={updateDraft}
              onAddWorkspace={onAddWorkspace}
              onRenameWorkspace={onRenameWorkspace}
              onRemoveWorkspace={onRemoveWorkspace}
              onSwitchWorkspace={onSwitchWorkspace}
              addWorkspacePending={addWorkspaceMutation.isPending}
              renameWorkspacePending={renameWorkspaceMutation.isPending}
              removeWorkspacePending={removeWorkspaceMutation.isPending}
            />
          )}

          {activeSection === "projects" && (
            <ProjectsSection
              projects={settingsProjects}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              workspaceProjects={workspaceProjects}
              assetCountByProject={assetCountByProject}
              working={working}
              onRenameProject={onRenameProject}
              onRemoveProject={onRemoveProject}
              onSwitchWorkspace={onSwitchWorkspace}
            />
          )}

          {activeSection === "theme" && (
            <ThemeSection
              theme={theme}
              imagePreviewEnabled={imagePreviewEnabled}
              imageBackgroundMode={imageBackgroundMode}
              preferredEditor={settings?.preferredEditor}
              onThemeChange={onThemeChange}
              onImagePreviewEnabledChange={onImagePreviewEnabledChange}
              onImageBackgroundModeChange={onImageBackgroundModeChange}
              onEditorChange={(editor) =>
                updateMutation.mutate({ preferredEditor: editor })
              }
            />
          )}

          {activeSection === "scanning" && (
            <ScanningSection
              draft={draft}
              settingsLoading={settingsQuery.isLoading}
              working={working}
              ocrWorking={ocrWorking}
              ocrRunStopping={ocrRunStopping}
              ocrRunActive={ocrRunActive}
              ocrProgress={ocrProgress}
              ocrLanguagePacks={ocrLanguagePacks}
              hasSelectedOCRLanguages={hasSelectedOCRLanguages}
              hasUninstalledSelectedOCRLanguages={
                hasUninstalledSelectedOCRLanguages
              }
              selectedOCRLanguagesInstalled={selectedOCRLanguagesInstalled}
              missingSelectedOCRLanguages={missingSelectedOCRLanguages}
              ocrRuntimeInstalled={settings?.ocrRuntime.installed ?? false}
              ocrRuntimeEngineAvailable={
                settings?.ocrRuntime.engineAvailable ?? false
              }
              ocrRuntimeEngineError={settings?.ocrRuntime.engineError ?? ""}
              updatePending={updateMutation.isPending}
              updateError={updateMutation.error}
              settingActions={settingActionsFor("scanning")}
              onUpdateDraft={updateDraft}
              onInstallOCR={onInstallOCR}
              onRemoveOCR={onRemoveOCR}
              onRunOCR={onRunOCRConfirmed}
              onStopOCR={onStopOCR}
              installOCRPending={installOCRMutation.isPending}
              removeOCRPending={removeOCRMutation.isPending}
            />
          )}

          {activeSection === "customFilters" && (
            <CustomFiltersSection
              draft={draft}
              working={working}
              updateError={updateMutation.error}
              settingActions={settingActionsFor("customFilters")}
              onUpdateDraft={updateDraft}
            />
          )}

          {activeSection === "optimization" && (
            <OptimizationSection
              draft={draft}
              settingsLoading={settingsQuery.isLoading}
              updatePending={updateMutation.isPending}
              updateError={updateMutation.error}
              settingActions={settingActionsFor("optimization")}
              onUpdateDraft={updateDraft}
            />
          )}

          {activeSection === "hotkeys" && <HotkeysSection />}

          {activeSection === "about" && (
            <AboutSection
              settings={settings}
              version={versionQuery.data}
              working={working}
              onExport={onExport}
              onImport={onImport}
              onResetSettings={onResetAllSettings}
              onResetDatabase={onResetDatabase}
              onUpdateApp={onUpdateApp}
              updateAppPending={updateAppMutation.isPending}
              resetPending={resetMutation.isPending}
              importPending={importMutation.isPending}
            />
          )}
        </div>
      </div>
    </>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { exportSettings } from "../api";
import { errorMessage } from "../i18n/index";
import { isOCRActivityBusy } from "../ocrActivity";
import {
  useCatalogQuery,
  useAddWorkspaceMutation,
  useClearAITagCacheMutation,
  useClearOCRCacheMutation,
  useClearScanHistoryMutation,
  useImportSettingsMutation,
  useInstallOCRMutation,
  useRemoveProjectMutation,
  useRemoveOCRMutation,
  useRemoveWorkspaceMutation,
  useRenameProjectMutation,
  useRenameWorkspaceMutation,
  useResetDatabaseMutation,
  useSettingsQuery,
  useSwitchWorkspaceMutation,
  useUpdateAppMutation,
  useUpdateSettingsMutation,
  useVersionQuery,
  useDirectoryListingQuery,
} from "../queries";
import type { ExportData, ProjectScanIntent } from "../types";
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
  resetSectionDraft,
} from "./settings/helpers";
import { SettingsActions } from "./settings/FieldRow";
import { WorkspaceSection } from "./settings/WorkspaceSection";
import { ProjectsSection } from "./settings/ProjectsSection";
import { ThemeSection } from "./settings/ThemeSection";
import { ScanningSection } from "./settings/ScanningSection";
import { CustomFiltersSection } from "./settings/CustomFiltersSection";
import { OptimizationSection } from "./settings/OptimizationSection";
import { AboutSection } from "./settings/AboutSection";
import { AISection } from "./settings/AISection";
import { HotkeysSection } from "./settings/HotkeysSection";

export function SettingsView({
  theme,
  imagePreviewEnabled,
  imageBackgroundMode,
  ocrActivity,
  aiTagActivity,
  vlmOcrActivity,
  scanWorking = false,
  onThemeChange,
  onImagePreviewEnabledChange,
  onImageBackgroundModeChange,
  onStartOCR,
  onStopOCR,
  onDismissOCR,
  onStartAITag,
  onStopAITag,
  onDismissAITag,
  onStartVLMOcr,
  onStopVLMOcr,
  onDismissVLMOcr,
  onAddProject,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = sectionFromParam(searchParams.get("section"));
  const [localSection, setLocalSection] = useState<Section>("workspace");
  const activeSection = requestedSection ?? localSection;
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(
    null,
  );
  const ocrWorking = isOCRActivityBusy(ocrActivity);

  const settingsQuery = useSettingsQuery();
  const defaultDirectoryQuery = useDirectoryListingQuery(
    "",
    activeSection === "workspace",
  );
  const catalogQuery = useCatalogQuery();
  const versionQuery = useVersionQuery();
  const addWorkspaceMutation = useAddWorkspaceMutation();
  const clearScanHistoryMutation = useClearScanHistoryMutation();
  const clearOCRCacheMutation = useClearOCRCacheMutation();
  const clearAITagCacheMutation = useClearAITagCacheMutation();
  const importMutation = useImportSettingsMutation();
  const installOCRMutation = useInstallOCRMutation();
  const removeProjectMutation = useRemoveProjectMutation();
  const removeOCRMutation = useRemoveOCRMutation();
  const removeWorkspaceMutation = useRemoveWorkspaceMutation();
  const renameProjectMutation = useRenameProjectMutation();
  const renameWorkspaceMutation = useRenameWorkspaceMutation();
  const resetMutation = useResetDatabaseMutation();
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
  const settingsProjectMap = new Map(
    (settings?.projects ?? []).map((project) => [project.id, project]),
  );
  for (const project of projects) {
    settingsProjectMap.set(project.id, project);
  }
  const settingsProjects = Array.from(settingsProjectMap.values());
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
    scanWorking ||
    addWorkspaceMutation.isPending ||
    clearScanHistoryMutation.isPending ||
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
  const settingsActionDisabled =
    settingsQuery.isLoading || working || ocrWorking;
  const ocrProgress =
    ocrActivity.counts && ocrActivity.batch > 0
      ? t("settings.ocrBatchProgress", {
          batch: ocrActivity.batch,
          progress: ocrProgressLabel(ocrActivity.counts, t),
        })
      : "";
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

  async function onToggleTool(toolId: string, enabled: boolean) {
    const next: SettingsDraft = {
      ...draft,
      optimizationExternalTools: draft.optimizationExternalTools.map((item) =>
        item.id === toolId ? { ...item, enabled } : item,
      ),
    };
    setDraftOverride(next);
    try {
      const result = await updateMutation.mutateAsync(updateFromDraft(next));
      setDraftOverride(draftFromSettings(result.settings));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("toast.settingsSaveFailed"),
      });
    }
  }

  async function onSaveSettings(options?: { silent?: boolean }) {
    try {
      const result = await updateMutation.mutateAsync(updateFromDraft(draft));
      setDraftOverride(draftFromSettings(result.settings));
      if (!options?.silent) toast.success(t("toast.settingsSaved"));
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
      onDismissOCR();
      toast.success(t("settings.ocrRemoveSuccess"));
    } catch (error) {
      toast.error(errorMessage(error), {
        title: t("settings.ocrRemoveFailed"),
      });
    }
  }

  function onRunOCRConfirmed() {
    onStartOCR(async () => {
      const result = await updateMutation.mutateAsync(updateFromDraft(draft));
      setDraftOverride(draftFromSettings(result.settings));
    });
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
    value: {
      name: string;
      iconImage: string;
      scanIntent: ProjectScanIntent;
    },
  ) {
    renameProjectMutation.mutate(
      {
        id: projectId,
        name: value.name,
        iconImage: value.iconImage,
        scanIntent: value.scanIntent,
      },
      {
        onSuccess: () => {
          toast.success(t("projects.renameSuccess", { name: value.name }));
        },
      },
    );
  }

  function onRemoveProject(projectId: string) {
    if (scanWorking) return;
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
    onDismissOCR();
    toast.success(t("toast.settingsReset"));
  }

  function onResetSectionDraft(section: Section | "catalogScanning" | "ocr") {
    updateDraft((current) => resetSectionDraft(current, section));
    toast.success(
      t(
        section === "catalogScanning" || section === "scanning"
          ? "toast.settingsCatalogScanningReset"
          : section === "ocr"
            ? "toast.settingsOcrReset"
            : "toast.settingsSectionReset",
      ),
    );
  }

  async function onExport() {
    const data = await exportSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aisets-export-${new Date().toISOString().slice(0, 10)}.json`;
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
    if (scanWorking) return;
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

  function onClearScanHistory() {
    clearScanHistoryMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("toast.scanHistoryCleared"));
      },
      onError: (error) => {
        toast.error(errorMessage(error), {
          title: t("toast.scanHistoryClearFailed"),
        });
      },
    });
  }

  function onClearOCRCache() {
    clearOCRCacheMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("toast.ocrCacheCleared"));
      },
    });
  }

  function onClearAITagCache() {
    clearAITagCacheMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("toast.aiTagCacheCleared"));
      },
    });
  }

  function settingActionsFor(
    section: Section | "catalogScanning" | "ocr",
    extraDisabled = false,
  ) {
    return (
      <SettingsActions
        disabled={settingsActionDisabled || extraDisabled}
        onSave={() => void onSaveSettings()}
        onReset={() => onResetSectionDraft(section)}
        saveLabel={t("settings.save")}
        resetLabel={t("settings.reset")}
        resetConfirmTitle={t("settings.resetSectionConfirmTitle")}
        resetConfirmDescription={t("settings.resetSectionConfirmDesc")}
      />
    );
  }

  function selectSection(section: Section) {
    setLocalSection(section);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (section === "workspace") next.delete("section");
        else next.set("section", section);
        next.delete("expand");
        return next;
      },
      { replace: true },
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
              onClick={() => selectSection(id)}
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
              working={working || ocrWorking}
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
              working={working || ocrWorking}
              onRenameProject={onRenameProject}
              onRemoveProject={onRemoveProject}
              onSwitchWorkspace={onSwitchWorkspace}
              onAddProject={onAddProject}
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
              ocrRunStopping={ocrActivity.phase === "stopping"}
              ocrStopDisabled={ocrActivity.phase === "saving"}
              ocrRunActive={
                ocrActivity.phase === "saving" ||
                ocrActivity.phase === "running" ||
                ocrActivity.phase === "stopping"
              }
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
              ocrRuntimePlatform={settings?.ocrRuntime.platform ?? ""}
              updatePending={updateMutation.isPending}
              updateError={updateMutation.error}
              catalogActions={settingActionsFor("catalogScanning")}
              ocrActions={settingActionsFor("ocr")}
              onUpdateDraft={updateDraft}
              onInstallOCR={onInstallOCR}
              onRemoveOCR={onRemoveOCR}
              onRunOCR={onRunOCRConfirmed}
              onStopOCR={onStopOCR}
              installOCRPending={installOCRMutation.isPending}
              removeOCRPending={removeOCRMutation.isPending}
            />
          )}

          {activeSection === "ai" && (
            <AISection
              draft={draft}
              settings={settings}
              working={working}
              aiTagActivity={aiTagActivity}
              vlmOcrActivity={vlmOcrActivity}
              settingActions={settingActionsFor("ai")}
              onUpdateDraft={updateDraft}
              onStartAITag={() =>
                onStartAITag(() => onSaveSettings({ silent: true }))
              }
              onStopAITag={onStopAITag}
              onDismissAITag={onDismissAITag}
              onStartVLMOcr={() =>
                onStartVLMOcr(() => onSaveSettings({ silent: true }))
              }
              onStopVLMOcr={onStopVLMOcr}
              onDismissVLMOcr={onDismissVLMOcr}
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
              toolRuntime={settings?.optimizationToolRuntime}
              settingsLoading={settingsQuery.isLoading}
              updatePending={updateMutation.isPending}
              updateError={updateMutation.error}
              expandStrategies={searchParams.get("expand") === "strategies"}
              expandTools={searchParams.get("expand") === "tools"}
              settingActions={(extraDisabled) =>
                settingActionsFor("optimization", extraDisabled)
              }
              onUpdateDraft={updateDraft}
              onToggleTool={onToggleTool}
              onRefreshTools={() => void settingsQuery.refetch()}
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
              onClearScanHistory={onClearScanHistory}
              onClearOCRCache={onClearOCRCache}
              onClearAITagCache={onClearAITagCache}
              onResetSettings={onResetAllSettings}
              onResetDatabase={onResetDatabase}
              onUpdateApp={onUpdateApp}
              updateAppPending={updateAppMutation.isPending}
              clearScanHistoryPending={clearScanHistoryMutation.isPending}
              clearOCRCachePending={clearOCRCacheMutation.isPending}
              clearAITagCachePending={clearAITagCacheMutation.isPending}
              resetPending={resetMutation.isPending}
              importPending={importMutation.isPending}
            />
          )}
        </div>
      </div>
    </>
  );
}

function sectionFromParam(value: string | null): Section | null {
  return sectionMeta.some((section) => section.id === value)
    ? (value as Section)
    : null;
}

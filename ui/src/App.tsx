import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  displayCatalogForMode,
  displayTotalsForMode,
  navigationBadges,
} from "./appScope";
import { AppTopbar } from "./components/AppTopbar";
import { AssetDrawer } from "./components/AssetDrawer";
import { BrowseView } from "./components/BrowseView";
import { CommandPalette } from "./components/CommandPalette";
import { ProjectsView } from "./components/ProjectsView";
import { DirectoryPickerModal } from "./components/DirectoryPickerModal";
import { DuplicatesView } from "./components/DuplicatesView";
import { LintView } from "./components/LintView";
import { NavSidebar } from "./components/NavSidebar";
import { OptimizeView } from "./components/OptimizeView";
import { PreCheckView } from "./components/PreCheckView";
import { PreviewModal } from "./components/PreviewModal";
import { ScrollToTop } from "./components/ScrollToTop";
import { PromptDialog } from "./components/ui";
import { SettingsView } from "./components/SettingsView";
import { useToast } from "./components/ToastProvider";
import { UnusedView } from "./components/UnusedView";
import { NoticeStack } from "./components/ui";
import {
  useAddProjectMutation,
  useApplyPreviewMutation,
  useSwitchWorkspaceMutation,
  useCatalogQuery,
  useDeleteUnusedPreviewMutation,
  useRenamePreviewMutation,
  useScanCatalogMutation,
  useSettingsQuery,
} from "./queries";
import { errorMessage } from "./i18n/index";
import type { ActionPreview, AssetItem, ScanEvent } from "./types";
import { modeForPath, pathForMode, type Mode } from "./ui";

type PreviewState = { endpoint: string; token: string; value: ActionPreview };
type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function storedThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem("asset-studio-theme");
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "dark";
}

function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

export function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = modeForPath(location.pathname);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetItem | null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [autoScrollAssetId, setAutoScrollAssetId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [scanProgress, setScanProgress] = useState<ScanEvent | null>(null);
  const [scanProgressVisible, setScanProgressVisible] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(storedThemePreference);
  const [imagePreviewEnabled, setImagePreviewEnabled] = useState(() => {
    return window.localStorage.getItem("asset-studio-image-preview") !== "off";
  });

  const drawerId = searchParams.get("asset") ?? "";
  const browseCustomFilterId = searchParams.get("customFilter") ?? "";

  function changeMode(nextMode: Mode, projectId?: string) {
    if (projectId != null) setSelectedProjectId(projectId);
    navigate(pathForMode(nextMode));
  }

  const setDrawerId = useCallback(
    (id: string) => {
      setAutoScrollAssetId("");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("asset", id);
          else next.delete("asset");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toast = useToast();
  const autoScanStartedRef = useRef(false);
  const catalogQuery = useCatalogQuery();
  const handleScanEvent = useCallback((event: ScanEvent) => {
    setScanProgress(event);
    setScanProgressVisible(true);
  }, []);
  const scanMutation = useScanCatalogMutation({ onEvent: handleScanEvent });
  const settingsQuery = useSettingsQuery();
  const addProjectMutation = useAddProjectMutation();
  const switchWorkspaceMutation = useSwitchWorkspaceMutation();
  const renamePreviewMutation = useRenamePreviewMutation();
  const deletePreviewMutation = useDeleteUnusedPreviewMutation();
  const applyPreviewMutation = useApplyPreviewMutation();

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveThemePreference(theme);
    };

    applyTheme();
    window.localStorage.setItem("asset-studio-theme", theme);

    if (theme !== "system") return undefined;

    const media = window.matchMedia(SYSTEM_THEME_QUERY);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "asset-studio-image-preview",
      imagePreviewEnabled ? "on" : "off",
    );
  }, [imagePreviewEnabled]);

  useEffect(() => {
    if (scanMutation.isPending) return undefined;
    if (!scanProgressVisible) return undefined;
    const timeout = window.setTimeout(
      () => setScanProgressVisible(false),
      3500,
    );
    return () => window.clearTimeout(timeout);
  }, [scanMutation.isPending, scanProgressVisible, scanProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      } else if (e.key === "Escape") setCmdkOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const catalog = catalogQuery.data ?? null;

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (autoScanStartedRef.current || !settings || !catalog) return;
    if (!settings.scanOnOpen && !settings.autoScanOnOpen) return;
    if (catalog.projects.length === 0) return;

    autoScanStartedRef.current = true;
    scanMutation.mutate(undefined, {
      onError: (error) => toast.error(errorMessage(error)),
    });
  }, [catalog, scanMutation, settingsQuery.data?.settings, toast]);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const working =
    catalogQuery.isFetching ||
    scanMutation.isPending ||
    addProjectMutation.isPending ||
    switchWorkspaceMutation.isPending;
  const workspaceName =
    settingsQuery.data?.settings.workspaceName ?? t("projects.workspaceName");
  const activeWorkspaceId =
    settingsQuery.data?.settings.activeWorkspaceId ?? "default";
  const workspaces = settingsQuery.data?.settings.workspaces ?? [
    { id: activeWorkspaceId, name: workspaceName, projectCount: 0 },
  ];

  const effectiveSelectedProjectId =
    selectedProjectId &&
    catalog?.projects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : "";

  const selectedProject = useMemo(() => {
    return (
      catalog?.projects.find(
        (project) => project.id === effectiveSelectedProjectId,
      ) ?? null
    );
  }, [catalog, effectiveSelectedProjectId]);

  const projectAssetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items)
      counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
    return counts;
  }, [items]);

  const projectSwitchProjects = useMemo(() => {
    return (catalog?.projects ?? []).map((project) => ({
      ...project,
      assetCount: projectAssetCounts.get(project.id) ?? 0,
    }));
  }, [catalog, projectAssetCounts]);

  const browseProjectNames = useMemo(() => {
    if (!catalog) return [];
    if (selectedProject) return [selectedProject.name];
    return catalog.projects.map((project) => project.name);
  }, [catalog, selectedProject]);

  const scopedItems = useMemo(() => {
    return effectiveSelectedProjectId
      ? items.filter((item) => item.projectId === effectiveSelectedProjectId)
      : items;
  }, [effectiveSelectedProjectId, items]);

  const scopedItemIds = useMemo(
    () => new Set(scopedItems.map((item) => item.id)),
    [scopedItems],
  );

  const scopedDuplicateGroups = useMemo(() => {
    if (!catalog) return [];
    return catalog.duplicateGroups.filter(
      (group) =>
        scopedItems.filter((item) => item.duplicateGroupId === group.id)
          .length > 1,
    );
  }, [catalog, scopedItems]);

  const scopedNearDuplicates = useMemo(() => {
    if (!catalog) return [];
    return catalog.nearDuplicates.filter(
      (pair) =>
        scopedItemIds.has(pair.leftId) && scopedItemIds.has(pair.rightId),
    );
  }, [catalog, scopedItemIds]);

  const scopedLintFindings = useMemo(() => {
    if (!catalog) return [];
    if (!selectedProject) return catalog.lintFindings;
    return catalog.lintFindings.filter((finding) => {
      if (finding.assetId) return scopedItemIds.has(finding.assetId);
      return finding.file.startsWith(selectedProject.name);
    });
  }, [catalog, scopedItemIds, selectedProject]);

  const unusedItems = useMemo(
    () => scopedItems.filter((i) => i.usedBy.length === 0),
    [scopedItems],
  );
  const optimizeItems = useMemo(
    () => scopedItems.filter((i) => i.optimizationRecommendations.length > 0),
    [scopedItems],
  );
  const browseItems = useMemo(() => scopedItems, [scopedItems]);
  const lintFindings = scopedLintFindings;

  const optimizeCount = optimizeItems.length;
  const scopedStats = useMemo(
    () => ({
      totalFiles: scopedItems.length,
      duplicateGroups: scopedDuplicateGroups.length,
      duplicateFiles: scopedItems.filter(
        (item) =>
          item.duplicateGroupId &&
          scopedDuplicateGroups.some(
            (group) => group.id === item.duplicateGroupId,
          ),
      ).length,
      unusedFiles: unusedItems.length,
      nearDuplicates: scopedNearDuplicates.length,
      lintFindings: scopedLintFindings.length,
      cacheHits: catalog?.stats.cacheHits ?? 0,
    }),
    [
      catalog,
      scopedDuplicateGroups,
      scopedItems,
      scopedLintFindings,
      scopedNearDuplicates,
      unusedItems.length,
    ],
  );

  const scopedCatalog = useMemo(() => {
    if (!catalog) return null;
    const projects = selectedProject ? [selectedProject] : catalog.projects;
    return {
      ...catalog,
      projects,
      items: scopedItems,
      duplicateGroups: scopedDuplicateGroups,
      nearDuplicates: scopedNearDuplicates,
      lintFindings: scopedLintFindings,
      stats: scopedStats,
    };
  }, [
    catalog,
    scopedDuplicateGroups,
    scopedItems,
    scopedLintFindings,
    scopedNearDuplicates,
    scopedStats,
    selectedProject,
  ]);

  const badges = navigationBadges(catalog, scopedStats, optimizeCount);
  const displayCatalog = displayCatalogForMode(mode, catalog, scopedCatalog);

  const drawerAsset = drawerId
    ? items.find((i) => i.id === drawerId)
    : undefined;
  const directoryPickerInitialPath =
    settingsQuery.data?.settings.defaultProjectRoot ?? "";

  const notices: ComponentProps<typeof NoticeStack>["items"] = [];
  if (catalogQuery.error)
    notices.push({
      id: "catalog-error",
      tone: "danger",
      title: t("error.catalogLoad"),
      children: errorMessage(catalogQuery.error),
    });
  if (scanMutation.error)
    notices.push({
      id: "scan-error",
      tone: "danger",
      title: t("error.scan"),
      children: errorMessage(scanMutation.error),
    });
  if (addProjectMutation.error)
    notices.push({
      id: "add-error",
      tone: "danger",
      title: t("error.addProject"),
      children: errorMessage(addProjectMutation.error),
    });

  function onAddProject(path: string) {
    addProjectMutation.mutate(path, {
      onSuccess: () => {
        setDirectoryPickerOpen(false);
        toast.success(t("toast.projectAdded", { path }));
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onSwitchWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    switchWorkspaceMutation.mutate(workspaceId, {
      onSuccess: (result) => {
        setSelectedProjectId("");
        toast.success(
          t("toast.workspaceSwitched", {
            name: result.settings.workspaceName,
          }),
        );
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onRescan() {
    setScanProgress(null);
    setScanProgressVisible(true);
    scanMutation.mutate(undefined, {
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function onRename(item: AssetItem) {
    setRenameTarget(item);
  }

  function onRenameConfirm(targetPath: string) {
    if (!renameTarget || targetPath === renameTarget.repoPath) return;
    renamePreviewMutation.mutate(
      {
        assetId: renameTarget.id,
        targetPath,
      },
      {
        onSuccess: (result) => {
          setRenameTarget(null);
          setPreview({
            endpoint: "/api/actions/rename/apply",
            token: result.token,
            value: result.preview,
          });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  async function onDelete(item: AssetItem) {
    const result = await deletePreviewMutation.mutateAsync(item.id);
    setPreview({
      endpoint: "/api/actions/delete-unused/apply",
      token: result.token,
      value: result.preview,
    });
  }

  async function onApplyPreview() {
    if (!preview) return;
    try {
      await applyPreviewMutation.mutateAsync({
        endpoint: preview.endpoint,
        token: preview.token,
      });
      setPreview(null);
      toast.success(t("toast.applyComplete"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onCopyPath(path: string) {
    navigator.clipboard?.writeText(path);
    toast.info(t("toast.copied"), { durationMs: 1800 });
  }

  function openAssetFromPalette(id: string) {
    if (!scopedItemIds.has(id)) return;
    const params = new URLSearchParams({ asset: id });
    setAutoScrollAssetId(id);
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  function openCustomFilterFromPalette(id: string) {
    const params = new URLSearchParams({ customFilter: id });
    setAutoScrollAssetId("");
    navigate({
      pathname: pathForMode("browse"),
      search: `?${params.toString()}`,
    });
  }

  const clearAutoScrollAssetId = useCallback(
    () => setAutoScrollAssetId(""),
    [],
  );

  const displayTotals = displayTotalsForMode(mode, catalog, scopedCatalog);
  const totalLabel = displayTotals
    ? t("topbar.totalLabel", displayTotals)
    : t("topbar.noCatalog");

  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <main className="grid h-screen w-screen grid-cols-[240px_1fr] grid-rows-[1fr] max-[960px]:grid-cols-[64px_1fr]">
        <NavSidebar
          mode={mode}
          badges={badges}
          workspaceName={workspaceName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          projects={projectSwitchProjects}
          selectedProjectId={effectiveSelectedProjectId}
          totalAssets={items.length}
          onSelectWorkspace={onSwitchWorkspace}
          onSelectProject={setSelectedProjectId}
          onSelect={changeMode}
        />
        <section className="flex flex-col overflow-hidden bg-g-canvas bg-[radial-gradient(circle_at_1px_1px,var(--g-line)_1px,transparent_0)] bg-[length:24px_24px] [[data-theme='dark']_&]:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)]">
          <AppTopbar
            mode={mode}
            totalLabel={totalLabel}
            working={working}
            scanProgress={scanProgressVisible ? scanProgress : null}
            onAddProject={() => setDirectoryPickerOpen(true)}
            onRefresh={onRescan}
            onOpenCmdK={() => setCmdkOpen(true)}
          />

          <NoticeStack items={notices} />

          <div className="flex flex-1 overflow-hidden">
            {mode === "browse" ? (
              <BrowseView
                key={
                  selectedProject
                    ? `${selectedProject.id}:${selectedProject.name}:${browseCustomFilterId}`
                    : `all-projects:${browseCustomFilterId}`
                }
                items={browseItems}
                activeAssetId={drawerId}
                autoScrollAssetId={autoScrollAssetId}
                initialCustomFilterId={browseCustomFilterId}
                customFilters={
                  settingsQuery.data?.settings.customAssetFilters ?? []
                }
                projectNames={browseProjectNames}
                projectFilterName={selectedProject?.name ?? ""}
                imagePreviewEnabled={imagePreviewEnabled}
                onAutoScrollDone={clearAutoScrollAssetId}
                onOpenAsset={setDrawerId}
              />
            ) : mode === "settings" ? (
              <SettingsView
                theme={theme}
                imagePreviewEnabled={imagePreviewEnabled}
                onThemeChange={setTheme}
                onImagePreviewEnabledChange={setImagePreviewEnabled}
              />
            ) : (
              <div className="content-scroll flex-1 overflow-y-auto overflow-x-hidden px-8 pt-8 pb-12 max-[768px]:px-4 max-[768px]:pt-5 max-[768px]:pb-8">
                {mode === "precheck" ? (
                  <PreCheckView onOpenAsset={openAssetFromPalette} />
                ) : displayCatalog == null &&
                  !catalogQuery.isLoading ? null : mode === "projects" &&
                  displayCatalog ? (
                  <ProjectsView
                    catalog={displayCatalog}
                    onJump={changeMode}
                    onAddProject={() => setDirectoryPickerOpen(true)}
                  />
                ) : mode === "duplicates" && scopedCatalog ? (
                  <DuplicatesView
                    items={scopedItems}
                    groups={scopedCatalog.duplicateGroups}
                    nearDuplicates={scopedCatalog.nearDuplicates}
                    onOpenAsset={setDrawerId}
                  />
                ) : mode === "unused" ? (
                  <UnusedView items={unusedItems} onOpenAsset={setDrawerId} />
                ) : mode === "optimize" ? (
                  <OptimizeView
                    items={optimizeItems}
                    onOpenAsset={setDrawerId}
                  />
                ) : mode === "lint" ? (
                  <LintView findings={lintFindings} onOpenAsset={setDrawerId} />
                ) : null}
              </div>
            )}
          </div>
        </section>

        <ScrollToTop />

        {drawerAsset && (
          <AssetDrawer
            asset={drawerAsset}
            onClose={() => setDrawerId("")}
            onRename={onRename}
            onDelete={onDelete}
            onCopyPath={onCopyPath}
          />
        )}

        <CommandPalette
          open={cmdkOpen}
          assets={scopedItems}
          customFilters={settingsQuery.data?.settings.customAssetFilters ?? []}
          onClose={() => setCmdkOpen(false)}
          onNavigate={changeMode}
          onOpenAsset={openAssetFromPalette}
          onOpenCustomFilter={openCustomFilterFromPalette}
        />

        {directoryPickerOpen && (
          <DirectoryPickerModal
            open={directoryPickerOpen}
            working={addProjectMutation.isPending}
            initialPath={directoryPickerInitialPath}
            onClose={() => setDirectoryPickerOpen(false)}
            onSelect={onAddProject}
          />
        )}

        <PromptDialog
          open={renameTarget != null}
          title={t("action.rename")}
          label={t("prompt.renamePath")}
          defaultValue={renameTarget?.repoPath ?? ""}
          confirmText={t("action.rename")}
          cancelText={t("common.cancel")}
          loading={renamePreviewMutation.isPending}
          onConfirm={onRenameConfirm}
          onCancel={() => setRenameTarget(null)}
        />

        {preview && (
          <PreviewModal
            preview={preview.value}
            working={applyPreviewMutation.isPending}
            onCancel={() => setPreview(null)}
            onApply={onApplyPreview}
          />
        )}
      </main>
    </TooltipPrimitive.Provider>
  );
}

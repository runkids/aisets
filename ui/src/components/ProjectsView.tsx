import {
  ArrowRight,
  Copy,
  FolderKanban,
  FolderPlus,
  HardDrive,
  Images,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogSummary, Project, ScanEvent } from "../types";
import {
  useRemoveProjectMutation,
  useRenameProjectMutation,
  useSettingsQuery,
} from "../queries";
import { errorMessage } from "../i18n/index";
import { projectScanIntentLabel } from "../projectScanIntent";
import { formatBytes } from "../ui";
import type { Mode } from "../ui";
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconWell,
  StackedBar,
  StatCard,
  Tabs,
  TextInput,
  TextInputClearButton,
  type DropdownMenuItem,
  type StackedBarSegment,
} from "./ui";
import { useToast } from "./ToastProvider";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProjectDialog } from "./ProjectDialog";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

type Props = {
  catalog: CatalogSummary;
  scanProgress?: ScanEvent | null;
  onJump: (mode: Mode, projectId?: string) => void;
  onAddProject?: () => void;
};

export type ProjectStat = {
  project: Project;
  assetCount: number;
  bytes: number;
  used: number;
  unused: number;
  duplicates: number;
  optimizable: number;
  lint: number;
  health: number;
  lastScanLabel: string;
};

export type SortKey = "name" | "count" | "size" | "health" | "imported";

const sortItems: Array<{ value: SortKey; label: string }> = [
  { value: "name", label: "" },
  { value: "count", label: "" },
  { value: "size", label: "" },
  { value: "health", label: "" },
  { value: "imported", label: "" },
];

function formatScanTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildProjectStats(
  catalog: CatalogSummary,
  locale: string,
): ProjectStat[] {
  const statsByProject = new Map(
    catalog.projectStats.map((stat) => [stat.projectId, stat]),
  );
  return catalog.projects.map((project) => {
    const projectStats = statsByProject.get(project.id);
    const assetCount = projectStats?.totalFiles ?? 0;
    const bytes = projectStats?.totalBytes ?? 0;
    const unused = projectStats?.unusedFiles ?? 0;
    const duplicates = projectStats?.duplicateFiles ?? 0;
    const optimizable = projectStats?.optimizableFiles ?? 0;
    const lint = projectStats?.lintFindings ?? 0;
    const used = assetCount - unused;
    const weightedIssues = unused + duplicates + optimizable + lint;
    const health =
      assetCount === 0
        ? 100
        : Math.max(
            0,
            Math.round(
              100 - (weightedIssues / Math.max(assetCount * 2, 1)) * 100,
            ),
          );

    return {
      project,
      assetCount,
      bytes,
      used,
      unused,
      duplicates,
      optimizable,
      lint,
      health,
      lastScanLabel: formatScanTime(catalog.generatedAt, locale),
    };
  });
}

function healthTone(health: number): "green" | "amber" | "red" {
  if (health >= 80) return "green";
  if (health >= 55) return "amber";
  return "red";
}

function healthColorClass(health: number): string {
  const tone = healthTone(health);
  if (tone === "green") return "text-g-green";
  if (tone === "amber") return "text-g-amber";
  return "text-g-red";
}

function projectCreatedAtTime(project: Project) {
  const time = project.createdAt ? new Date(project.createdAt).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

// eslint-disable-next-line react-refresh/only-export-components
export function sortProjectStats(stats: ProjectStat[], sort: SortKey) {
  return [...stats].sort((a, b) => {
    if (sort === "count")
      return (
        b.assetCount - a.assetCount ||
        a.project.name.localeCompare(b.project.name)
      );
    if (sort === "size")
      return b.bytes - a.bytes || a.project.name.localeCompare(b.project.name);
    if (sort === "health")
      return (
        b.health - a.health || a.project.name.localeCompare(b.project.name)
      );
    if (sort === "imported")
      return (
        projectCreatedAtTime(b.project) - projectCreatedAtTime(a.project) ||
        a.project.name.localeCompare(b.project.name)
      );
    return a.project.name.localeCompare(b.project.name);
  });
}

function buildHealthSegments(stat: ProjectStat): StackedBarSegment[] {
  return [{ value: stat.health, tone: healthTone(stat.health) }];
}

function useProjectMenuItems(
  project: Project,
  onRename: (p: Project) => void,
  onRemove: (p: Project) => void,
): DropdownMenuItem[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        label: t("action.edit"),
        icon: <Pencil />,
        onClick: () => onRename(project),
      },
      {
        label: t("projects.remove"),
        icon: <Trash2 />,
        onClick: () => onRemove(project),
        variant: "danger" as const,
      },
    ],
    [t, project, onRename, onRemove],
  );
}

function ProjectCard({
  stat,
  onJump,
  onRename,
  onRemove,
}: {
  stat: ProjectStat;
  onJump: (mode: Mode, projectId?: string) => void;
  onRename: (project: Project) => void;
  onRemove: (project: Project) => void;
}) {
  const { t } = useTranslation();
  const menuItems = useProjectMenuItems(stat.project, onRename, onRemove);

  return (
    <Card>
      <CardBody padding="md">
        <div className="flex items-start gap-3">
          <ProjectAvatar iconImage={stat.project.iconImage} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-g-display text-[17px] font-[590] leading-tight tracking-[-0.013em] text-g-ink">
                {stat.project.name}
              </h3>
              <Badge tone="line">
                {t("projects.filesCount", { count: stat.assetCount })}
              </Badge>
              <Badge tone="line">
                {projectScanIntentLabel(t, stat.project.scanIntent)}
              </Badge>
            </div>
            <code className="mt-0.5 block truncate font-g-mono text-g-chip text-g-ink-4">
              {stat.project.path}
            </code>
          </div>
          <DropdownMenu
            items={menuItems}
            trigger={
              <button
                type="button"
                className="relative size-8 grid place-items-center rounded-g-md text-g-ink-2 bg-transparent cursor-pointer transition-[background,color,transform] duration-[120ms] ease-[var(--g-ease)] before:absolute before:inset-[-6px] before:content-[''] hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus active:not-disabled:scale-[0.94] disabled:opacity-[0.38] disabled:cursor-not-allowed [&>svg]:size-4"
                aria-label={t("projects.projectActionsAria", {
                  name: stat.project.name,
                })}
              >
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <StackedBar
            segments={buildHealthSegments(stat)}
            total={100}
            className="flex-1 bg-g-surface-2 data-[track-tone=green]:bg-[color-mix(in_srgb,var(--g-green)_16%,var(--g-surface-2))] data-[track-tone=amber]:bg-[color-mix(in_srgb,var(--g-amber)_16%,var(--g-surface-2))] data-[track-tone=red]:bg-[color-mix(in_srgb,var(--g-red)_16%,var(--g-surface-2))] [&>span]:opacity-90"
            ariaLabel={t("projects.healthBadge", { health: stat.health })}
            trackTone={healthTone(stat.health)}
          />
          <span
            className={`shrink-0 font-g-display text-[20px] font-[590] leading-none tabular-nums ${healthColorClass(stat.health)}`}
          >
            {stat.health}
            <span className="text-[11px] font-[510]">%</span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="line">{formatBytes(stat.bytes)}</Badge>
          {stat.unused > 0 && (
            <Badge tone="red">
              {t("projects.unusedBadge", { count: stat.unused })}
            </Badge>
          )}
          {stat.duplicates > 0 && (
            <Badge tone="amber">
              {t("projects.duplicateBadge", { count: stat.duplicates })}
            </Badge>
          )}
          {stat.optimizable > 0 && (
            <Badge tone="blue">
              {t("projects.optimizableBadge", { count: stat.optimizable })}
            </Badge>
          )}
          {stat.lint > 0 && (
            <Badge tone="purple">
              {t("projects.lintBadge", { count: stat.lint })}
            </Badge>
          )}
        </div>

        <div className="mt-4 flex items-center border-t border-g-line pt-3 text-g-caption text-g-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-g-pill bg-g-green" />
            {t("projects.lastScan", { time: stat.lastScanLabel })}
          </span>
          <Button
            className="ml-auto"
            variant="ghost"
            size="sm"
            trailingIcon={<ArrowRight size={13} />}
            onClick={() => onJump("browse", stat.project.id)}
          >
            {t("projects.browseProject")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AddProjectCard({ onAddProject }: { onAddProject?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="grid min-h-[176px] place-items-center rounded-g-md border-2 border-dashed border-g-line-strong bg-g-surface p-4 text-g-ink-3 transition-[border-color,background,color,box-shadow] duration-200 ease-g hover:not-disabled:border-g-accent hover:not-disabled:bg-[color-mix(in_srgb,var(--g-accent-soft)_50%,var(--g-surface))] hover:text-g-ink-2 focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
      onClick={onAddProject}
      disabled={!onAddProject}
    >
      <div className="flex flex-col items-center gap-3">
        <IconWell size="lg" tone="neutral">
          <FolderPlus />
        </IconWell>
        <span className="text-g-caption font-[510]">
          {t("projects.addProject")}
        </span>
      </div>
    </button>
  );
}

export function ProjectsView({
  catalog,
  scanProgress,
  onJump,
  onAddProject,
}: Props) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const settingsQuery = useSettingsQuery();
  const toast = useToast();
  const removeMutation = useRemoveProjectMutation();
  const renameMutation = useRenameProjectMutation();
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);

  const handleRenameRequest = useCallback((project: Project) => {
    setRenameTarget(project);
  }, []);

  const handleRenameConfirm = useCallback(
    (value: {
      name: string;
      iconImage: string;
      scanIntent: NonNullable<Project["scanIntent"]>;
    }) => {
      if (!renameTarget) return;
      renameMutation.mutate(
        {
          id: renameTarget.id,
          name: value.name,
          iconImage: value.iconImage,
          scanIntent: value.scanIntent,
        },
        {
          onSuccess: () => {
            toast.success(t("projects.renameSuccess", { name: value.name }));
            setRenameTarget(null);
          },
          onError: (e) => {
            toast.error(errorMessage(e));
            setRenameTarget(null);
          },
        },
      );
    },
    [renameTarget, t, renameMutation, toast],
  );

  const handleRemoveRequest = useCallback((project: Project) => {
    setRemoveTarget(project);
  }, []);

  const handleRemoveConfirm = useCallback(() => {
    if (!removeTarget) return;
    removeMutation.mutate(removeTarget.id, {
      onSuccess: () => {
        toast.success(t("projects.removeSuccess", { name: removeTarget.name }));
        setRemoveTarget(null);
      },
      onError: (e) => {
        toast.error(errorMessage(e));
        setRemoveTarget(null);
      },
    });
  }, [removeTarget, t, removeMutation, toast]);

  const localizedSortItems = useMemo<Array<{ value: SortKey; label: string }>>(
    () =>
      sortItems.map((item) => ({
        ...item,
        label: t(`projects.sort.${item.value}`),
      })),
    [t],
  );

  const projects = catalog.projects ?? [];
  const totalBytes = catalog.projectStats.reduce(
    (sum, stat) => sum + stat.totalBytes,
    0,
  );
  const projectStats = useMemo(
    () => buildProjectStats(catalog, i18n.language),
    [catalog, i18n.language],
  );
  const visibleProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? projectStats.filter(
          (stat) =>
            stat.project.name.toLowerCase().includes(keyword) ||
            stat.project.path.toLowerCase().includes(keyword),
        )
      : projectStats;
    return sortProjectStats(filtered, sort);
  }, [projectStats, query, sort]);

  const scanning =
    scanProgress != null &&
    scanProgress.type !== "done" &&
    scanProgress.type !== "error";
  const unused = catalog.stats.unusedFiles;
  const duplicateFiles = catalog.stats.duplicateFiles;
  const lastScan = formatScanTime(catalog.generatedAt, i18n.language);
  const settings = settingsQuery.data?.settings;
  const workspaceName = settings?.workspaceName ?? t("projects.workspaceName");
  const activeWorkspace = settings?.workspaces.find(
    (workspace) => workspace.id === settings.activeWorkspaceId,
  );

  return (
    <div className="flex w-full flex-col gap-3">
      {/* ── Workspace hero ── */}
      <div className="flex flex-col gap-4 rounded-g-md border border-g-line bg-g-surface p-4 shadow-g-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <WorkspaceAvatar
            name={workspaceName}
            iconImage={activeWorkspace?.iconImage}
            className="size-14 bg-g-surface-2 text-xl shadow-g-inset"
          />
          <div>
            <div className="text-g-chip font-[510] uppercase tracking-[0.06em] text-g-ink-4">
              {t("projects.workspace")}
            </div>
            <h2 className="font-g-display text-[22px] font-[590] tracking-[-0.018em] text-g-ink">
              {workspaceName}
            </h2>
          </div>
        </div>
        {scanProgress && scanProgress.type !== "done" ? (
          <div className="flex items-center gap-2 text-g-caption text-g-ink-2">
            <Loader2
              size={14}
              className="shrink-0 animate-spin text-g-accent"
            />
            <span className="font-[510]">
              {scanProgress.type === "progress"
                ? t(`scanProgress.phase.${scanProgress.phase}`)
                : t("scanProgress.starting")}
            </span>
            {scanProgress.type === "progress" &&
              (scanProgress.total ?? 0) > 0 && (
                <span className="font-g-mono tabular-nums text-g-ink-3">
                  {scanProgress.current ?? 0}/{scanProgress.total}
                </span>
              )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-g-caption text-g-ink-4">
            <span className="size-1.5 rounded-g-pill bg-g-green" />
            <span>{t("projects.lastCompletedScan")}</span>
            <span className="font-g-mono tabular-nums">{lastScan}</span>
          </div>
        )}
      </div>

      {projects.length === 0 && scanning ? (
        <EmptyState
          icon={<Loader2 className="animate-spin" />}
          title={t("status.scanning")}
          description={t("status.scanningDesc")}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderPlus />}
          title={t("dashboard.noProjects")}
          description={t("dashboard.noProjectsDesc")}
          action={
            onAddProject ? (
              <Button
                variant="primary"
                leadingIcon={<FolderPlus size={14} />}
                onClick={onAddProject}
              >
                {t("projects.addProject")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <StatCard
              label={t("projects.projects")}
              value={projects.length}
              icon={<FolderKanban size={14} />}
            />
            <StatCard
              label={t("projects.totalAssets")}
              value={catalog.stats.totalFiles}
              icon={<Images size={14} />}
            />
            <StatCard
              label={t("projects.totalSize")}
              value={formatBytes(totalBytes)}
              icon={<HardDrive size={14} />}
            />
            <StatCard
              label={t("projects.unused")}
              value={unused}
              tone={unused > 0 ? "red" : "neutral"}
              icon={<Trash2 size={14} />}
              onClick={() => onJump("unused")}
            />
            <StatCard
              label={t("projects.duplicateGroups")}
              value={duplicateFiles}
              tone={duplicateFiles > 0 ? "amber" : "neutral"}
              icon={<Copy size={14} />}
              onClick={() => onJump("duplicates")}
            />
          </div>

          {/* ── Toolbar: search + sort ── */}
          <div className="sticky top-0 z-[20] -mx-3 bg-g-canvas px-3">
            <Card padding="md">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <TextInput
                  variant="search"
                  icon={<Search size={16} />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("projects.searchProjectsPlaceholder")}
                  suffix={
                    query ? (
                      <TextInputClearButton
                        label={t("toolbar.clearSearch")}
                        onClick={() => setQuery("")}
                      />
                    ) : undefined
                  }
                  className="w-full max-w-[420px]"
                  inputClassName="font-g text-g-ui tracking-g-ui"
                />
                <div className="flex items-center gap-2">
                  <span className="text-g-caption text-g-ink-3">
                    {t("projects.sortLabel")}
                  </span>
                  <Tabs
                    value={sort}
                    items={localizedSortItems}
                    onChange={setSort}
                    ariaLabel={t("projects.sortAria")}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* ── Project cards ── */}
          {visibleProjects.length === 0 ? (
            <EmptyState
              title={t("projects.noProjects")}
              description={t("projects.noProjectsDesc")}
            />
          ) : (
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visibleProjects.map((stat) => (
                <ProjectCard
                  key={stat.project.id}
                  stat={stat}
                  onJump={onJump}
                  onRename={handleRenameRequest}
                  onRemove={handleRemoveRequest}
                />
              ))}
              <AddProjectCard onAddProject={onAddProject} />
            </section>
          )}
        </>
      )}

      <ProjectDialog
        open={renameTarget != null}
        project={renameTarget}
        loading={renameMutation.isPending}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={removeTarget != null}
        variant="danger"
        title={t("projects.removeDialogTitle")}
        message={t("projects.removeConfirm", {
          name: removeTarget?.name ?? "",
        })}
        confirmText={t("projects.removeDialogConfirm")}
        cancelText={t("common.cancel")}
        loading={removeMutation.isPending}
        onConfirm={handleRemoveConfirm}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}

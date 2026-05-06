import {
  ArrowRight,
  FolderKanban,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetItem, Catalog, Project } from "../types";
import {
  useRemoveProjectMutation,
  useRenameProjectMutation,
  useSettingsQuery,
} from "../queries";
import { errorMessage } from "../i18n/index";
import { fileName, formatBytes } from "../ui";
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
  PromptDialog,
  StackedBar,
  Tabs,
  TextInput,
  type DropdownMenuItem,
  type StackedBarSegment,
} from "./ui";
import { useToast } from "./ToastProvider";

type Props = {
  catalog: Catalog;
  onJump: (mode: Mode, projectId?: string) => void;
  onAddProject?: () => void;
};

export type ProjectStat = {
  project: Project;
  items: AssetItem[];
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

function projectInitial(name: string) {
  return (name.trim()[0] ?? "A").toUpperCase();
}

function buildProjectStats(catalog: Catalog, locale: string): ProjectStat[] {
  return catalog.projects.map((project) => {
    const items = catalog.items.filter((item) => item.projectId === project.id);
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const unused = items.filter((item) => item.usedBy.length === 0).length;
    const duplicates = items.filter(
      (item) => item.duplicateGroupId != null,
    ).length;
    const optimizable = items.filter(
      (item) => item.optimizationRecommendations.length > 0,
    ).length;
    const lint = catalog.lintFindings.filter((finding) =>
      items.some(
        (item) =>
          finding.assetId === item.id ||
          finding.file.startsWith(item.projectName),
      ),
    ).length;
    const used = items.length - unused;
    const weightedIssues = unused + duplicates + optimizable + lint;
    const health =
      items.length === 0
        ? 100
        : Math.max(
            0,
            Math.round(
              100 - (weightedIssues / Math.max(items.length * 2, 1)) * 100,
            ),
          );

    return {
      project,
      items,
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

function projectCreatedAtTime(project: Project) {
  const time = project.createdAt ? new Date(project.createdAt).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

// eslint-disable-next-line react-refresh/only-export-components
export function sortProjectStats(stats: ProjectStat[], sort: SortKey) {
  return [...stats].sort((a, b) => {
    if (sort === "count")
      return (
        b.items.length - a.items.length ||
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

function KpiCell({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "red" | "amber";
  onClick?: () => void;
}) {
  const colorClass =
    tone === "red"
      ? "text-g-red"
      : tone === "amber"
        ? "text-g-amber"
        : "text-g-ink";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`text-left ${onClick ? "-m-2 cursor-pointer rounded-g-md p-2 transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus" : ""}`}
      onClick={onClick}
    >
      <div className="text-g-chip font-[510] text-g-ink-3">{label}</div>
      <div
        className={`mt-1 font-g-display text-2xl font-[590] leading-none tracking-[-0.022em] tabular-nums ${colorClass}`}
      >
        {value}
      </div>
    </Tag>
  );
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
        label: t("projects.rename"),
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
          <IconWell size="lg" tone="neutral">
            <FolderKanban />
          </IconWell>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-g-display text-[17px] font-[590] leading-tight tracking-[-0.013em] text-g-ink">
                {stat.project.name}
              </h3>
              <Badge tone="line">
                {t("projects.filesCount", { count: stat.items.length })}
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
                className="iconbtn"
                aria-label={t("projects.projectActionsAria", {
                  name: stat.project.name,
                })}
              >
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>

        <StackedBar
          segments={buildHealthSegments(stat)}
          total={100}
          className="mt-4 bg-g-surface-2 data-[track-tone=green]:bg-[color-mix(in_srgb,var(--g-green)_16%,var(--g-surface-2))] data-[track-tone=amber]:bg-[color-mix(in_srgb,var(--g-amber)_16%,var(--g-surface-2))] data-[track-tone=red]:bg-[color-mix(in_srgb,var(--g-red)_16%,var(--g-surface-2))] [&>span]:opacity-90"
          ariaLabel={t("projects.healthBadge", { health: stat.health })}
          trackTone={healthTone(stat.health)}
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="line">{formatBytes(stat.bytes)}</Badge>
          <Badge tone={healthTone(stat.health)}>
            {t("projects.healthBadge", { health: stat.health })}
          </Badge>
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

export function ProjectsView({ catalog, onJump, onAddProject }: Props) {
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
    (newName: string) => {
      if (!renameTarget) return;
      renameMutation.mutate(
        { id: renameTarget.id, name: newName },
        {
          onSuccess: () => {
            toast.success(t("projects.renameSuccess", { name: newName }));
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

  const items = catalog.items ?? [];
  const projects = catalog.projects ?? [];
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
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
            stat.project.path.toLowerCase().includes(keyword) ||
            stat.items.some(
              (item) =>
                item.repoPath.toLowerCase().includes(keyword) ||
                fileName(item.repoPath).toLowerCase().includes(keyword),
            ),
        )
      : projectStats;
    return sortProjectStats(filtered, sort);
  }, [projectStats, query, sort]);

  const unused = catalog.stats.unusedFiles;
  const duplicateFiles = catalog.stats.duplicateFiles;
  const lastScan = formatScanTime(catalog.generatedAt, i18n.language);
  const workspaceName =
    settingsQuery.data?.settings.workspaceName ?? t("projects.workspaceName");

  return (
    <div className="content-grid !mx-0 !w-full !max-w-none">
      {/* Workspace hero */}
      <Card variant="default" padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <IconWell
              size="lg"
              tone="neutral"
              className="font-g-display text-lg font-[590]"
            >
              {projectInitial(workspaceName)}
            </IconWell>
            <div>
              <div className="text-g-chip font-[510] uppercase tracking-[0.06em] text-g-ink-3">
                {t("projects.workspace")}
              </div>
              <h2 className="font-g-display text-[17px] font-[590] tracking-[-0.013em] text-g-ink">
                {workspaceName}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1 text-g-caption text-g-ink-4">
            <span className="size-1.5 rounded-g-pill bg-g-green" />
            <span>{t("projects.lastCompletedScan")}</span>
            <span className="font-g-mono tabular-nums">{lastScan}</span>
          </div>
        </div>

        {/* KPI row */}
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-g-line pt-4 md:grid-cols-5">
          <KpiCell label={t("projects.projects")} value={projects.length} />
          <KpiCell
            label={t("projects.totalAssets")}
            value={catalog.stats.totalFiles}
          />
          <KpiCell
            label={t("projects.totalSize")}
            value={formatBytes(totalBytes)}
          />
          <KpiCell
            label={t("projects.unused")}
            value={unused}
            tone="red"
            onClick={() => onJump("unused")}
          />
          <KpiCell
            label={t("projects.duplicateGroups")}
            value={duplicateFiles}
            tone="amber"
            onClick={() => onJump("duplicates")}
          />
        </div>
      </Card>

      {/* Toolbar: search + sort */}
      <div className="sticky top-0 z-[20] -mx-3 bg-g-canvas px-3 pb-3 pt-0">
        <Card padding="md">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <TextInput
              variant="search"
              icon={<Search size={16} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("projects.searchProjectsPlaceholder")}
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

      {/* Project cards */}
      {visibleProjects.length === 0 ? (
        <EmptyState
          title={t("projects.noProjects")}
          description={t("projects.noProjectsDesc")}
          action={
            onAddProject ? (
              <Button variant="primary" onClick={onAddProject}>
                {t("projects.addProject")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      <PromptDialog
        open={renameTarget != null}
        title={t("projects.renameDialogTitle")}
        label={t("projects.renameLabel")}
        defaultValue={renameTarget?.name ?? ""}
        confirmText={t("projects.renameDialogConfirm")}
        cancelText={t("common.cancel")}
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

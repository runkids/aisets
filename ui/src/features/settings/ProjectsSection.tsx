import {
  ArrowLeftRight,
  CheckCircle2,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { projectScanIntentLabel } from "@/projectScanIntent";
import type { Project, ProjectScanIntent, Workspace } from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
} from "@/components/ui";
import { ProjectAvatar } from "@/components/project/ProjectAvatar";
import { ProjectDialog } from "@/components/project/ProjectDialog";
import { WorkspaceAvatar } from "@/components/project/WorkspaceAvatar";
import { SectionHeading, sectionIcon } from "./index";
import {
  activeWorkspaceBadgeClass,
  projectAssetsBadgeClass,
  projectRowActionRevealClass,
  rowActionButtonClass,
  rowActionDangerButtonClass,
  switchWorkspaceButtonClass,
} from "./constants";

type ProjectsSectionProps = {
  projects: Project[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspaceProjects: Map<string, Project[]>;
  assetCountByProject: Record<string, number>;
  working: boolean;
  onRenameProject: (
    projectId: string,
    value: { name: string; iconImage: string; scanIntent: ProjectScanIntent },
  ) => void;
  onRemoveProject: (projectId: string) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  onAddProject?: () => void;
};

export function ProjectsSection({
  projects,
  workspaces,
  activeWorkspaceId,
  workspaceProjects,
  assetCountByProject,
  working,
  onRenameProject,
  onRemoveProject,
  onSwitchWorkspace,
  onAddProject,
}: ProjectsSectionProps) {
  const { t } = useTranslation();
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);

  const projectBeingRenamed = projects.find(
    (project) => project.id === renameProjectId,
  );
  const projectBeingRemoved = projects.find(
    (project) => project.id === removeProjectId,
  );

  function handleRenameProject(value: {
    name: string;
    iconImage: string;
    scanIntent: ProjectScanIntent;
  }) {
    if (!projectBeingRenamed) return;
    onRenameProject(projectBeingRenamed.id, value);
    setRenameProjectId(null);
  }

  function handleRemoveProject() {
    if (!projectBeingRemoved) return;
    onRemoveProject(projectBeingRemoved.id);
    setRemoveProjectId(null);
  }

  return (
    <>
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
          {projects.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<FolderPlus />}
              title={t("settings.noProjects")}
              description={t("settings.noProjectsDesc")}
              action={
                onAddProject ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<FolderPlus size={14} />}
                    onClick={onAddProject}
                  >
                    {t("projects.addProject")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-5">
              {workspaces.map((workspace) => {
                const groupedProjects =
                  workspaceProjects.get(workspace.id) ?? [];
                const isActive = workspace.id === activeWorkspaceId;

                return (
                  <section
                    key={workspace.id}
                    className={cn(
                      "overflow-hidden rounded-g-lg border shadow-g-sm",
                      isActive ? "border-g-line-strong" : "border-g-line",
                    )}
                  >
                    <div
                      className={cn(
                        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                        isActive ? "bg-g-surface-2" : "bg-g-surface",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <WorkspaceAvatar
                          name={workspace.name}
                          iconImage={workspace.iconImage}
                          className="text-g-ink-2"
                        />
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
                            onClick={() => void onSwitchWorkspace(workspace.id)}
                          >
                            {t("settings.switchWorkspaceAction")}
                          </Button>
                        )}
                      </div>
                    </div>
                    {groupedProjects.length === 0 ? (
                      <div className="border-t border-g-line px-5 py-3">
                        <p className="font-g text-g-ui text-g-ink-3">
                          {t("settings.noProjectsInWorkspace")}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-g-line border-t border-g-line">
                        {groupedProjects.map((project) => (
                          <div
                            key={project.id}
                            className="group relative flex flex-col gap-2 px-4 py-2.5 transition-[background] duration-[120ms] ease-g hover:bg-g-surface-2 focus-within:bg-g-surface-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <ProjectAvatar
                                iconImage={project.iconImage}
                                className="size-9 bg-g-surface-3 [&_svg]:size-4"
                              />
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
                                          assetCountByProject[project.id] ?? 0,
                                      })}
                                    </Badge>
                                  )}
                                  <Badge
                                    tone="line"
                                    className={projectAssetsBadgeClass}
                                  >
                                    {projectScanIntentLabel(
                                      t,
                                      project.scanIntent,
                                    )}
                                  </Badge>
                                </div>
                                <div className="mt-1 truncate font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
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
                                className={rowActionButtonClass}
                                onClick={() => setRenameProjectId(project.id)}
                              >
                                {t("action.edit")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                leadingIcon={<Trash2 size={13} />}
                                disabled={working}
                                className={rowActionDangerButtonClass}
                                onClick={() => setRemoveProjectId(project.id)}
                              >
                                {t("action.delete")}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <ProjectDialog
        open={Boolean(projectBeingRenamed)}
        project={projectBeingRenamed}
        loading={false}
        onConfirm={handleRenameProject}
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
        loading={false}
        onConfirm={handleRemoveProject}
        onCancel={() => setRemoveProjectId(null)}
      />
    </>
  );
}
